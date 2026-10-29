/**
 * KATA Architecture - Layer 3: Transport Security API Component
 *
 * Transport-level security ATCs of the Validate API (SEC cases). The anonymous
 * ones: SEC-006 (security headers), SEC-009 (Swagger not exposed) and SEC-010 (CORS
 * refuses foreign origins) send anonymous requests on an EMPTY cookie jar (the spec
 * overrides the project storage state), no login. The session ones: SEC-002 (CSRF)
 * and SEC-001 (envelope rules) open their OWN crypto session and ONE positive
 * Administrator login each, build the broken requests by hand through `sendEnvelope`
 * and create/clean up generated rows: `QAX` operators (SEC-002) and tenants with a
 * unique RNEC (SEC-001). No component is borrowed: the calls are private helpers over
 * the secure methods.
 *
 * The anonymous ATCs avoid the `rl-auth` limiter (4 req / 30 s per IP); SEC-001
 * spends exactly ONE permit (an unknown-user resend-activation, no e-mail is sent).
 *
 * Endpoints (relative to config.apiUrl unless noted):
 * - GET /health                          - headers on a 200
 * - GET /Tenant?Page=1&PageSize=1        - anonymous, answers 401: headers on an error
 * - GET config.baseUrl/                  - the SPA root served by the proxy
 * - GET /swagger/index.html, /swagger/v1/swagger.json, /swagger (redirect) - SEC-009
 * - OPTIONS /health and GET /health with an `Origin` header - SEC-010
 * - POST/DELETE /operators[/{id}], GET /operators?SearchTerm= - SEC-001, SEC-002 (generated rows)
 * - POST /Auth/tenant-admin/resend-activation - SEC-001 (plaintext without a session id)
 */

import type { APIResponse } from '@playwright/test';
import type { CreateTenantPayload } from '@schemas/auth.types';
import type { CreateOperatorPayload, OperatorData, PagedData, RawEnvelopeResult, TenantAuditData } from '@schemas/security.types';
import type { EncryptedEnvelope } from '@utils/cryptoSession';

import { randomBytes } from 'node:crypto';

import { SecureApi } from '@api/SecureApi';
import { atc } from '@utils/decorators';

const HEALTH = '/health';
const ANONYMOUS_PROTECTED_READ = '/Tenant?Page=1&PageSize=1';

/** One response whose headers are checked by SEC-006. */
interface HeaderTarget {
  label: string
  /** Absolute URL. */
  url: string
  /** Extra Content-Security-Policy directives that this surface must carry. */
  cspMustContain: readonly string[]
}

/** Swagger UI and document paths (relative to config.apiUrl) that must not be served (SEC-009). */
const SWAGGER_PATHS = ['/swagger/index.html', '/swagger/v1/swagger.json', '/swagger'] as const;

/** Markers of a served Swagger UI or OpenAPI document. */
const SWAGGER_MARKERS = [/swagger-ui/i, /"openapi"\s*:/i, /"swagger"\s*:/i];

const ONE_YEAR_SECONDS = 31536000;

const OPERATORS = '/operators';
const TENANTS = '/Tenant';
const RESEND_ACTIVATION = '/Auth/tenant-admin/resend-activation';

/** The server accepts a timestamp within 60 s of its clock: this one is clearly stale. */
const STALE_MILLISECONDS = 120_000;

/** How the CSRF double-submit header is sent: equal to the cookie, a made-up value, or left out. */
type CsrfMode = 'valid' | 'wrong' | 'absent';

/** Which protection headers a hand-built request carries. */
interface HeaderChoice {
  csrf: CsrfMode
  /** `X-Timestamp` in epoch milliseconds, or null to leave it out. */
  timestamp: number | null
}

/** One CORS response to judge: the origin's label, the kind of request and the response headers. */
interface CorsProbe {
  label: string
  kind: string
  headers: Record<string, string>
}

/** Statuses that mean the payload layer rejected the request (SEC-001 c and h). */
const REJECTED_STATUSES = [400, 401, 403];

/** Statuses that say nothing about the payload layer: a limiter or a missing route answered instead. */
const INCONCLUSIVE_STATUSES = [404, 405, 429];

/** The verdict of one sub-check of a transport ATC: names and statuses only, never a value. */
interface SubCheck {
  name: string
  observed: string
  passed: boolean
}

export class TransportSecurityApi extends SecureApi {
  // ============================================
  // Helpers (undecorated: raw reads that assert nothing)
  // ============================================

  /** Plain anonymous GET of an absolute URL, with optional request headers. */
  private async getAbsolute(url: string, headers: Record<string, string> = {}): Promise<APIResponse> {
    return this.request.get(url, { headers, timeout: this.config.browser.defaultTimeout });
  }

  /** The host part of `config.baseUrl` (no scheme, no port), used to build look-alike origins. */
  private frontendHost(): string {
    return new URL(this.config.baseUrl).hostname;
  }

  /** The three responses whose headers SEC-006 checks (API 200, API 401, SPA root). */
  private headerTargets(): HeaderTarget[] {
    return [
      { label: 'API 200 (/health)', url: this.apiEndpoint(HEALTH), cspMustContain: ['default-src \'none\''] },
      { label: 'API 401 (anonymous read)', url: this.apiEndpoint(ANONYMOUS_PROTECTED_READ), cspMustContain: ['default-src \'none\''] },
      { label: 'SPA root', url: this.config.baseUrl, cspMustContain: ['default-src \'self\'', 'frame-ancestors \'none\''] },
    ];
  }

  /** Header failures of one response: messages name the header, never a value. */
  private headerFailures(target: HeaderTarget, headers: Record<string, string>): string[] {
    const failures: string[] = [];

    const hsts = headers['strict-transport-security'];
    const maxAge = Number(/max-age=(\d+)/i.exec(hsts ?? '')?.[1] ?? 0);
    if (hsts === undefined) {
      failures.push(`${target.label}: Strict-Transport-Security missing`);
    }
    else {
      if (maxAge < ONE_YEAR_SECONDS) {
        failures.push(`${target.label}: Strict-Transport-Security max-age below one year`);
      }
      if (!/includeSubDomains/i.test(hsts)) {
        failures.push(`${target.label}: Strict-Transport-Security without includeSubDomains`);
      }
    }

    const csp = headers['content-security-policy'];
    if (csp === undefined) {
      failures.push(`${target.label}: Content-Security-Policy missing`);
    }
    else {
      for (const directive of target.cspMustContain) {
        if (!csp.includes(directive)) {
          failures.push(`${target.label}: Content-Security-Policy lacks directive ${directive}`);
        }
      }
    }

    if (headers['x-frame-options']?.toUpperCase() !== 'DENY') {
      failures.push(`${target.label}: X-Frame-Options is not DENY`);
    }
    if (headers['x-content-type-options']?.toLowerCase() !== 'nosniff') {
      failures.push(`${target.label}: X-Content-Type-Options is not nosniff`);
    }
    for (const name of ['referrer-policy', 'permissions-policy']) {
      if (!headers[name]) {
        failures.push(`${target.label}: ${name} missing`);
      }
    }
    return failures;
  }

  /** Origins that must never be allowed: hostile, `null`, look-alikes (append, prepend) and wildcard-style. */
  private foreignOrigins(): Array<{ label: string, origin: string }> {
    const baseOrigin = new URL(this.config.baseUrl).origin;
    const host = this.frontendHost();
    return [
      { label: 'hostile origin', origin: 'http://evil.example' },
      { label: 'null origin', origin: 'null' },
      { label: 'look-alike (appended)', origin: `${baseOrigin}.evil.example` },
      { label: 'look-alike (prepended)', origin: `https://evil-${host}` },
      { label: 'wildcard-style', origin: '*' },
      { label: 'wildcard-style subdomain', origin: `https://*.${host}` },
    ];
  }

  /** CORS failures of one response to a foreign origin: any allow header at all, or a `*`. */
  private corsFailures({ label, kind, headers }: CorsProbe): string[] {
    const failures: string[] = [];
    if (headers['access-control-allow-origin'] !== undefined) {
      failures.push(`${label} ${kind}: Access-Control-Allow-Origin was sent`);
    }
    if (headers['access-control-allow-credentials'] !== undefined) {
      failures.push(`${label} ${kind}: Access-Control-Allow-Credentials was sent`);
    }
    return failures;
  }

  /** True when the body of a Swagger path looks like a served UI or OpenAPI document. */
  private looksLikeSwagger(body: string): boolean {
    return SWAGGER_MARKERS.some(marker => marker.test(body));
  }

  // ---- Session-bound helpers (secret-bearing: undecorated, behind withSecretGuard) ----

  /** The session id plus the CSRF value and timestamp the caller chose; the values never leave this class. */
  private async sessionHeaders(choice: HeaderChoice): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'X-Session-Id': this.activeSession().sessionId };
    if (choice.csrf === 'valid') {
      Object.assign(headers, await this.csrfHeader());
    }
    else if (choice.csrf === 'wrong') {
      headers['X-CSRF-Token'] = randomBytes(24).toString('base64url');
    }
    if (choice.timestamp !== null) {
      headers['X-Timestamp'] = String(choice.timestamp);
    }
    return headers;
  }

  /** POST /operators with a body the caller built (envelope, tampered envelope or plaintext). */
  private async postOperator(body: object, choice: HeaderChoice): Promise<RawEnvelopeResult> {
    return this.sendEnvelope({ method: 'POST', endpoint: OPERATORS, body, headers: await this.sessionHeaders(choice) });
  }

  /** DELETE /operators/{id} with the CSRF mode the caller chose (no body, so no timestamp). */
  private async deleteOperatorWith(operatorId: number, csrf: CsrfMode): Promise<RawEnvelopeResult> {
    return this.sendEnvelope({
      method: 'DELETE',
      endpoint: `${OPERATORS}/${operatorId}`,
      headers: await this.sessionHeaders({ csrf, timestamp: null }),
    });
  }

  /** A valid single-use envelope of an operator payload, sent with correct headers; returns the answer. */
  private async createValidOperator(payload: CreateOperatorPayload): Promise<RawEnvelopeResult> {
    return this.postOperator(this.encryptWithSession(payload), { csrf: 'valid', timestamp: Date.now() });
  }

  private createdId(result: RawEnvelopeResult): number | null {
    const data = result.decoded?.Data as { Id?: unknown } | null | undefined;
    return typeof data?.Id === 'number' ? data.Id : null;
  }

  /** The stored operators whose code equals the generated one (search is by text, so filtered). */
  private async findOperators(code: string): Promise<OperatorData[]> {
    const query = new URLSearchParams({ Page: '1', PageSize: '50', SearchTerm: code });
    const [response, body] = await this.secureGET<PagedData<OperatorData>>(`${OPERATORS}?${query.toString()}`);
    if (response.status() !== 200 || !body.Ok) {
      throw new Error(`operator search answered HTTP ${response.status()}`);
    }
    return (body.Data?.Data ?? []).filter(row => row.OperatorCode === code);
  }

  /** Delete every generated operator found by code and confirm none is left; failures come back as sub-checks. */
  private async removeOperators(codes: readonly string[]): Promise<SubCheck[]> {
    const failures: SubCheck[] = [];
    for (const code of codes) {
      try {
        for (const row of await this.findOperators(code)) {
          const [response] = await this.secureDELETE<unknown>(`${OPERATORS}/${row.Id}`);
          if (response.status() !== 200) {
            failures.push({ name: 'cleanup', observed: `delete of a generated operator answered HTTP ${response.status()}`, passed: false });
          }
        }
        const left = (await this.findOperators(code)).length;
        if (left > 0) {
          failures.push({ name: 'cleanup', observed: `${left} generated operator(s) left`, passed: false });
        }
      }
      catch (error) {
        failures.push({ name: 'cleanup', observed: (error as Error).message.split('\n')[0], passed: false });
      }
    }
    return failures;
  }

  /** Throw ONE error naming each failed sub-check with its observed status; passing ones are listed by name. */
  private throwIfAnyFailed(scope: string, outcomes: readonly SubCheck[]): void {
    const failed = outcomes.filter(outcome => !outcome.passed);
    if (failed.length === 0) {
      return;
    }
    const passed = outcomes.filter(outcome => outcome.passed).map(outcome => outcome.name);
    throw new Error(
      `${scope}: ${failed.length} of ${outcomes.length} sub-checks failed. `
      + `${failed.map(outcome => `[${outcome.name}] ${outcome.observed}`).join('; ')}. `
      + `Passed: ${passed.length > 0 ? passed.join(', ') : 'none'}`,
    );
  }

  /** The envelope with one byte of the ciphertext flipped (the GCM tag no longer matches). */
  private tamperCiphertext(envelope: EncryptedEnvelope): EncryptedEnvelope {
    const bytes = Buffer.from(envelope.ct, 'base64');
    bytes[0] ^= 0x01;
    return { ...envelope, ct: bytes.toString('base64') };
  }

  /** `ct`/`nonce` that cannot be decoded: not base64 at all, and valid base64 with a wrong nonce length. */
  private malformedEnvelopes(): EncryptedEnvelope[] {
    return [
      { ct: '!!not base64!!', nonce: '!!not base64!!' },
      { ct: randomBytes(32).toString('base64'), nonce: randomBytes(5).toString('base64') },
    ];
  }

  /**
   * A sub-check that expects the payload layer to REJECT the request (400, 401 or 403). A 404, 405 or
   * 429 says nothing about that layer (a missing route or the limiter answered), so it fails as
   * inconclusive, never as a verdict on the product.
   */
  private rejectionOutcome(name: string, status: number): SubCheck {
    if (INCONCLUSIVE_STATUSES.includes(status)) {
      return { name, observed: `HTTP ${status}, inconclusive (limiter or route, not a verdict)`, passed: false };
    }
    return { name, observed: `HTTP ${status}, expected a rejection (400, 401 or 403)`, passed: REJECTED_STATUSES.includes(status) };
  }

  /** POST /Tenant with a body the caller built (envelope, tampered envelope or plaintext). */
  private async postTenant(body: object, choice: HeaderChoice): Promise<RawEnvelopeResult> {
    return this.sendEnvelope({ method: 'POST', endpoint: TENANTS, body, headers: await this.sessionHeaders(choice) });
  }

  /** A valid single-use envelope of a generated tenant payload, sent with correct headers; returns the answer. */
  private async createValidTenant(payload: CreateTenantPayload): Promise<RawEnvelopeResult> {
    return this.postTenant(this.encryptWithSession(payload), { csrf: 'valid', timestamp: Date.now() });
  }

  /** The ids of the stored tenants whose RNEC equals the generated one (search is by text, so filtered). */
  private async findTenantIds(rnec: string): Promise<number[]> {
    const query = new URLSearchParams({ Page: '1', PageSize: '50', SearchTerm: rnec });
    const [response, body] = await this.secureGET<PagedData<TenantAuditData>>(`${TENANTS}?${query.toString()}`);
    if (response.status() !== 200 || !body.Ok) {
      throw new Error(`tenant search answered HTTP ${response.status()}`);
    }
    return (body.Data?.Data ?? []).filter(row => row.Rnec === rnec).map(row => row.Id);
  }

  /** Soft-delete every generated tenant found by RNEC and confirm none is left; failures come back as sub-checks. */
  private async removeTenants(rnecs: readonly string[]): Promise<SubCheck[]> {
    const failures: SubCheck[] = [];
    for (const rnec of rnecs) {
      try {
        for (const id of await this.findTenantIds(rnec)) {
          const [response] = await this.secureDELETE<unknown>(`${TENANTS}/${id}`);
          if (response.status() !== 200) {
            failures.push({ name: 'cleanup', observed: `delete of a generated tenant answered HTTP ${response.status()}`, passed: false });
          }
        }
        const left = (await this.findTenantIds(rnec)).length;
        if (left > 0) {
          failures.push({ name: 'cleanup', observed: `${left} generated tenant(s) left`, passed: false });
        }
      }
      catch (error) {
        failures.push({ name: 'cleanup', observed: (error as Error).message.split('\n')[0], passed: false });
      }
    }
    return failures;
  }

  /** The payload without its secret: the plaintext requests never carry the `DbPassword`. */
  private withoutSecret(payload: CreateTenantPayload): object {
    const { DbPassword: _omitted, ...rest } = payload;
    return rest;
  }

  /** SEC-001 b, c, d, e, g: requests that break one envelope rule each, all answered before the controller. */
  private async probeBrokenEnvelopes(probe: CreateTenantPayload): Promise<SubCheck[]> {
    const outcomes: SubCheck[] = [];
    const fresh = (): HeaderChoice => ({ csrf: 'valid', timestamp: Date.now() });
    const plainBody = this.withoutSecret(probe);

    const noTimestamp = await this.postTenant(plainBody, { csrf: 'valid', timestamp: null });
    outcomes.push({ name: 'b plaintext without timestamp', observed: `HTTP ${noTimestamp.status}, expected 400`, passed: noTimestamp.status === 400 });

    const plaintext = await this.postTenant(plainBody, fresh());
    outcomes.push(this.rejectionOutcome('c plaintext with session id and timestamp', plaintext.status));

    const malformed: number[] = [];
    for (const envelope of this.malformedEnvelopes()) {
      malformed.push((await this.postTenant(envelope, fresh())).status);
    }
    outcomes.push({
      name: 'd malformed ct/nonce',
      observed: `HTTP ${malformed.join(' and ')} (not base64, wrong nonce length), expected 400 each`,
      passed: malformed.every(status => status === 400),
    });

    const tampered = await this.postTenant(this.tamperCiphertext(this.encryptWithSession(probe)), fresh());
    outcomes.push({ name: 'e tampered ciphertext', observed: `HTTP ${tampered.status}, expected 400`, passed: tampered.status === 400 });

    const stale = await this.postTenant(this.encryptWithSession(probe), { csrf: 'valid', timestamp: Date.now() - STALE_MILLISECONDS });
    outcomes.push({ name: 'g stale timestamp', observed: `HTTP ${stale.status}, expected 401`, passed: stale.status === 401 });

    return outcomes;
  }

  /** SEC-001 f: the SAME envelope twice; the second is refused and only one row exists. */
  private async probeNonceReplay(payload: CreateTenantPayload): Promise<SubCheck> {
    const envelope = this.encryptWithSession(payload);
    const first = await this.postTenant(envelope, { csrf: 'valid', timestamp: Date.now() });
    const second = await this.postTenant(envelope, { csrf: 'valid', timestamp: Date.now() });
    const rows = (await this.findTenantIds(payload.Rnec!)).length;
    return {
      name: 'f nonce replay',
      observed: `first HTTP ${first.status} (expected 200), second HTTP ${second.status} (expected 401), ${rows} row(s) (expected 1)`,
      passed: first.status === 200 && second.status === 401 && rows === 1,
    };
  }

  /**
   * SEC-001 h: a plaintext body with NO session id on an anonymous endpoint, sent
   * from a signed-out jar. An unknown generated user: nothing changes, no e-mail.
   */
  private async probePlaintextWithoutSession(): Promise<SubCheck> {
    const result = await this.sendEnvelope({
      method: 'POST',
      endpoint: RESEND_ACTIVATION,
      body: { UserName: this.data.createUnknownEmail() },
      headers: {},
    });
    return this.rejectionOutcome('h plaintext without session id', result.status);
  }

  // ============================================
  // ATCs
  // ============================================

  /**
   * SEC-006: the API and the SPA answer with the browser security headers.
   *
   * Three anonymous responses as the browser sees them through the proxy: the API
   * `GET /health` (200), an anonymous protected read (401, so error answers carry
   * the headers too) and the SPA root. Each must carry Strict-Transport-Security
   * (max-age at least one year, includeSubDomains; asserted locally because the
   * proxy in front sets it, D9), Content-Security-Policy (API `default-src 'none'`;
   * SPA `default-src 'self'` and `frame-ancestors 'none'`), X-Frame-Options DENY,
   * X-Content-Type-Options nosniff, Referrer-Policy and Permissions-Policy. Not
   * asserted: Cache-Control no-store (present only on /health). Failures name the
   * header, never a value, and are thrown once.
   */
  @atc('SEC-006')
  async sendSecurityHeaders(): Promise<void> {
    const failures: string[] = [];
    for (const target of this.headerTargets()) {
      const response = await this.getAbsolute(target.url);
      failures.push(...this.headerFailures(target, response.headers()));
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} security header checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * SEC-009: Swagger is not exposed.
   *
   * Anonymous GET of the Swagger UI, the OpenAPI document and the bare `/swagger`
   * path (redirect followed). None may answer 200 nor carry Swagger content
   * (`swagger-ui`, an `openapi`/`swagger` document key): the production-correct
   * answer is 404 from the API (the SPA fallback does not apply under `/api/`).
   * The content is checked as well as the status. EXPECTED TO FAIL on the current
   * local target, which is not Production (Swagger stays on outside Production,
   * HAL-48): the failure is the recorded product defect, not a test bug.
   */
  @atc('SEC-009')
  async hideSwaggerOutsideDevelopment(): Promise<void> {
    const failures: string[] = [];
    for (const path of SWAGGER_PATHS) {
      const response = await this.getAbsolute(this.apiEndpoint(path));
      const exposed = response.status() === 200 || this.looksLikeSwagger(await response.text());
      if (exposed) {
        failures.push(`${path}: status=${response.status()} (expected not served, 404)`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Swagger is exposed on ${failures.length} of ${SWAGGER_PATHS.length} paths. ${failures.join('; ')}`);
    }
  }

  /**
   * SEC-010: CORS refuses foreign origins (negative half only).
   *
   * For each foreign origin (hostile, `null`, a look-alike that appends, one that
   * prepends, `*` and a wildcard subdomain) an OPTIONS preflight (with request
   * method and `x-session-id`) AND a simple GET `/health` carrying the `Origin`
   * header must come back with no Access-Control-Allow-Origin and no
   * Access-Control-Allow-Credentials. GAP: the positive control (the allowed
   * frontend origin is echoed with credentials) is NOT asserted: the origin the
   * target allows is neither `config.baseUrl` nor localhost:4200 and no variable
   * declares it (owner decision 2026-10-28, Q2 no). A permissive-by-default
   * policy that also refuses everyone would pass here.
   */
  @atc('SEC-010')
  async restrictCrossOriginAccess(): Promise<void> {
    const failures: string[] = [];
    const origins = this.foreignOrigins();
    for (const { label, origin } of origins) {
      const preflight = await this.request.fetch(this.apiEndpoint(HEALTH), {
        method: 'OPTIONS',
        headers: {
          'Origin': origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'x-session-id',
        },
        timeout: this.config.browser.defaultTimeout,
      });
      failures.push(...this.corsFailures({ label, kind: 'preflight', headers: preflight.headers() }));

      const simple = await this.getAbsolute(this.apiEndpoint(HEALTH), { Origin: origin });
      failures.push(...this.corsFailures({ label, kind: 'simple GET', headers: simple.headers() }));
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} of ${origins.length * 2} cross-origin requests were not refused. ${failures.join('; ')}`);
    }
  }

  /**
   * SEC-002: a mutation without a valid CSRF token is rejected.
   *
   * Own crypto session and ONE positive Administrator login. Positive control
   * first: a create with the header equal to the `csrf_token` cookie answers 200.
   * Then, with a valid envelope each time: POST with a WRONG token -> 403 and the
   * generated operator does not exist afterwards; POST with the header ABSENT -> 403
   * and not created (production-correct; the bypass exists only on a Development
   * backend, which this target is not); DELETE of the control row with the header
   * absent and then wrong -> 403 and the row still exists. Generated `QAX`
   * operators are removed in `finally`; the token value is never printed.
   */
  @atc('SEC-002')
  async rejectMutationsWithoutValidCsrf(): Promise<void> {
    await this.openAdministratorSession();
    const control = this.data.createPlainOperatorPayload();
    const wrong = this.data.createPlainOperatorPayload();
    const absent = this.data.createPlainOperatorPayload();
    const outcomes: SubCheck[] = [];

    try {
      const created = await this.createValidOperator(control);
      const controlId = this.createdId(created);
      outcomes.push({ name: 'control create with the correct token', observed: `HTTP ${created.status}, expected 200`, passed: created.status === 200 && controlId !== null });

      if (controlId !== null) {
        for (const { name, payload, csrf } of [
          { name: 'POST with a wrong token', payload: wrong, csrf: 'wrong' as const },
          { name: 'POST without the token', payload: absent, csrf: 'absent' as const },
        ]) {
          const result = await this.postOperator(this.encryptWithSession(payload), { csrf, timestamp: Date.now() });
          const rows = (await this.findOperators(payload.OperatorCode!)).length;
          outcomes.push({ name, observed: `HTTP ${result.status} (expected 403), ${rows} row(s) created (expected 0)`, passed: result.status === 403 && rows === 0 });
        }

        for (const { name, csrf } of [
          { name: 'DELETE without the token', csrf: 'absent' as const },
          { name: 'DELETE with a wrong token', csrf: 'wrong' as const },
        ]) {
          const result = await this.deleteOperatorWith(controlId, csrf);
          const rows = (await this.findOperators(control.OperatorCode!)).length;
          outcomes.push({ name, observed: `HTTP ${result.status} (expected 403), ${rows} row(s) left (expected 1)`, passed: result.status === 403 && rows === 1 });
        }
      }
    }
    finally {
      outcomes.push(...await this.removeOperators([control.OperatorCode!, wrong.OperatorCode!, absent.OperatorCode!]));
      await this.postLogout().catch(() => undefined);
    }

    this.throwIfAnyFailed('SEC-002', outcomes);
  }

  /**
   * SEC-001: a plaintext, malformed, tampered, replayed or stale payload is rejected.
   *
   * Own crypto session and ONE positive Administrator login. Every request is
   * built by hand on top of the real session, so each sends what an attacker could:
   * (a) positive control, a valid envelope -> 200; (b) plaintext, session id, no
   * timestamp -> 400; (c) plaintext with session id AND timestamp -> 400, 401 or 403;
   * (d) `ct`/`nonce` that cannot be decoded -> 400; (e) one flipped ciphertext
   * byte -> 400; (f) the SAME envelope twice -> 200 then 401 and exactly one row;
   * (g) a stale timestamp -> 401; (h) plaintext with NO session id on an anonymous
   * endpoint, from a signed-out jar -> 400, 401 or 403 (a 404, 405 or 429 is reported as
   * inconclusive: limiter or route, not a verdict). Nothing may be created by the
   * rejected calls. The sub-checks accumulate into ONE error (letter, status).
   * EXPECTED TO FAIL on c and d (the middleware answers 500 where it should answer
   * 4xx: a product defect) and on h (non-Production plaintext fallback, HAL-48);
   * any other failing letter is a test bug. The control, the probe and the replay are
   * GENERATED TENANTS (unique RNEC): the plaintext requests carry the payload without its
   * `DbPassword`, which travels only inside the encrypted envelopes. The generated tenants
   * are soft-deleted in `finally` and their removal is verified by RNEC.
   */
  @atc('SEC-001')
  async rejectUnencryptedAndReplayedPayloads(): Promise<void> {
    await this.openAdministratorSession();
    const control = this.data.createTenantPayload();
    const probe = this.data.createTenantPayload();
    const replay = this.data.createTenantPayload();
    const outcomes: SubCheck[] = [];

    try {
      const created = await this.createValidTenant(control);
      outcomes.push({ name: 'a positive control', observed: `HTTP ${created.status}, expected 200`, passed: created.status === 200 });

      if (created.status === 200) {
        outcomes.push(...await this.probeBrokenEnvelopes(probe));
        outcomes.push(await this.probeNonceReplay(replay));
        const rows = (await this.findTenantIds(probe.Rnec!)).length;
        outcomes.push({ name: 'rejected requests created nothing', observed: `${rows} row(s), expected 0`, passed: rows === 0 });
      }
    }
    finally {
      outcomes.push(...await this.removeTenants([control.Rnec!, probe.Rnec!, replay.Rnec!]));
      await this.postLogout().catch(() => undefined);
    }

    outcomes.push(await this.probePlaintextWithoutSession());
    this.throwIfAnyFailed('SEC-001', outcomes);
  }
}
