/**
 * KATA Architecture - Layer 3: Access API Component
 *
 * Access and token-integrity ATCs of the Validate API (ADR-0018, ADR-0019).
 * AUT-045 (a tampered JWT is rejected), AUT-043 (a signed-in UserApp and the
 * real TenantAdmin are refused on the Administrator-only routes) and AUT-044
 * (a TenantAdmin cannot read another tenant's data). Every ATC runs on its OWN
 * crypto session and an EMPTY cookie jar (the caller overrides the project
 * storage state), so none touches the shared administrator session.
 *
 * The forged token is built locally by `DataFactory.createTamperedJwt()`: no
 * real token is read or reused. It travels through a private, UNDECORATED
 * helper (a `@step`/`@atc` title would print it) wrapped so a transport
 * failure rethrows an error without call log or headers (local-handoff 8c).
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - GET /Tenant?Page=1&PageSize=1 - any protected read; only the 401 matters
 * - POST /Auth/login/tenant        - UserApp sign-in (AUT-043)
 * - GET /Tenant, /operators, /contingency, /User - Administrator-only (SuperAdminSistema)
 * - GET /logs/mis-consultas-nr     - UserApp's own log read (TenantUserLogs), positive control
 * - GET /Synchronize/info*, POST/PUT/PATCH /Synchronize/{branch,userapp,terminal},
 *   POST /Validation/{mac-serial,api-access}, GET /tenants/{id}/devices - device endpoints (SEC-012)
 * - POST /handshake                - anonymous by design: no session without a valid client key (SEC-012)
 * - GET /tenants/{id}/appusers     - tenant-scoped read (TenantRead + tenant filter): own tenant 200,
 *                                    another tenant 403 TENANT_ACCESS_FORBIDDEN (AUT-044); the
 *                                    own-tenant read is also the TenantAdmin control of AUT-043
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, LoginPayload } from '@schemas/auth.types';

import { SecureApi } from '@api/SecureApi';
import { expect, test } from '@playwright/test';
import { atc } from '@utils/decorators';

const PROTECTED_READ = '/Tenant?Page=1&PageSize=1';
/** The one read a UserApp is allowed (policy TenantUserLogs): the positive control. */
const OWN_LOG_READ = '/logs/mis-consultas-nr?Page=1&PageSize=1';

/** Routes whose policy is SuperAdminSistema (Administrator only), as typed data. */
const ADMIN_ONLY_ROUTES = [
  { name: 'Tenant', path: '/Tenant?Page=1&PageSize=1' },
  { name: 'Operators', path: '/operators?Page=1&PageSize=1' },
  { name: 'Contingency', path: '/contingency' },
  { name: 'User', path: '/User?Page=1&PageSize=1' },
] as const;

/** Device endpoints that must refuse a caller without credentials (SEC-012), as typed data. */
const DEVICE_ENDPOINTS = [
  { method: 'GET', path: '/Synchronize/inforuserapp' },
  { method: 'GET', path: '/Synchronize/infobranch' },
  { method: 'GET', path: '/Synchronize/infoterminal' },
  ...(['branch', 'userapp', 'terminal'] as const).flatMap(resource =>
    (['POST', 'PUT', 'PATCH'] as const).map(method => ({ method, path: `/Synchronize/${resource}` }))),
  { method: 'POST', path: '/Validation/mac-serial' },
  { method: 'POST', path: '/Validation/api-access' },
  { method: 'GET', path: '/tenants/1/devices' },
] as const;

/** One device-endpoint call to judge: the endpoint, the Bearer value (null = none) and the label of the variant. */
interface DeviceProbe {
  endpoint: (typeof DEVICE_ENDPOINTS)[number]
  bearer: string | null
  label: string
}

/** Not a public key at all (valid base64 of plain text): the handshake must refuse it. */
const GARBAGE_CLIENT_KEY = Buffer.from('this-is-not-a-public-key').toString('base64');

/** Sign-in of a probe principal (flat: the ATC decorator masks `password`). */
export interface RoleProbeCredentials {
  username: string
  password: string
}

/** One principal of the AUT-043 role matrix, as typed data. */
interface RoleProbe {
  label: 'UserApp' | 'TenantAdmin'
  credentials: RoleProbeCredentials
  /** The login response must name the principal's tenant (the control read needs its id). */
  requiresOwnTenant: boolean
  /** The read this principal IS allowed to make (positive control), given the id of its own tenant. */
  controlPath: (ownTenantId: number) => string
}

/** Read of a tenant-scoped resource: allowed for the TenantAdmin of that tenant only. */
const tenantAppUsersPath = (tenantId: number): string => `/tenants/${tenantId}/appusers?Page=1&PageSize=1`;

export class AccessApi extends SecureApi {
  /**
   * Encrypted GET of a protected resource carrying an explicit Bearer token.
   * Deliberately NOT a `@step`: step titles print their arguments. The token is
   * set on the component for this one call only and always restored. Any thrown
   * error goes through `withSecretGuard` (no call log, no headers, no `cause`)
   * because Playwright's call log prints request headers.
   */
  private async getProtectedWithBearer(token: string): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const previous = this.authToken;
    this.authToken = token;
    try {
      return await this.withSecretGuard('bearer', 'token', async () => this.secureGET<unknown>(PROTECTED_READ));
    }
    finally {
      this.authToken = previous;
    }
  }

  /**
   * AUT-045: a request without a session and a request with a Bearer JWT whose
   * signature is invalid are both rejected with 401.
   *
   * Opens its own crypto session (no sign-in, empty cookie jar). First the
   * encrypted GET with no credentials at all answers 401 UNAUTHORIZED (the
   * control: the endpoint is protected). Then the same GET with a locally built
   * JWT carrying a garbage signature answers 401 TOKEN_INVALID: the token is
   * recognised as a token and refused on its signature, not just "absent".
   */
  @atc('AUT-045')
  async rejectTamperedToken(): Promise<void> {
    await this.openCryptoSession();

    const [anonymousResponse, anonymousBody] = await this.secureGET<unknown>(PROTECTED_READ);
    expect(anonymousResponse.status()).toBe(401);
    expect(anonymousBody.Ok).toBe(false);
    expect(anonymousBody.CodeError).toBe('UNAUTHORIZED');

    const [tamperedResponse, tamperedBody] = await this.getProtectedWithBearer(this.data.createTamperedJwt());
    expect(tamperedResponse.status()).toBe(401);
    expect(tamperedBody.Ok).toBe(false);
    expect(tamperedBody.CodeError).toBe('TOKEN_INVALID');
    expect(tamperedBody.Data).toBeNull();

    const { cookies } = await this.request.storageState();
    expect(cookies.map(c => c.name), 'the rejected request must not open a session').not.toContain('access_token');
  }

  /**
   * Sends one device-endpoint call with the given Authorization header (or none)
   * and returns the failure text, or null when the answer is the expected 401 with
   * `Ok` false. Undecorated: the Bearer value stays out of step titles and goes
   * through `sendEnvelope` (`withSecretGuard`). Nothing is bound or changed: the
   * server authenticates before it reads the body.
   */
  private async probeDeviceEndpoint({ endpoint, bearer, label }: DeviceProbe): Promise<string | null> {
    const result = await this.sendEnvelope({
      method: endpoint.method,
      endpoint: endpoint.path,
      body: {},
      headers: bearer === null ? {} : { Authorization: `Bearer ${bearer}` },
    });
    if (result.status !== 401 || result.decoded?.Ok === true) {
      return `${label} ${endpoint.method} ${endpoint.path}: status=${result.status} (expected 401)`;
    }
    return null;
  }

  /**
   * SEC-012: the device endpoints refuse access without credentials.
   *
   * Anonymous requests only (empty cookie jar, no session): every `Synchronize/*`,
   * `Validation/*` and `tenants/{id}/devices` call answers 401 with no credentials,
   * with a malformed Bearer and with a locally built JWT carrying a garbage
   * signature. `handshake` is anonymous BY DESIGN (the case text says 401/403; the
   * owner confirmed 2026-10-28 that the documented behaviour is 400): it opens no
   * session without a client public key (400) nor for a garbage key (400), and its
   * answer carries no `SessionId`. Nothing is created or changed. Failures are
   * collected and thrown once so the @atc decorator records FAIL.
   */
  @atc('SEC-012')
  async refuseDeviceEndpointsWithoutCredentials(): Promise<void> {
    const failures: string[] = [];
    const variants: Array<{ label: string, bearer: string | null }> = [
      { label: 'no credentials', bearer: null },
      { label: 'malformed Bearer', bearer: 'notatoken' },
      { label: 'tampered JWT', bearer: this.data.createTamperedJwt() },
    ];
    for (const variant of variants) {
      for (const endpoint of DEVICE_ENDPOINTS) {
        const failure = await this.probeDeviceEndpoint({ endpoint, bearer: variant.bearer, label: variant.label });
        if (failure !== null) {
          failures.push(failure);
        }
      }
    }

    const handshakeBodies: Array<{ label: string, body: object }> = [
      { label: 'no client key', body: {} },
      { label: 'garbage client key', body: { ClientPublicKey: GARBAGE_CLIENT_KEY } },
    ];
    for (const { label, body } of handshakeBodies) {
      const result = await this.sendEnvelope({ method: 'POST', endpoint: this.config.auth.handshakeEndpoint, body, headers: {} });
      const data = result.decoded?.Data as { SessionId?: unknown } | null | undefined;
      if (result.status !== 400 || data?.SessionId !== undefined) {
        failures.push(`handshake ${label}: status=${result.status}${data?.SessionId !== undefined ? ', a session was opened' : ''} (expected 400, no session)`);
      }
    }

    const total = DEVICE_ENDPOINTS.length * variants.length + handshakeBodies.length;
    if (failures.length > 0) {
      throw new Error(`${failures.length} of ${total} device-endpoint calls were not refused. ${failures.join('; ')}`);
    }
  }

  /**
   * Signs ONE principal in on its own crypto session, proves the positive
   * control, probes the Administrator-only routes and signs out. Returns the
   * route failures (empty = every route answered 403 FORBIDDEN). Undecorated:
   * the credentials stay out of step titles.
   */
  private async probeAdminOnlyRoutes(probe: RoleProbe): Promise<string[]> {
    const credentials: LoginPayload = { UserName: probe.credentials.username, Password: probe.credentials.password };
    await this.openCryptoSession();
    let bodyPassed = false;
    try {
      const [, loginBody] = await this.signInTenantUser(credentials);
      const ownTenantId = loginBody.Data?.TenantId ?? 0;
      if (probe.requiresOwnTenant) {
        expect(ownTenantId, 'control: the TenantAdmin login names its tenant').toBeGreaterThan(0);
      }

      const [controlResponse, controlBody] = await this.secureGET<unknown>(probe.controlPath(ownTenantId));
      expect(controlResponse.status(), `control (${probe.label}): own read`).toBe(200);
      expect(controlBody.Ok).toBe(true);

      const failures: string[] = [];
      for (const route of ADMIN_ONLY_ROUTES) {
        const [response, body] = await this.secureGET<unknown>(route.path);
        if (response.status() !== 403 || body.Ok !== false || body.CodeError !== 'FORBIDDEN') {
          failures.push(`${probe.label} ${route.name}: status=${response.status()} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 403, false, FORBIDDEN)`);
        }
      }
      bodyPassed = true;
      return failures;
    }
    finally {
      await this.signOutAfterBody(bodyPassed);
    }
  }

  /**
   * Closes the server session of a REAL account (an open one lives for days).
   * The logout must answer 200. When the body passed, a failed logout fails the
   * ATC; when the body already failed, it only leaves an annotation so the
   * original error is not masked. `securePOST` does not throw on a non-2xx
   * status, so the status is checked here. Undecorated: no secret in a title.
   */
  private async signOutAfterBody(bodyPassed: boolean): Promise<void> {
    try {
      const [response] = await this.postLogout();
      expect(response.status(), 'logout of the real account must answer 200').toBe(200);
    }
    catch (error) {
      if (bodyPassed) {
        throw error;
      }
      test.info().annotations.push({ type: 'signout-failed', description: 'logout of the real account was not confirmed (server session may stay open)' });
    }
  }

  /**
   * AUT-043: a valid session of the wrong role is refused with 403 FORBIDDEN on
   * every Administrator-only route (Tenant, Operators, Contingency, User), for
   * two principals: a generated UserApp (ADR-0019) and the real TenantAdmin
   * (`config.tenantAdminUser`, positive login only).
   *
   * Each principal gets its own crypto session and signs in on the component's
   * own request context (empty cookie jar), never on the shared Administrator
   * session, and signs out at the end. Positive control per principal: the
   * UserApp reads its own logs (200); the TenantAdmin reads the users of its own
   * tenant (200), so the 403s are not caused by a broken session. No failed
   * login is sent. Route failures of both principals are collected and thrown
   * once, so the @atc decorator sees the failure (a soft expect never throws).
   */
  @atc('AUT-043')
  async rejectOutOfRoleCalls(userApp: RoleProbeCredentials, tenantAdmin: RoleProbeCredentials): Promise<void> {
    const probes: RoleProbe[] = [
      { label: 'UserApp', credentials: userApp, requiresOwnTenant: false, controlPath: () => OWN_LOG_READ },
      { label: 'TenantAdmin', credentials: tenantAdmin, requiresOwnTenant: true, controlPath: tenantAppUsersPath },
    ];

    const failures: string[] = [];
    for (const probe of probes) {
      failures.push(...await this.probeAdminOnlyRoutes(probe));
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} of ${probes.length * ADMIN_ONLY_ROUTES.length} out-of-role calls were not refused. ${failures.join('; ')}`);
    }
  }

  /**
   * AUT-044 (IDOR): a TenantAdmin of one tenant cannot read the data of another
   * tenant. The real TenantAdmin signs in (positive login only) on its own crypto
   * session and cookie jar. Positive control first: the same session reads the
   * users of ITS OWN tenant (200; the id comes from the login response, never
   * from the environment). Then it reads the users of `foreignTenantId` (a
   * generated tenant) and must get 403 TENANT_ACCESS_FORBIDDEN, `Ok=false` and
   * no data. Signs out at the end.
   */
  @atc('AUT-044')
  async rejectCrossTenantRead(tenantAdmin: RoleProbeCredentials, foreignTenantId: number): Promise<void> {
    await this.openCryptoSession();
    let bodyPassed = false;
    try {
      const [, loginBody] = await this.signInTenantUser({ UserName: tenantAdmin.username, Password: tenantAdmin.password });
      const ownTenantId = loginBody.Data?.TenantId ?? 0;
      expect(ownTenantId, 'control: the TenantAdmin login names its tenant').toBeGreaterThan(0);
      expect(foreignTenantId, 'the probed tenant must be another tenant').not.toBe(ownTenantId);

      const [controlResponse, controlBody] = await this.secureGET<unknown>(tenantAppUsersPath(ownTenantId));
      expect(controlResponse.status(), 'control: own tenant read').toBe(200);
      expect(controlBody.Ok).toBe(true);

      const [response, body] = await this.secureGET<unknown>(tenantAppUsersPath(foreignTenantId));
      const failures: string[] = [];
      if (response.status() !== 403) {
        failures.push(`status=${response.status()} (expected 403)`);
      }
      if (body.Ok !== false) {
        failures.push(`Ok=${String(body.Ok)} (expected false)`);
      }
      if (body.CodeError !== 'TENANT_ACCESS_FORBIDDEN') {
        failures.push(`CodeError=${String(body.CodeError)} (expected TENANT_ACCESS_FORBIDDEN)`);
      }
      if (body.Data !== null && body.Data !== undefined) {
        failures.push('Data was returned for another tenant (expected none)');
      }
      if (failures.length > 0) {
        throw new Error(`A TenantAdmin read another tenant's users and was not refused. ${failures.join('; ')}`);
      }
      bodyPassed = true;
    }
    finally {
      await this.signOutAfterBody(bodyPassed);
    }
  }
}
