/**
 * KATA Architecture - Layer 3: Session Security API Component
 *
 * Session-level security ATCs of the Validate API (SEC cases): SEC-005 (the session
 * cookies carry the protective flags), SEC-007 (no token, password or secret
 * travels in the clear on the API channel) and SEC-008 (brute force on the login).
 * SEC-005 and SEC-007 open their OWN crypto session on an empty cookie jar and spend
 * ONE positive Administrator login (SEC-005 adds one positive login of a GENERATED
 * UserApp; no failed logins, no e-mails), and sign out at the end. SEC-008 sends failed logins ONLY to GENERATED accounts and releases the
 * address limiter in `finally`.
 *
 * Scope of SEC-007: decrypted response bodies, response headers, error answers and
 * the encrypted request on the wire. Backend logs and the browser console/storage
 * are NOT covered (owner decisions Q3 and Q4, 2026-10-28).
 *
 * Cookie VALUES and token VALUES are never read into a message: failures name the
 * check, the cookie name or the field path, never a value.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - POST   /Auth/login/admin  - the one positive login
 * - POST   /Auth/login/tenant - SEC-005 second row (generated UserApp)
 * - POST   /Auth/logout       - end of the session
 * - GET    /tenants/{tenantId}/appusers/{id}, /User/{id}, /User?SearchTerm= - SEC-007 reads (generated UserApp, Admin, admins list)
 * - POST   /Tenant            - generated tenant (read, and an invalid body that carries a generated secret)
 * - GET    /Tenant/{id}       - read of the generated tenant
 * - DELETE /Tenant/{id}       - soft delete of the generated tenant
 */

import type { CreatedEntityData, CreateTenantPayload, LoginPayload } from '@schemas/auth.types';
import type { PagedData, RawEnvelopeResult, TenantAuditData } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { atc } from '@utils/decorators';

/** A GENERATED login (never the real Administrator or TenantAdmin): flat, the decorator masks `password`. */
interface BruteForceLogin {
  username: string
  password: string
}

/** What SEC-008 needs: two generated accounts and the global Administrator lock threshold. */
export interface BruteForceTarget {
  userApp: BruteForceLogin
  admin: BruteForceLogin
  /** Global failed-login threshold of platform Admins (read by the spec through the Administrator API). */
  adminThreshold: number
}

/** One row of SEC-008: which login route, which account, after how many wrong passwords it must lock (null = the limiter only). */
interface BruteForceRow {
  label: string
  route: string
  login: BruteForceLogin
  lockAfter: number | null
}

/** One login attempt: the login route, the account and the shared clock. */
interface LoginAttempt {
  route: string
  login: BruteForceLogin
  clock: AttemptClock
}

/** Time of the LAST login attempt sent (any answer), shared by the rows so the limiter wait is measured from it. */
interface AttemptClock {
  lastAt: number | undefined
}

/** Failed logins the address limiter lets through per 30 s window before it answers 429. */
const LIMITER_FAILURES = 4;

/** The attributes of one session cookie that SEC-005 judges (the value is never part of it). */
interface CookieFlags {
  name: string
  httpOnly: boolean
  secure: boolean
  sameSite: string
  path: string
}

/** What SEC-005 needs besides the Administrator: a GENERATED UserApp (flat, the decorator masks `password`). */
export interface CookieFlagsTarget {
  userApp: BruteForceLogin
}

/** One row of SEC-005: its label and how it signs in (a positive login; the cookies land in the jar). */
interface CookieFlagsRow {
  label: string
  signIn: () => Promise<unknown>
}

/** The generated principals SEC-007 reads (ADR-0019): flat records, the decorator masks `password`. */
export interface SecretReadTarget {
  tenantId: number
  userApp: { id: number, password: string }
  admin: { id: number, username: string, password: string }
}

/** One read whose body is searched: where it is (a location name for messages) and the secrets it must not carry. */
interface BodyProbe {
  location: string
  endpoint: string
  secrets: ReadonlyArray<{ what: string, value: string }>
}

/** What a session cookie must look like. */
interface CookieExpectation {
  name: string
  httpOnly: boolean
  path: string
}

/** Cookie name -> expected attributes. `csrf_token` is readable by the SPA by design (double submit). */
const EXPECTED_COOKIES: readonly CookieExpectation[] = [
  { name: 'access_token', httpOnly: true, path: '/' },
  { name: 'refresh_token', httpOnly: true, path: '/api' },
  { name: 'csrf_token', httpOnly: false, path: '/' },
];

const TENANTS = '/Tenant';

/** Field names that may carry a credential. */
const SECRET_KEY = /pass|secret|hash|token|key/i;

/** A JWT-looking string (three base64url parts, the first starting with the JSON header). */
const JWT_SHAPE = /eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/;

/** A value that is only mask characters (or empty) is masked. */
const MASKED_VALUE = /^[*•·x.\-]*$/i;

export class SessionSecurityApi extends SecureApi {
  // ============================================
  // Helpers (undecorated: they touch cookies, tokens and passwords)
  // ============================================

  /** The attributes (never the values) of the cookies currently in the jar. */
  private async cookieFlags(): Promise<CookieFlags[]> {
    const { cookies } = await this.request.storageState();
    return cookies.map(cookie => ({
      name: cookie.name,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      path: cookie.path,
    }));
  }

  /** Flag failures of the three session cookies: messages name the cookie and the attribute, never a value. */
  private cookieFailures(flags: readonly CookieFlags[]): string[] {
    const failures: string[] = [];
    for (const expected of EXPECTED_COOKIES) {
      const cookie = flags.find(candidate => candidate.name === expected.name);
      if (cookie === undefined) {
        failures.push(`${expected.name}: cookie missing after sign-in`);
        continue;
      }
      if (cookie.httpOnly !== expected.httpOnly) {
        failures.push(`${expected.name}: HttpOnly is ${cookie.httpOnly}, expected ${expected.httpOnly}`);
      }
      if (!cookie.secure) {
        failures.push(`${expected.name}: Secure is not set`);
      }
      if (cookie.sameSite !== 'Strict') {
        failures.push(`${expected.name}: SameSite is ${cookie.sameSite}, expected Strict`);
      }
      if (cookie.path !== expected.path) {
        failures.push(`${expected.name}: path is ${cookie.path}, expected ${expected.path}`);
      }
    }
    return failures;
  }

  /**
   * Paths of the fields in a decoded body that hold a clear credential: a JWT-shaped
   * string anywhere, or a string under a key that looks like a secret and is not
   * masked/empty. Booleans, numbers and null are flags, not secrets. Returns paths only.
   */
  private secretLocations(value: unknown, path: string): string[] {
    if (typeof value === 'string') {
      return JWT_SHAPE.test(value) ? [path] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => this.secretLocations(item, `${path}[${index}]`));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([key, child]) => {
        const here = path === '' ? key : `${path}.${key}`;
        const clearSecret = SECRET_KEY.test(key) && typeof child === 'string' && !MASKED_VALUE.test(child);
        return clearSecret ? [here] : this.secretLocations(child, here);
      });
    }
    return [];
  }

  /** The generated tenant is created on the current session; the id comes back for read and cleanup. */
  private async createGeneratedTenant(payload: CreateTenantPayload): Promise<number | null> {
    const [response, body] = await this.securePOST<CreatedEntityData, CreateTenantPayload>(TENANTS, payload);
    return response.status() === 200 && body.Ok ? (body.Data?.Id ?? null) : null;
  }

  /** The decoded body of a read of the generated tenant (`text` is the stringified body, for in-memory search only). */
  private async readGeneratedTenant(tenantId: number): Promise<{ status: number, data: unknown, text: string }> {
    const [response, body] = await this.secureGET<unknown>(`${TENANTS}/${tenantId}`);
    return { status: response.status(), data: body.Data, text: JSON.stringify(body) };
  }

  /** Whether a text carries a value, as written or JSON-escaped. In-memory only: the value never reaches a message. */
  private carries(text: string, value: string): boolean {
    return value.length > 0 && (text.includes(value) || text.includes(JSON.stringify(value).slice(1, -1)));
  }

  /** The ids of the tenants whose RNEC equals the generated one (search is by text, so filtered). */
  private async findTenantIds(rnec: string): Promise<number[]> {
    const query = new URLSearchParams({ Page: '1', PageSize: '50', SearchTerm: rnec });
    const [response, body] = await this.secureGET<PagedData<TenantAuditData>>(`${TENANTS}?${query.toString()}`);
    if (response.status() !== 200 || !body.Ok) {
      throw new Error(`tenant search answered HTTP ${response.status()}`);
    }
    return (body.Data?.Data ?? []).filter(row => row.Rnec === rnec).map(row => row.Id);
  }

  /**
   * Soft-delete the generated tenant and report every failure (never swallowed). When the create
   * did not return an id the server may still have stored the row, so it is searched by the
   * generated RNEC and each match is removed.
   */
  private async removeGeneratedTenant(tenantId: number | null, rnec: string | null | undefined): Promise<string[]> {
    const failures: string[] = [];
    try {
      const ids = tenantId !== null ? [tenantId] : (!rnec ? [] : await this.findTenantIds(rnec));
      for (const id of ids) {
        const [response] = await this.secureDELETE<unknown>(`${TENANTS}/${id}`);
        if (response.status() !== 200) {
          failures.push(`cleanup: delete of the generated tenant answered HTTP ${response.status()}`);
        }
      }
    }
    catch (error) {
      failures.push(`cleanup: ${(error as Error).message.split('\n')[0]}`);
    }
    return failures;
  }

  /**
   * An invalid create (no business fields) that carries a generated secret: the error
   * answer must not echo it in body or headers. The request goes out as an envelope;
   * the check also proves the secret is not in the clear inside that envelope.
   */
  private async probeErrorEcho(secret: string): Promise<string[]> {
    const session = this.activeSession();
    const envelope = this.encryptWithSession({ DbPassword: secret });
    const failures: string[] = [];
    if (JSON.stringify(envelope).includes(secret)) {
      failures.push('request on the wire: the generated secret is readable in the envelope');
    }
    const result = await this.sendEnvelope({
      method: 'POST',
      endpoint: TENANTS,
      body: envelope,
      headers: await this.envelopeHeaders(session),
    });
    if (result.status !== 400 && result.status !== 422) {
      failures.push(`error answer: HTTP ${result.status}, echo check inconclusive (validation did not answer 400 or 422)`);
    }
    if (this.carries(result.rawText, secret) || this.carries(JSON.stringify(result.decoded ?? {}), secret)) {
      failures.push('error answer body: echoes the submitted secret');
    }
    for (const [name, headerValue] of Object.entries(result.headers)) {
      if (headerValue.includes(secret)) {
        failures.push(`error answer header ${name}: echoes the submitted secret`);
      }
    }
    return failures;
  }

  /**
   * Read one endpoint and judge its decoded body: no clear field under a secret-like key, no
   * JWT shape, none of the given generated secrets. Messages name the location only.
   */
  private async probeBody({ location, endpoint, secrets }: BodyProbe): Promise<string[]> {
    const [response, body] = await this.secureGET<unknown>(endpoint);
    if (response.status() !== 200) {
      return [`${location}: read answered HTTP ${response.status()}, the check did not run`];
    }
    const failures = this.secretLocations(body.Data, location).map(path => `${path}: clear credential`);
    const text = JSON.stringify(body);
    for (const { what, value } of secrets) {
      if (this.carries(text, value)) {
        failures.push(`${location} body: carries a generated ${what}`);
      }
    }
    return failures;
  }

  /** Response header names that must never appear (the credential travels in cookies only). */
  private forbiddenHeaders(headers: Record<string, string>): string[] {
    return Object.keys(headers)
      .filter(name => name.toLowerCase() === 'authorization')
      .map(name => `response header ${name}: present`);
  }

  /**
   * One encrypted login attempt on the CURRENT crypto session; nothing is asserted
   * and nothing throws on a 4xx. Undecorated: the payload carries a password and a
   * success answer carries session cookies. Stamps the clock with the attempt time.
   */
  private async attemptLogin({ route, login, clock }: LoginAttempt): Promise<RawEnvelopeResult> {
    const session = this.activeSession();
    const payload: LoginPayload = { UserName: login.username, Password: login.password };
    const result = await this.sendEnvelope({
      method: 'POST',
      endpoint: route,
      body: this.encryptWithSession(payload),
      headers: await this.envelopeHeaders(session),
    });
    clock.lastAt = Date.now();
    return result;
  }

  /** A `Retry-After` value is valid when it is a positive number of seconds or an HTTP date. */
  private validRetryAfter(value: string | undefined): boolean {
    if (value === undefined) {
      return false;
    }
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed) > 0;
    }
    return /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed) && !Number.isNaN(Date.parse(trimmed));
  }

  /**
   * One SEC-005 row: sign in once, judge the cookie flags (attributes only), sign out, and
   * confirm the cookies left the jar. Every message is prefixed with the row label.
   */
  private async cookieFlagsRow(row: CookieFlagsRow): Promise<string[]> {
    const failures: string[] = [];
    try {
      await row.signIn();
      failures.push(...this.cookieFailures(await this.cookieFlags()));
    }
    catch (error) {
      failures.push(`sign-in did not complete: ${(error as Error).message.split('\n')[0].slice(0, 120)}`);
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    const left = (await this.cookieFlags())
      .filter(cookie => EXPECTED_COOKIES.some(expected => expected.name === cookie.name))
      .map(cookie => cookie.name);
    for (const name of left) {
      failures.push(`${name}: cookie still in the jar after logout`);
    }
    return failures.map(failure => `${row.label} ${failure}`);
  }

  /** Sign out and open a NEW crypto session (the logout drops the previous one). */
  private async signOutAndReopenSession(): Promise<void> {
    await this.postLogout();
    await this.openCryptoSession();
  }

  /**
   * One brute-force row on a GENERATED account: positive control, wrong passwords up
   * to the lock (or up to the limiter when the account has no lock in reach), the
   * correct password refused while locked, then the address limiter answers 429.
   * Failures name the row, the attempt and the status, never a value.
   */
  private async bruteForceRow(row: BruteForceRow, clock: AttemptClock): Promise<string[]> {
    const { label, route, login, lockAfter } = row;
    const failures: string[] = [];
    const wrong: BruteForceLogin = { username: login.username, password: this.data.createWrongPassword() };

    await this.openCryptoSession();
    const control = await this.attemptLogin({ route, login, clock });
    if (control.status !== 200 || control.decoded?.Ok !== true) {
      return [`${label} positive control: HTTP ${control.status}, the row did not run`];
    }
    await this.signOutAndReopenSession();

    let failed = 0;
    const plainMessages: string[] = [];
    let lockedMessage: string | null = null;
    for (let attempt = 1; attempt <= (lockAfter ?? LIMITER_FAILURES); attempt++) {
      const answer = await this.attemptLogin({ route, login: wrong, clock });
      failed++;
      const expectedCode = attempt === lockAfter ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS';
      if (answer.status !== 401 || answer.code !== expectedCode) {
        failures.push(`${label} wrong password #${attempt}: HTTP ${answer.status}, expected 401 ${expectedCode}`);
      }
      const message = answer.decoded?.Error ?? '';
      if (message.toLowerCase().includes(login.username.toLowerCase())) {
        failures.push(`${label} wrong password #${attempt}: the message echoes the user name`);
      }
      if (attempt === lockAfter) {
        lockedMessage = message;
      }
      else {
        plainMessages.push(message);
      }
    }
    if (new Set(plainMessages).size > 1) {
      failures.push(`${label}: the wording of the wrong-credentials answers is not stable`);
    }

    // With a lock threshold equal to the limiter's, the next request is the limiter (429), so the
    // "correct password while locked" check applies only when the lock comes earlier.
    if (lockAfter !== null && lockAfter < LIMITER_FAILURES) {
      const refused = await this.attemptLogin({ route, login, clock });
      failed++;
      if (refused.status !== 401 || refused.code !== 'ACCOUNT_LOCKED') {
        failures.push(`${label} correct password while locked: HTTP ${refused.status}, expected 401 ACCOUNT_LOCKED`);
      }
      else if ((refused.decoded?.Error ?? '') !== lockedMessage) {
        failures.push(`${label} correct password while locked: the wording differs from the wrong-password lock answer`);
      }
      const names = (await this.cookieFlags()).map(cookie => cookie.name);
      if (names.includes('access_token')) {
        failures.push(`${label} correct password while locked: a session cookie was issued`);
      }
    }

    // Reach the address limiter threshold (a lock threshold below it leaves failures to spend)
    while (failed < LIMITER_FAILURES) {
      const extra = await this.attemptLogin({ route, login: wrong, clock });
      failed++;
      if (extra.status !== 401) {
        failures.push(`${label} extra attempt #${failed}: HTTP ${extra.status}, expected 401`);
      }
    }

    const limited = await this.attemptLogin({ route, login: wrong, clock });
    if (limited.status !== 429) {
      failures.push(`${label} attempt after ${LIMITER_FAILURES} failures: HTTP ${limited.status}, expected 429`);
    }
    if (limited.status === 429 && !this.validRetryAfter(limited.headers['retry-after'])) {
      failures.push(`${label} retry-after header: ${limited.headers['retry-after'] === undefined ? 'absent' : 'not a positive number of seconds or an HTTP date'} on the 429`);
    }
    return failures;
  }

  // ============================================
  // ATCs
  // ============================================

  /**
   * SEC-005: the session cookies are configured with the protective flags.
   *
   * Own crypto session and ONE positive Administrator login. From the cookie jar
   * (attributes only, values are never read): `access_token` HttpOnly, Secure,
   * SameSite Strict, path `/`; `refresh_token` HttpOnly, Secure, Strict, path `/api`;
   * `csrf_token` NOT HttpOnly (the SPA reads it, double submit by design), Secure,
   * Strict, path `/`. After the logout the three cookies are gone from the jar.
   * Second row: the same checks on the cookies set by the TENANT-USER login of a
   * GENERATED UserApp (the caller passes it, ADR-0019; one positive login, no failed
   * login, no e-mail). ONE ATC call runs both rows (Administrator, then UserApp), so the
   * single case result is FAIL when either row fails; messages are prefixed with the row
   * name. Failures are thrown once.
   */
  @atc('SEC-005')
  async setSessionCookieFlags(target: CookieFlagsTarget): Promise<void> {
    const failures: string[] = [];
    const rows: CookieFlagsRow[] = [
      { label: 'Admin', signIn: async () => this.openAdministratorSession() },
      {
        label: 'UserApp',
        signIn: async () => {
          await this.openCryptoSession();
          return this.signInTenantUser({ UserName: target.userApp.username, Password: target.userApp.password });
        },
      },
    ];
    for (const row of rows) {
      failures.push(...await this.cookieFlagsRow(row));
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} session cookie checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * SEC-007: secrets and keys do not appear on the API channel.
   *
   * Own crypto session and ONE positive Administrator login (no failed logins).
   * Checks, accumulated and thrown once with field paths only: (1) the decrypted
   * login body carries no token or JWT (the cookie is the only carrier; EXPECTED TO
   * FAIL on the current non-Production target, NFR-SEC-011), and it does not carry the
   * Administrator password; (2) the reads of a generated tenant, a generated UserApp, a
   * generated non-root platform Admin and the admins list (searched by the generated Admin)
   * expose no clear field under a secret-like name or JWT shape and their bodies carry none of
   * the generated secrets (the tenant DbPassword, the UserApp and Admin passwords);
   * (3) an invalid create that carries a generated secret answers 400 or 422 (otherwise
   * the check is inconclusive) and does not echo it in the body (decoded or raw text) or headers;
   * (4) no response header named Authorization; (5) the secret is not readable in
   * the encrypted request. Not covered: backend logs (Q3) and browser console or
   * storage (Q4). The caller passes the generated UserApp and Admin
   * (ADR-0019, prepared and removed by the spec); all reads run as the Administrator. The
   * generated tenant is soft-deleted in `finally` (searched by its generated RNEC when the
   * create returned no id); a failed delete is a failure.
   */
  @atc('SEC-007')
  async keepSecretsOutOfResponses(target: SecretReadTarget): Promise<void> {
    const failures: string[] = [];
    const login = await this.openAdministratorSession();
    const secret = this.data.createActivationPassword();
    const payload = this.data.createTenantPayload({ DbPassword: secret });
    let tenantId: number | null = null;

    try {
      failures.push(...this.secretLocations(login.Data, 'login body').map(path => `${path}: clear credential`));
      if (this.carries(JSON.stringify(login), this.config.testUser.password)) {
        failures.push('login body: carries the Administrator password');
      }

      tenantId = await this.createGeneratedTenant(payload);
      if (tenantId === null) {
        failures.push('generated tenant could not be created, the read check did not run');
      }
      else {
        const read = await this.readGeneratedTenant(tenantId);
        if (read.status !== 200) {
          failures.push(`tenant read answered HTTP ${read.status}, the read check did not run`);
        }
        failures.push(...this.secretLocations(read.data, 'tenant read').map(path => `${path}: clear credential`));
        if (this.carries(read.text, secret)) {
          failures.push('tenant read body: carries the generated DbPassword');
        }
      }

      const { userApp, admin } = target;
      const generatedSecrets = [{ what: 'UserApp password', value: userApp.password }, { what: 'Admin password', value: admin.password }];
      const adminsList = new URLSearchParams({ Page: '1', PageSize: '50', SearchTerm: admin.username });
      for (const probe of [
        { location: 'userapp read', endpoint: `/tenants/${target.tenantId}/appusers/${userApp.id}`, secrets: generatedSecrets },
        { location: 'admin read', endpoint: `/User/${admin.id}`, secrets: generatedSecrets },
        { location: 'admins list', endpoint: `/User?${adminsList.toString()}`, secrets: generatedSecrets },
      ]) {
        failures.push(...await this.probeBody(probe));
      }

      failures.push(...await this.probeErrorEcho(secret));

      const [response] = await this.secureGET<unknown>(`${TENANTS}/${tenantId ?? 0}`);
      failures.push(...this.forbiddenHeaders(response.headers()));
    }
    finally {
      failures.push(...await this.removeGeneratedTenant(tenantId, payload.Rnec));
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} secret exposure checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * SEC-008: brute force on the login is answered with a lock and a rate limit.
   *
   * The caller passes GENERATED accounts (ADR-0019): a UserApp of a tenant with a
   * failed-login limit of 3 and a non-root platform Admin, plus the global Admin
   * threshold (read first through the Administrator API). The real Administrator and
   * the real TenantAdmin never receive a wrong password. Rows, in order: UserApp
   * (tenant login), then Admin (admin login). Per row: a positive login proves the
   * account works; wrong passwords up to the lock (the last one answers 401
   * ACCOUNT_LOCKED); the CORRECT password is still refused as locked with the same
   * wording; once 4 failures are spent the next attempt answers 429 (address limiter).
   * If the Admin threshold is greater than 4 (or below 1) the limiter trips before the
   * lock, so the Admin row asserts only the limiter; at exactly 4 the lock answers on the
   * 4th failure and the next request is the limiter (no correct-password-while-locked check). The answers must not echo the user name
   * and the wrong-credentials wording must be stable. Each 429 must carry `Retry-After`
   * (a positive number of seconds or an HTTP date); a missing or invalid one fails the
   * sub-check `<row> retry-after header`. EXPECTED TO FAIL on exactly those two sub-checks
   * (UserApp and Admin): the backend sends no `Retry-After` (known defect HAL-10, also AUT-010);
   * any other failing sub-check is a test bug. The limiter window is waited out between rows and in `finally` (elapsed time
   * since the LAST attempt, ~31 s) so later runs are not blocked.
   */
  @atc('SEC-008')
  async lockAndThrottleBruteForceLogins(target: BruteForceTarget): Promise<void> {
    const clock: AttemptClock = { lastAt: undefined };
    const failures: string[] = [];
    let bodyPassed = false;
    let releaseError: unknown;
    const rows: BruteForceRow[] = [
      { label: 'UserApp', route: this.tenantLoginEndpoint, login: target.userApp, lockAfter: 3 },
      {
        label: 'Admin',
        route: this.config.auth.adminLoginEndpoint,
        login: target.admin,
        lockAfter: target.adminThreshold >= 1 && target.adminThreshold <= LIMITER_FAILURES ? target.adminThreshold : null,
      },
    ];

    try {
      for (const [index, row] of rows.entries()) {
        if (index > 0) {
          await this.awaitLimiterRelease(clock.lastAt);
        }
        failures.push(...await this.bruteForceRow(row, clock));
      }
      if (failures.length > 0) {
        throw new Error(`${failures.length} brute-force checks failed. ${failures.join('; ')}`);
      }
      bodyPassed = true;
    }
    finally {
      releaseError = await this.signOutAndReleaseLimiter(clock.lastAt, bodyPassed);
    }
    if (releaseError !== undefined) {
      throw releaseError;
    }
  }
}
