/**
 * KATA Architecture - Layer 3: UserApps API Component
 *
 * Test-data helpers for generated UserApps (ADR-0019). `createUserApp`,
 * `setUserAppActive` and `deleteUserApp` carry no ATC. `unlockUserApp` is a
 * step helper; the case that is itself the unlock (AUT-011, `unlockLockedUserApp`)
 * wraps it. Deletion is soft.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - POST   /tenants/{tenantId}/appusers               - create
 * - PUT    /tenants/{tenantId}/appusers/{id}          - update (IsActive)
 * - DELETE /tenants/{tenantId}/appusers/{id}          - soft delete
 * - PATCH  /tenants/{tenantId}/appusers/{id}/unlock   - clear a lockout
 */

import type { APIResponse } from '@playwright/test';
import type {
  ApiEnvelope,
  CreatedEntityData,
  CreateUserAppPayload,
  LoginPayload,
  UpdateUserAppPayload,
} from '@schemas/auth.types';

import type { BulkImportResultData, UserAppData } from '@schemas/resources.types';
import type { PagedData } from '@schemas/security.types';

import { AuthApi } from '@api/AuthApi';
import { SecureApi } from '@api/SecureApi';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { atc, step } from '@utils/decorators';

/** A generated UserApp and the tenant it belongs to (flat: the step decorator masks `password`). */
export interface LockedUserApp {
  tenantId: number
  userAppId: number
  username: string
  password: string
}

/**
 * One row of a UAP input case. `reject` rows must answer `status` (400), `Ok` false, `code` (`VALIDATION_ERROR`) and carry
 * `message`, and create nothing; `accept` rows must answer 200. `tenantId` overrides the case's tenant (UAP-005). The
 * payload carries a password: it is built lazily and never reaches a message.
 */
interface UserAppInputRow {
  label: string
  tenantId?: number
  payload: (control: CreateUserAppPayload) => object
  outcome: 'reject' | 'accept'
  status?: number
  code?: string
  message: RegExp
}

/** The backend's length refusal ("Maximo N caracteres"). */
const LENGTH_MESSAGE = /M.ximo \d+ caracteres/i;
const USERNAME_MESSAGE = /username solo puede contener/i;

/** The validation message each weak-password row must carry (`ApplyPasswordRules`, no special character). */
const WEAK_PASSWORD_MESSAGES: Record<string, RegExp> = {
  'min-length': /M.nimo 8/i,
  'uppercase': /may.scula/i,
  'lowercase': /min.scula/i,
  'digit': /n.mero/i,
  'empty': /requerida/i,
};

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class UserAppsApi extends SecureApi {
  /** Create a UserApp in a tenant. Fixed assertions: 200, `Ok`, an id in `Data`. Step title masks `Password`. */
  @step
  async createUserApp(
    tenantId: number,
    payload: CreateUserAppPayload,
  ): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const [response, body] = await this.securePOST<CreatedEntityData, CreateUserAppPayload>(
      `/tenants/${tenantId}/appusers`,
      payload,
    );

    expect(response.status(), `create userapp: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  /** Activate or deactivate a UserApp. Fixed assertions: 200, `Ok`. */
  @step
  async setUserAppActive(
    target: { tenantId: number, userAppId: number, isActive: boolean },
  ): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const { tenantId, userAppId, isActive } = target;
    const [response, body] = await this.securePUT<unknown, UpdateUserAppPayload>(
      `/tenants/${tenantId}/appusers/${userAppId}`,
      { IsActive: isActive },
    );

    expect(response.status(), `update userapp: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /** Soft-delete a UserApp. Fixed assertions: 200, `Ok`. */
  @step
  async deleteUserApp(tenantId: number, userAppId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.secureDELETE<unknown>(`/tenants/${tenantId}/appusers/${userAppId}`);

    expect(response.status(), `delete userapp: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /** Clear the lockout of a UserApp. Fixed assertions: 200, `Ok`. Step of AUT-011 (run by the Administrator session). */
  @step
  async unlockUserApp(tenantId: number, userAppId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.securePATCH<unknown>(`/tenants/${tenantId}/appusers/${userAppId}/unlock`);

    expect(response.status(), `unlock userapp: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /**
   * One encrypted tenant login on the CURRENT crypto session. Returns the raw
   * answer so the caller decides what to assert. Undecorated: the payload
   * carries a password and the body (on success) carries session tokens.
   */
  private async tenantLogin(credentials: LoginPayload): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.securePOST<unknown, LoginPayload>(this.tenantLoginEndpoint, credentials);
  }

  /** Sign out and open a NEW crypto session (logout drops the previous one). */
  private async signOutAndReopenSession(): Promise<void> {
    const [response, body] = await this.postLogout();
    expect(response.status()).toBe(200);
    expect(body.Ok).toBe(true);
    await this.openCryptoSession();
  }

  /**
   * Unlock a UserApp as the platform Administrator in a SEPARATE request
   * context (own cookie jar and crypto session), so the tenant-user session of
   * the ATC and the shared administrator session are both left alone. Always
   * signs out and disposes the context.
   */
  private async unlockAsAdministrator(tenantId: number, userAppId: number): Promise<void> {
    const adminContext = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    const adminAuth = new AuthApi({ request: adminContext });
    try {
      const [, , session] = await adminAuth.startAdminSession({
        UserName: this.config.testUser.email,
        Password: this.config.testUser.password,
      });
      const adminUserApps = new UserAppsApi({ request: adminContext });
      adminUserApps.setCryptoSession(session);
      await adminUserApps.unlockUserApp(tenantId, userAppId);
    }
    finally {
      await adminAuth.logout().catch(() => undefined);
      await adminContext.dispose().catch(() => undefined);
    }
  }

  /**
   * Wait until the address limiter window (4 failed logins in 30 s) has cleared.
   * Condition-based on elapsed time (~31 s from the LAST failure), never a fixed sleep.
   */
  private async releaseLimiterWindow(lastFailureAt: number | undefined): Promise<void> {
    if (lastFailureAt === undefined) {
      return;
    }
    await expect.poll(() => Date.now() - lastFailureAt, { timeout: 35000, intervals: [500] })
      .toBeGreaterThanOrEqual(31000);
  }

  /**
   * AUT-011: after the Administrator unlocks a locked UserApp it can sign in again.
   *
   * The caller passes a GENERATED UserApp whose tenant has a failed-login limit
   * of 3, on an empty cookie jar (own session). Flow: a correct tenant login
   * proves the account works (positive control) and is signed out; three wrong
   * passwords lock it (the third answer is 401 ACCOUNT_LOCKED, below the address
   * limiter of 4 failures / 30 s); the Administrator calls
   * `PATCH /tenants/{id}/appusers/{id}/unlock`; the correct login answers 200 and
   * issues the session cookies. Wrong passwords never reach the real account. The
   * limiter window is waited out in `finally`, measured from the LAST wrong
   * login. That wait (~31 s) plus the flow exceeds the global 60 s timeout, so the
   * spec sets its own.
   */
  @atc('AUT-011')
  async unlockLockedUserApp(userApp: LockedUserApp): Promise<void> {
    const correct: LoginPayload = { UserName: userApp.username, Password: userApp.password };
    const wrong: LoginPayload = { UserName: userApp.username, Password: this.data.createWrongPassword() };
    let lastFailureAt: number | undefined;
    let bodyPassed = false;
    let releaseError: unknown;

    try {
      await this.openCryptoSession();
      await this.signInTenantUser(correct);
      await this.signOutAndReopenSession();

      const expectedCodes = ['INVALID_CREDENTIALS', 'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED'];
      for (const expectedCode of expectedCodes) {
        const [response, body] = await this.tenantLogin(wrong);
        lastFailureAt = Date.now();
        expect(response.status()).toBe(401);
        expect(body.CodeError).toBe(expectedCode);
      }

      await this.unlockAsAdministrator(userApp.tenantId, userApp.userAppId);

      await this.signInTenantUser(correct);
      bodyPassed = true;
    }
    finally {
      await this.postLogout().catch(() => undefined);
      try {
        await this.releaseLimiterWindow(lastFailureAt);
      }
      catch (error) {
        releaseError = error;
        if (!bodyPassed) {
          // A failed body keeps its own error; leave a note instead
          test.info().annotations.push({ type: 'release-failed', description: 'address limiter window not confirmed released' });
        }
      }
    }
    // Reached only when the body passed: then a release failure is the failure
    if (releaseError !== undefined) {
      throw releaseError;
    }
  }

  // ============================================
  // Non-asserting helpers (UAP cases): they return the answer, the ATC judges it
  // ============================================

  /** Create a UserApp with ANY body; asserts nothing. NOT a `@step`: the payload carries a password and may be hostile. */
  async attemptCreateUserApp(tenantId: number, payload: object): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    return this.securePOST<CreatedEntityData, object>(`/tenants/${tenantId}/appusers`, payload);
  }

  /** Update a UserApp with ANY body; asserts nothing. NOT a `@step`: the payload may carry a password. */
  async attemptUpdateUserApp(tenantId: number, userAppId: number, payload: object): Promise<[APIResponse, ApiEnvelope<UserAppData>]> {
    return this.securePUT<UserAppData, object>(`/tenants/${tenantId}/appusers/${userAppId}`, payload);
  }

  /** Soft-delete a UserApp; asserts nothing (cleanup tolerates one that is already gone). */
  async attemptDeleteUserApp(tenantId: number, userAppId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/tenants/${tenantId}/appusers/${userAppId}`);
  }

  /** Read one UserApp; asserts nothing. */
  async getUserApp(tenantId: number, userAppId: number): Promise<[APIResponse, ApiEnvelope<UserAppData>]> {
    return this.secureGET<UserAppData>(`/tenants/${tenantId}/appusers/${userAppId}`);
  }

  /** List a tenant's UserApps; asserts nothing. */
  async listUserApps(tenantId: number, query: { page?: number, pageSize?: number, searchTerm?: string } = {}): Promise<[APIResponse, ApiEnvelope<PagedData<UserAppData>>]> {
    const params = new URLSearchParams();
    if (query.page !== undefined) { params.set('Page', String(query.page)); }
    if (query.pageSize !== undefined) { params.set('PageSize', String(query.pageSize)); }
    if (query.searchTerm !== undefined) { params.set('SearchTerm', query.searchTerm); }
    const text = params.toString();
    return this.secureGET<PagedData<UserAppData>>(`/tenants/${tenantId}/appusers${text === '' ? '' : `?${text}`}`);
  }

  /** Upload one CSV file (multipart, not encrypted); asserts nothing. The answer carries temporary passwords: never print it. */
  async importCsv(tenantId: number, file: { name: string, content: string }): Promise<[APIResponse, ApiEnvelope<BulkImportResultData>]> {
    return this.secureMultipartPOST<BulkImportResultData>(`/tenants/${tenantId}/appusers/import-csv`, {
      name: file.name,
      mimeType: 'text/csv',
      buffer: Buffer.from(file.content, 'utf8'),
    });
  }

  // ============================================
  // Internals shared by the UAP ATCs
  // ============================================

  /** First line of an error, for a failure list (no stack, no call log, never a credential). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** The UserApp id an answer created, or 0. */
  private createdId(body: ApiEnvelope<CreatedEntityData>): number {
    const id = body.Data?.Id;
    return typeof id === 'number' && id > 0 ? id : 0;
  }

  /** Delete generated UserApps, tolerating the ones already gone (404). Returns one line per failure. */
  private async cleanupUserApps(tenantId: number, ids: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const [response] = await this.attemptDeleteUserApp(tenantId, id);
        if (response.status() !== 200 && response.status() !== 404) {
          failures.push(`delete userapp #${id}: HTTP ${response.status()}`);
        }
      }
      catch (error) {
        failures.push(`delete userapp #${id}: ${this.firstLine(error)}`);
      }
    }
    return failures;
  }

  /** Create a UserApp and record its id for cleanup BEFORE judging the answer. */
  private async createTrackedUserApp(tenantId: number, payload: object, ids: number[]): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const answer = await this.attemptCreateUserApp(tenantId, payload);
    const id = this.createdId(answer[1]);
    if (id > 0) {
      ids.push(id);
    }
    return answer;
  }

  /**
   * ONE tenant sign-in in its OWN request context (own cookie jar and crypto session): the Administrator session of
   * the ATC is left alone. A 200 is signed out. Returns only the status and the error code, never a token. Undecorated:
   * the credentials are a secret.
   */
  private async tenantSignIn(credentials: LoginPayload): Promise<{ status: number, code: string | null }> {
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const probe = new UserAppsApi({ request: context });
      await probe.openCryptoSession();
      const [response, body] = await probe.tenantLogin(credentials);
      if (response.status() === 200) {
        await probe.postLogout().catch(() => undefined);
      }
      return { status: response.status(), code: body.CodeError ?? null };
    }
    finally {
      await context.dispose().catch(() => undefined);
    }
  }

  /** Common frame of the UAP ATCs: one Administrator session, collected failures, cleanup of what the body created, one thrown error. */
  private async runUserAppCase(args: { what: string, tenantIds: number[], body: (created: Map<number, number[]>, failures: string[]) => Promise<void> }): Promise<void> {
    const created = new Map<number, number[]>(args.tenantIds.map(id => [id, []]));
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      await args.body(created, failures);
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      for (const [tenantId, ids] of created) {
        failures.push(...await this.cleanupUserApps(tenantId, ids));
      }
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * Shared body of the UAP input cases. Own crypto session, ONE positive Administrator login. The positive control
   * first (a valid UserApp), then every row. A `reject` row must answer its status (400 unless set), `Ok` false, its
   * code (`VALIDATION_ERROR` unless set) and carry its message, and create nothing: the tenant's UserApp total must
   * equal the base plus what was created so far. An `accept` row must answer 200. A rejected row the product wrongly
   * accepts is tracked and reported, and the loop goes on. Everything created is deleted before the session closes.
   * Failure lines name the row and the status only: payloads carry passwords and never reach a message.
   */
  private async runUserAppInput(args: { tenantId: number, rows: UserAppInputRow[], what: string, otherTenantId?: number }): Promise<void> {
    const { tenantId } = args;
    await this.runUserAppCase({
      what: args.what,
      tenantIds: args.otherTenantId === undefined ? [tenantId] : [tenantId, args.otherTenantId],
      body: async (created, failures) => {
        const ids = created.get(tenantId)!;
        const [, base] = await this.listUserApps(tenantId, { pageSize: 1 });
        const baseTotal = base.Data?.TotalRecords ?? 0;
        const control = this.data.createUserAppPayload();
        const [controlResponse, controlBody] = await this.createTrackedUserApp(tenantId, control, ids);
        expect(controlResponse.status(), `control (valid UserApp): ${controlBody.CodeError ?? 'no error code'}`).toBe(200);

        for (const row of args.rows) {
          try {
            const rowTenantId = row.tenantId ?? tenantId;
            const rowIds = created.get(rowTenantId) ?? ids;
            const payload = row.payload(control);
            const [response, body] = await this.createTrackedUserApp(rowTenantId, payload, rowIds);
            const status = response.status();
            const id = this.createdId(body);
            if (row.outcome === 'accept') {
              if (status !== 200 || body.Ok !== true || id === 0) {
                failures.push(`${row.label}: expected ACCEPTED (200), got HTTP ${status} ${body.CodeError ?? 'no error code'}`);
              }
              continue;
            }
            if (id > 0) {
              failures.push(`${row.label}: the product ACCEPTED the create (HTTP ${status}, ${body.CodeError ?? 'no error code'})`);
              continue;
            }
            const expectedStatus = row.status ?? 400;
            const expectedCode = row.code ?? 'VALIDATION_ERROR';
            const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
            if (status !== expectedStatus || body.Ok !== false || body.CodeError !== expectedCode) {
              failures.push(`${row.label}: HTTP ${status} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected ${expectedStatus}, false, ${expectedCode})`);
            }
            else if (!row.message.test(text)) {
              failures.push(`${row.label}: HTTP ${status} ${expectedCode}, the message ${row.message} is missing`);
            }
            const [, list] = await this.listUserApps(tenantId, { pageSize: 1 });
            const createdHere = ids.length;
            if ((list.Data?.TotalRecords ?? 0) !== baseTotal + createdHere) {
              failures.push(`${row.label}: the UserApp total changed after the rejected create`);
            }
          }
          catch (error) {
            failures.push(`row ${row.label}: ${this.firstLine(error)}`);
          }
        }
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): input validation (UAP-002 .. UAP-008)
  // ============================================

  /** UAP-002: usernames that use `@`, `#`, `/`, `\`, dots, hyphens and underscores with letters and digits are accepted. */
  @atc('UAP-002')
  async acceptUsernameSymbols(tenantId: number): Promise<void> {
    const rows: UserAppInputRow[] = this.data.createSymbolUsernames().map(row => ({
      label: `username (${row.label})`,
      payload: () => this.data.createUserAppPayload({ UserName: row.value }),
      outcome: 'accept' as const,
      message: USERNAME_MESSAGE,
    }));
    await this.runUserAppInput({ tenantId, rows, what: 'username symbols' });
  }

  /** UAP-003: a username with a space, an accent, `;` or `$` is refused (400 `VALIDATION_ERROR` naming the allowed characters); nothing is created. */
  @atc('UAP-003')
  async rejectUsernameInvalidCharacters(tenantId: number): Promise<void> {
    const rows: UserAppInputRow[] = this.data.createInvalidUsernames().map(row => ({
      label: `username (${row.label})`,
      payload: () => this.data.createUserAppPayload({ UserName: row.value }),
      outcome: 'reject' as const,
      message: USERNAME_MESSAGE,
    }));
    await this.runUserAppInput({ tenantId, rows, what: 'username characters' });
  }

  /**
   * UAP-004: invalid username lengths. Control first, then empty, whitespace only and 256 characters (each 400
   * `VALIDATION_ERROR`, nothing created) and, LAST, a username of exactly 255 characters must be ACCEPTED (documented
   * limit; the backend limit is 40, so this row fails today).
   */
  @atc('UAP-004')
  async rejectInvalidUsernameLengths(tenantId: number): Promise<void> {
    const rows: UserAppInputRow[] = [
      { label: 'username (empty)', payload: () => this.data.createUserAppPayload({ UserName: '' }), outcome: 'reject', message: /username.*requerido/i },
      { label: 'username (whitespace only)', payload: () => this.data.createUserAppPayload({ UserName: '   ' }), outcome: 'reject', message: /username.*requerido/i },
      { label: 'username (256 characters)', payload: () => this.data.createUserAppPayload({ UserName: this.data.createUsernameOfLength(256) }), outcome: 'reject', message: LENGTH_MESSAGE },
      { label: 'username (255 characters, documented limit)', payload: () => this.data.createUserAppPayload({ UserName: this.data.createUsernameOfLength(255) }), outcome: 'accept', message: LENGTH_MESSAGE },
    ];
    await this.runUserAppInput({ tenantId, rows, what: 'username length' });
  }

  /**
   * UAP-005: the username is unique in the whole system. The same username in the same tenant and in ANOTHER tenant is refused (400 `USERAPP_USERNAME_DUPLICATE_GLOBAL`); nothing is created.
   */
  @atc('UAP-005')
  async enforceGlobalUsernameUniqueness(args: { tenantId: number, otherTenantId: number }): Promise<void> {
    const duplicate = (label: string, tenantId: number | undefined, change: (name: string) => string): UserAppInputRow => ({
      label,
      tenantId,
      payload: control => this.data.createUserAppPayload({ UserName: change(String(control.UserName)) }),
      outcome: 'reject',
      code: 'USERAPP_USERNAME_DUPLICATE_GLOBAL',
      message: /username/i,
    });
    const rows: UserAppInputRow[] = [
      duplicate('same username, same tenant', undefined, name => name),
      duplicate('same username, another tenant', args.otherTenantId, name => name),
    ];
    await this.runUserAppInput({ tenantId: args.tenantId, otherTenantId: args.otherTenantId, rows, what: 'username uniqueness' });
  }

  /** UAP-006: weak passwords (shorter than 8, no upper case, no lower case, no digit, empty) are refused naming the rule; nothing is created. The value never reaches a message. */
  @atc('UAP-006')
  async rejectWeakPasswords(tenantId: number): Promise<void> {
    const rows: UserAppInputRow[] = this.data.createWeakPasswords().map(row => ({
      label: `password (${row.rule})`,
      payload: () => this.data.createUserAppPayload({ Password: row.value }),
      outcome: 'reject' as const,
      message: WEAK_PASSWORD_MESSAGES[row.rule],
    }));
    await this.runUserAppInput({ tenantId, rows, what: 'password strength' });
  }

  /** UAP-007: an invalid e-mail (no at sign, no domain dot, a space, 256 characters) is refused; a valid one, an empty one and an omitted one are accepted (no mail is sent). */
  @atc('UAP-007')
  async validateEmails(tenantId: number): Promise<void> {
    const id = () => this.data.createUsernameOfLength(14).slice(6);
    const rows: UserAppInputRow[] = [
      ...this.data.createInvalidEmails().map(row => ({
        label: `e-mail (${row.label})`,
        payload: () => this.data.createUserAppPayload({ Email: row.value }),
        outcome: 'reject' as const,
        message: /correo|M.ximo/i,
      })),
      { label: 'e-mail (valid)', payload: () => this.data.createUserAppPayload({ Email: `qa.${id()}@example.com` }), outcome: 'accept', message: /correo/i },
      { label: 'e-mail (empty)', payload: () => this.data.createUserAppPayload({ Email: '' }), outcome: 'accept', message: /correo/i },
      { label: 'e-mail (omitted)', payload: () => this.data.createUserAppPayload(), outcome: 'accept', message: /correo/i },
    ];
    await this.runUserAppInput({ tenantId, rows, what: 'e-mail' });
  }

  /**
   * UAP-008: an oversized name or position. Control first, then a name of 101 and a position of 101 characters (each
   * 400 `VALIDATION_ERROR`, nothing created) and, LAST, a position of exactly 100 and a name of exactly 100 accepted (the
   * name row fails today: the backend limit is 60).
   */
  @atc('UAP-008')
  async rejectOversizedNameAndPosition(tenantId: number): Promise<void> {
    const rows: UserAppInputRow[] = [
      { label: 'name (101 characters)', payload: () => this.data.createUserAppPayload({ FullName: this.data.createDeviceNameOfLength(101) }), outcome: 'reject', message: LENGTH_MESSAGE },
      { label: 'position (101 characters)', payload: () => this.data.createUserAppPayload({ Position: this.data.createDeviceNameOfLength(101) }), outcome: 'reject', message: LENGTH_MESSAGE },
      { label: 'position (100 characters, limit)', payload: () => this.data.createUserAppPayload({ Position: this.data.createDeviceNameOfLength(100) }), outcome: 'accept', message: LENGTH_MESSAGE },
      { label: 'name (100 characters, documented limit)', payload: () => this.data.createUserAppPayload({ FullName: this.data.createDeviceNameOfLength(100) }), outcome: 'accept', message: LENGTH_MESSAGE },
    ];
    await this.runUserAppInput({ tenantId, rows, what: 'name and position' });
  }

  // ============================================
  // Test Cases (ATCs): catalog (UAP-001, 009, 010)
  // ============================================

  /**
   * UAP-001: create a UserApp with username, password, e-mail, name and position. The answer is 200 and `Ok`; the
   * UserApp is active, not locked, belongs to the tenant, keeps username, name and position as sent, stores the e-mail in
   * lower case and has `CreatedBy`. It is found by `GET {id}` and by the username search (exactly 1 match).
   */
  @atc('UAP-001')
  async createUserAppWithUsernamePasswordAndOptionals(tenantId: number): Promise<void> {
    const sent = this.data.createUserAppPayload({
      Email: `QA.${this.data.createUsernameOfLength(14).slice(6)}@Example.com`,
      Position: 'QAX analista',
    });
    await this.runUserAppCase({
      what: 'userapp create',
      tenantIds: [tenantId],
      body: async (created, failures) => {
        const ids = created.get(tenantId)!;
        const [response, body] = await this.createTrackedUserApp(tenantId, sent, ids);
        verify(failures, response.status() === 200 && body.Ok === true && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        if (ids.length !== 1) {
          return;
        }
        const [readResponse, read] = await this.getUserApp(tenantId, ids[0]);
        const user = read.Data;
        verify(failures, readResponse.status() === 200 && user !== undefined, `read by id: HTTP ${readResponse.status()}`);
        if (user) {
          verify(failures, user.IsActive === true && user.IsLockedOut === false, 'read: the UserApp is not active or is locked');
          verify(failures, user.TenantId === tenantId, 'read: tenant differs');
          verify(failures, user.UserName === sent.UserName && user.FullName === sent.FullName && user.Position === sent.Position, 'read: username, name or position differ from what was sent');
          verify(failures, user.Email === String(sent.Email).toLowerCase(), 'read: the e-mail is not stored in lower case');
          verify(failures, typeof user.CreatedBy === 'string' && user.CreatedBy !== '', 'read: CreatedBy is not set');
        }
        const [listResponse, list] = await this.listUserApps(tenantId, { searchTerm: sent.UserName ?? '', pageSize: 10 });
        verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 1 && list.Data.Data[0]?.Id === ids[0], `search by username: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 1 and the created UserApp)`);
      },
    });
  }

  /**
   * UAP-009: edit with an empty password. A PUT that sends no password and a new name answers 200, the new name reads
   * back, the username is unchanged and the UserApp still signs in with its ORIGINAL password (one positive login, and
   * one before the edit as control).
   */
  @atc('UAP-009')
  async keepPasswordWhenEditedWithoutPassword(tenantId: number): Promise<void> {
    const sent = this.data.createUserAppPayload();
    const credentials: LoginPayload = { UserName: sent.UserName, Password: sent.Password };
    await this.runUserAppCase({
      what: 'userapp edit without password',
      tenantIds: [tenantId],
      body: async (created, failures) => {
        const ids = created.get(tenantId)!;
        const [response, body] = await this.createTrackedUserApp(tenantId, sent, ids);
        verify(failures, response.status() === 200 && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        if (ids.length !== 1) {
          return;
        }
        const control = await this.tenantSignIn(credentials);
        verify(failures, control.status === 200, `control sign-in before the edit: HTTP ${control.status} ${control.code ?? 'no error code'}`);

        const newName = `QAX editado ${this.data.createUsernameOfLength(12).slice(6)}`;
        const [editResponse, edited] = await this.attemptUpdateUserApp(tenantId, ids[0], { FullName: newName });
        verify(failures, editResponse.status() === 200 && edited.Ok === true, `edit without password: HTTP ${editResponse.status()} ${edited.CodeError ?? 'no error code'}`);
        const [readResponse, read] = await this.getUserApp(tenantId, ids[0]);
        verify(failures, readResponse.status() === 200 && read.Data?.FullName === newName && read.Data.UserName === sent.UserName, 'read after edit: name is not the new value or the username changed');

        const after = await this.tenantSignIn(credentials);
        verify(failures, after.status === 200, `sign-in with the ORIGINAL password after the edit: HTTP ${after.status} ${after.code ?? 'no error code'} (expected 200)`);
      },
    });
  }

  /**
   * UAP-010: a deactivated UserApp cannot sign in. Control: one positive sign-in. `IsActive` false answers 200 and reads
   * back; the sign-in with the CORRECT password is then refused (401 `USERAPP_INACTIVE`); re-activating answers 200 and the
   * sign-in works again. (One refused login, below the address limiter; its window is waited out at the end.)
   */
  @atc('UAP-010')
  async refuseSignInOfDeactivatedUserApp(tenantId: number): Promise<void> {
    const sent = this.data.createUserAppPayload();
    const credentials: LoginPayload = { UserName: sent.UserName, Password: sent.Password };
    let lastFailureAt: number | undefined;
    try {
      await this.runUserAppCase({
        what: 'deactivated userapp',
        tenantIds: [tenantId],
        body: async (created, failures) => {
          const ids = created.get(tenantId)!;
          const [response, body] = await this.createTrackedUserApp(tenantId, sent, ids);
          verify(failures, response.status() === 200 && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          if (ids.length !== 1) {
            return;
          }
          const control = await this.tenantSignIn(credentials);
          verify(failures, control.status === 200, `control sign-in while active: HTTP ${control.status} ${control.code ?? 'no error code'}`);

          const [offResponse, off] = await this.attemptUpdateUserApp(tenantId, ids[0], { IsActive: false });
          verify(failures, offResponse.status() === 200 && off.Ok === true, `deactivate: HTTP ${offResponse.status()} ${off.CodeError ?? 'no error code'}`);
          const [offReadResponse, offRead] = await this.getUserApp(tenantId, ids[0]);
          verify(failures, offReadResponse.status() === 200 && offRead.Data?.IsActive === false, 'after the deactivation, the UserApp reads IsActive=true');

          const refused = await this.tenantSignIn(credentials);
          lastFailureAt = Date.now();
          verify(failures, refused.status === 401 && refused.code === 'USERAPP_INACTIVE', `sign-in while inactive: HTTP ${refused.status} ${refused.code ?? 'no error code'} (expected 401 USERAPP_INACTIVE)`);

          const [onResponse, on] = await this.attemptUpdateUserApp(tenantId, ids[0], { IsActive: true });
          verify(failures, onResponse.status() === 200 && on.Ok === true, `reactivate: HTTP ${onResponse.status()} ${on.CodeError ?? 'no error code'}`);
          const again = await this.tenantSignIn(credentials);
          verify(failures, again.status === 200, `sign-in after the reactivation: HTTP ${again.status} ${again.code ?? 'no error code'} (expected 200)`);
        },
      });
    }
    finally {
      await this.releaseLimiterWindow(lastFailureAt).catch(() => undefined);
    }
  }

  // ============================================
  // Test Cases (ATCs): lockout (UAP-011)
  // ============================================

  /**
   * UAP-011: the lockout is visible and the unlock works. The tenant has a failed-login limit of 3. Three wrong
   * passwords lock the account (401 `INVALID_CREDENTIALS` twice, then 401 `ACCOUNT_LOCKED`, below the address limiter of 4
   * failures / 30 s); the Administrator read shows `IsLockedOut` true; `PATCH unlock` answers 200 and the read shows
   * `IsLockedOut` false and 0 failed attempts; the correct sign-in works again. The limiter window is waited out at the
   * end, measured from the LAST wrong login (the spec sets its own timeout).
   */
  @atc('UAP-011')
  async showLockoutAndUnlock(tenantId: number): Promise<void> {
    const sent = this.data.createUserAppPayload();
    const correct: LoginPayload = { UserName: sent.UserName, Password: sent.Password };
    const wrong: LoginPayload = { UserName: sent.UserName, Password: this.data.createWrongPassword() };
    let lastFailureAt: number | undefined;
    try {
      await this.runUserAppCase({
        what: 'userapp lockout',
        tenantIds: [tenantId],
        body: async (created, failures) => {
          const ids = created.get(tenantId)!;
          const [response, body] = await this.createTrackedUserApp(tenantId, sent, ids);
          verify(failures, response.status() === 200 && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          if (ids.length !== 1) {
            return;
          }
          const control = await this.tenantSignIn(correct);
          verify(failures, control.status === 200, `control sign-in before the lockout: HTTP ${control.status} ${control.code ?? 'no error code'}`);

          for (const expectedCode of ['INVALID_CREDENTIALS', 'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED']) {
            const refused = await this.tenantSignIn(wrong);
            lastFailureAt = Date.now();
            verify(failures, refused.status === 401 && refused.code === expectedCode, `wrong password: HTTP ${refused.status} ${refused.code ?? 'no error code'} (expected 401 ${expectedCode})`);
          }
          const [lockedResponse, locked] = await this.getUserApp(tenantId, ids[0]);
          verify(failures, lockedResponse.status() === 200 && locked.Data?.IsLockedOut === true, `after 3 wrong passwords, IsLockedOut reads ${String(locked.Data?.IsLockedOut)} (expected true)`);

          const [unlockResponse, unlocked] = await this.securePATCH<unknown>(`/tenants/${tenantId}/appusers/${ids[0]}/unlock`);
          verify(failures, unlockResponse.status() === 200 && unlocked.Ok === true, `unlock: HTTP ${unlockResponse.status()} ${unlocked.CodeError ?? 'no error code'}`);
          const [openResponse, open] = await this.getUserApp(tenantId, ids[0]);
          verify(failures, openResponse.status() === 200 && open.Data?.IsLockedOut === false && open.Data.FailedLoginAttempts === 0, `after the unlock, IsLockedOut=${String(open.Data?.IsLockedOut)} failed attempts=${String(open.Data?.FailedLoginAttempts)} (expected false and 0)`);
          const again = await this.tenantSignIn(correct);
          verify(failures, again.status === 200, `sign-in after the unlock: HTTP ${again.status} ${again.code ?? 'no error code'} (expected 200)`);
        },
      });
    }
    finally {
      await this.releaseLimiterWindow(lastFailureAt).catch(() => undefined);
    }
  }

  // ============================================
  // Test Cases (ATCs): CSV import (UAP-012)
  // ============================================

  /**
   * UAP-012: CSV import, as SUC-011 plus the UserApp rules. A valid file reports Total, Exitosos and no errors, returns
   * one temporary credential per imported row (never printed) and the first one signs in. A mixed file (username with a
   * space, a repeated username, an invalid e-mail, an empty username) reports one `Errores` entry per bad row with its
   * `Fila` and imports the good rows. An empty file answers 400 `CSV_FILE_REQUIRED`, a `.txt` file 400
   * `CSV_INVALID_EXTENSION`, a file without the required header 400 `CSV_INVALID_FORMAT`, and none creates a UserApp.
   * Every imported UserApp is deleted at the end (found by the token in its username).
   */
  @atc('UAP-012')
  async importUserAppsFromCsv(tenantId: number): Promise<void> {
    const token = this.data.createUsernameOfLength(14).slice(6);
    const user = (n: number) => `qa.csv.${token}.${n}`;
    const valid = [{ user: user(1), name: 'QAX uno' }, { user: user(2), email: `qa.csv.${token}.2@example.com` }];
    const mixed = [
      { user: user(3) },
      { user: `qa csv ${token} 4` },
      { user: user(1) },
      { user: user(5), email: 'sin-arroba.example.com' },
      { user: '' },
      { user: user(6) },
    ];
    const expectedErrors = [
      { Fila: 3, Campo: 'Username' },
      { Fila: 4, Campo: 'Username' },
      { Fila: 5, Campo: 'Email' },
      { Fila: 6, Campo: 'Username' },
    ];
    let lastFailureAt: number | undefined;
    try {
      await this.runUserAppCase({
        what: 'userapp CSV import',
        tenantIds: [tenantId],
        body: async (created, failures) => {
          const ids = created.get(tenantId)!;
          try {
            const [validResponse, validBody] = await this.importCsv(tenantId, { name: 'usuarios.csv', content: this.data.createUserAppCsv(valid) });
            const validResult = validBody.Data;
            verify(failures, validResponse.status() === 200 && validResult?.Total === 2 && validResult.Exitosos === 2 && validResult.Fallidos === 0 && validResult.Errores.length === 0, `valid file: HTTP ${validResponse.status()}, total ${String(validResult?.Total)} imported ${String(validResult?.Exitosos)} failed ${String(validResult?.Fallidos)} errors ${String(validResult?.Errores.length)} (expected 2, 2, 0, 0)`);
            const credentials = validResult?.CredencialesGeneradas ?? [];
            verify(failures, credentials.length === 2 && credentials.every(entry => entry.UserName !== '' && entry.PasswordTemporal.length >= 8), `valid file: ${credentials.length} temporary credentials (expected 2, each with a username and a password of 8 or more characters)`);
            const first = credentials.find(entry => entry.UserName === user(1));
            if (first) {
              const signIn = await this.tenantSignIn({ UserName: first.UserName, Password: first.PasswordTemporal });
              verify(failures, signIn.status === 200, `sign-in with a generated temporary password: HTTP ${signIn.status} ${signIn.code ?? 'no error code'} (expected 200)`);
            }
            else {
              failures.push('valid file: no temporary credential for the first imported username');
            }

            const [mixedResponse, mixedBody] = await this.importCsv(tenantId, { name: 'usuarios-mixto.csv', content: this.data.createUserAppCsv(mixed) });
            const mixedResult = mixedBody.Data;
            verify(failures, mixedResponse.status() === 200 && mixedResult?.Total === 6 && mixedResult.Exitosos === 2 && mixedResult.Fallidos === 4, `mixed file: HTTP ${mixedResponse.status()}, total ${String(mixedResult?.Total)} imported ${String(mixedResult?.Exitosos)} failed ${String(mixedResult?.Fallidos)} (expected 6, 2, 4)`);
            for (const expected of expectedErrors) {
              const found = mixedResult?.Errores.find(error => error.Fila === expected.Fila);
              verify(failures, found !== undefined && found.Campo === expected.Campo && found.Mensaje !== '', `mixed file: no error on row ${expected.Fila} for ${expected.Campo} (got ${found ? found.Campo : 'none'})`);
            }
            verify(failures, mixedResult?.Errores.length === expectedErrors.length, `mixed file: ${String(mixedResult?.Errores.length)} error entries (expected ${expectedErrors.length}, one per bad row)`);

            const [beforeResponse, before] = await this.listUserApps(tenantId, { searchTerm: token, pageSize: 50 });
            const refusals = [
              { label: 'empty file', file: { name: 'vacio.csv', content: '' }, code: 'CSV_FILE_REQUIRED' },
              { label: 'non-CSV extension', file: { name: 'usuarios.txt', content: this.data.createUserAppCsv([{ user: user(7) }]) }, code: 'CSV_INVALID_EXTENSION' },
              { label: 'missing header', file: { name: 'sin-encabezado.csv', content: `Nombre,Cargo\nQAX ${token},x` }, code: 'CSV_INVALID_FORMAT' },
            ];
            for (const refusal of refusals) {
              const [response, body] = await this.importCsv(tenantId, refusal.file);
              verify(failures, response.status() === 400 && body.CodeError === refusal.code, `${refusal.label}: HTTP ${response.status()} CodeError=${String(body.CodeError)} (expected 400, ${refusal.code})`);
            }
            const [afterResponse, after] = await this.listUserApps(tenantId, { searchTerm: token, pageSize: 50 });
            verify(failures, beforeResponse.status() === 200 && afterResponse.status() === 200 && after.Data?.TotalRecords === before.Data?.TotalRecords, `after the refused files, the token search total went from ${String(before.Data?.TotalRecords)} to ${String(after.Data?.TotalRecords)} (expected no change)`);
          }
          finally {
            const [, all] = await this.listUserApps(tenantId, { searchTerm: token, pageSize: 50 });
            ids.push(...(all.Data?.Data.map(entry => entry.Id) ?? []));
          }
        },
      });
    }
    finally {
      await this.releaseLimiterWindow(lastFailureAt).catch(() => undefined);
    }
  }
}
