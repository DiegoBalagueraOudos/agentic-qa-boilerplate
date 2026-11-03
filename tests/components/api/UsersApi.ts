/**
 * KATA Architecture - Layer 3: Users API Component
 *
 * Test-data helpers for generated platform Admins (ADR-0019): non-root accounts
 * created with a chosen password so negative login cases never touch the real
 * Administrator. No ATC lives here. Deletion is soft.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - POST   /User        - create a platform Admin
 * - DELETE /User/{id}   - soft delete
 * - GET    /SecurityConfig/lockout - global Admin lockout threshold (read only)
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, CreateAdminPayload, CreatedEntityData, LockoutConfigData, LoginPayload } from '@schemas/auth.types';
import type { AdminData } from '@schemas/resources.types';
import type { PagedData } from '@schemas/security.types';

import { AuthApi } from '@api/AuthApi';
import { SecureApi } from '@api/SecureApi';
import { expect, request as playwrightRequest } from '@playwright/test';
import { atc, step } from '@utils/decorators';

/**
 * One row of a USR input case. `reject` rows must answer `status` (400), `Ok` false, `code` (`VALIDATION_ERROR`) and
 * carry `message`, and create nothing; `accept` rows must answer 200. The payload carries a password: it is built lazily
 * and never reaches a message.
 */
interface AdminInputRow {
  label: string
  payload: (control: CreateAdminPayload) => object
  outcome: 'reject' | 'accept'
  status?: number
  code?: string
  message: RegExp
}

/** List query: names follow the backend's `PaginationParams` plus `includeDeleted`. */
interface AdminListQuery {
  page?: number
  pageSize?: number
  searchTerm?: string
  includeDeleted?: boolean
}

/** The backend's length refusal ("Maximo N caracteres"). */
const LENGTH_MESSAGE = /M.ximo \d+ caracteres/i;

/** The validation message each weak-password row must carry (`ApplyPasswordRules`, no special character). */
const WEAK_PASSWORD_MESSAGES: Record<string, RegExp> = {
  'min-length': /M.nimo 8/i,
  'uppercase': /may.scula/i,
  'lowercase': /min.scula/i,
  'digit': /n.mero/i,
  'empty': /requerida|vac.a/i,
};

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class UsersApi extends SecureApi {
  /** Create a platform Admin. Fixed assertions: 200, `Ok`, an id in `Data`. Step title masks `Password`. */
  @step
  async createAdmin(payload: CreateAdminPayload): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const [response, body] = await this.securePOST<CreatedEntityData, CreateAdminPayload>('/User', payload);

    expect(response.status(), `create admin: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  /**
   * Read the GLOBAL failed-login threshold of platform Admins (read only).
   * Fixed assertions: 200, `Ok`, a positive integer in `Data`.
   */
  @step
  async getAdminLockoutThreshold(): Promise<[APIResponse, ApiEnvelope<LockoutConfigData>]> {
    const [response, body] = await this.secureGET<LockoutConfigData>('/SecurityConfig/lockout');

    expect(response.status(), `read lockout config: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.MaxFailedLoginAttempts).toBeGreaterThanOrEqual(1);

    return [response, body];
  }

  /** Soft-delete a platform Admin. Fixed assertions: 200, `Ok`. */
  @step
  async deleteAdmin(userId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.secureDELETE<unknown>(`/User/${userId}`);

    expect(response.status(), `delete admin: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  // ============================================
  // Non-asserting helpers (USR cases): they return the answer, the ATC judges it
  // ============================================

  /** Create an Admin with ANY body; asserts nothing. NOT a `@step`: the payload carries a password and may be hostile. */
  async attemptCreateAdmin(payload: object): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    return this.securePOST<CreatedEntityData, object>('/User', payload);
  }

  /** Update an Admin with ANY body; asserts nothing. NOT a `@step`: the payload may carry a password. */
  async attemptUpdateAdmin(userId: number, payload: object): Promise<[APIResponse, ApiEnvelope<AdminData>]> {
    return this.securePUT<AdminData, object>(`/User/${userId}`, payload);
  }

  /** Soft-delete an Admin; asserts nothing (cleanup tolerates one that is already gone). */
  async attemptDeleteAdmin(userId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/User/${userId}`);
  }

  /** Read one Admin by id; asserts nothing. */
  async getAdmin(userId: number): Promise<[APIResponse, ApiEnvelope<AdminData>]> {
    return this.secureGET<AdminData>(`/User/${userId}`);
  }

  /** Read one Admin by username (the e-mail goes in the path); asserts nothing. */
  async getAdminByEmail(email: string): Promise<[APIResponse, ApiEnvelope<AdminData>]> {
    return this.secureGET<AdminData>(`/User/email/${encodeURIComponent(email)}`);
  }

  /** List platform Admins; asserts nothing. */
  async listAdmins(query: AdminListQuery = {}): Promise<[APIResponse, ApiEnvelope<PagedData<AdminData>>]> {
    const params = new URLSearchParams();
    if (query.page !== undefined) { params.set('Page', String(query.page)); }
    if (query.pageSize !== undefined) { params.set('PageSize', String(query.pageSize)); }
    if (query.searchTerm !== undefined) { params.set('SearchTerm', query.searchTerm); }
    if (query.includeDeleted !== undefined) { params.set('includeDeleted', String(query.includeDeleted)); }
    const text = params.toString();
    return this.secureGET<PagedData<AdminData>>(`/User${text === '' ? '' : `?${text}`}`);
  }

  /** Clear the lockout of an Admin; asserts nothing. */
  async unlockAdmin(userId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.securePATCH<unknown>(`/User/${userId}/unlock`);
  }

  // ============================================
  // Internals shared by the USR ATCs
  // ============================================

  /** First line of an error, for a failure list (no stack, no call log, never a credential). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** The Admin id an answer created, or 0. */
  private createdId(body: ApiEnvelope<CreatedEntityData>): number {
    const id = body.Data?.Id;
    return typeof id === 'number' && id > 0 ? id : 0;
  }

  /** Delete generated Admins, tolerating the ones already gone (404). Returns one line per failure. */
  private async cleanupAdmins(ids: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const [response] = await this.attemptDeleteAdmin(id);
        if (response.status() !== 200 && response.status() !== 404) {
          failures.push(`delete admin #${id}: HTTP ${response.status()}`);
        }
      }
      catch (error) {
        failures.push(`delete admin #${id}: ${this.firstLine(error)}`);
      }
    }
    return failures;
  }

  /** Create an Admin and record its id for cleanup BEFORE judging the answer. */
  private async createTrackedAdmin(payload: object, ids: number[]): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const answer = await this.attemptCreateAdmin(payload);
    const id = this.createdId(answer[1]);
    if (id > 0) {
      ids.push(id);
    }
    return answer;
  }

  /**
   * ONE Admin sign-in in its OWN request context (own cookie jar and crypto session): the root session of the ATC is left
   * alone. A 200 is signed out. Returns only the status and the error code, never a token. Undecorated: the credentials are a secret.
   */
  private async adminSignIn(credentials: LoginPayload): Promise<{ status: number, code: string | null }> {
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const probe = new UsersApi({ request: context });
      await probe.openCryptoSession();
      const [response, body] = await probe.securePOST<unknown, LoginPayload>(this.config.auth.adminLoginEndpoint, credentials);
      if (response.status() === 200) {
        await probe.postLogout().catch(() => undefined);
      }
      return { status: response.status(), code: body.CodeError ?? null };
    }
    finally {
      await context.dispose().catch(() => undefined);
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

  /** Common frame of the USR ATCs: the root Administrator session, collected failures, cleanup of what the body created, one thrown error. */
  private async runAdminCase(args: { what: string, body: (ids: number[], failures: string[]) => Promise<void> }): Promise<void> {
    const ids: number[] = [];
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      await args.body(ids, failures);
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      failures.push(...await this.cleanupAdmins(ids));
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * Shared body of the USR input cases. The positive control first (a valid Admin), then every row. A `reject` row must
   * answer its status (400 unless set), `Ok` false, its code (`VALIDATION_ERROR` unless set) and carry its message, and
   * create nothing: the Admin total must equal the base plus what was created so far. An `accept` row must answer 200. A
   * rejected row the product wrongly accepts is tracked and reported, and the loop goes on. `extra` runs afterwards.
   * Failure lines name the row and the status only: payloads carry passwords.
   */
  private async runAdminInput(args: { rows: AdminInputRow[], what: string, extra?: (ids: number[], failures: string[], control: CreateAdminPayload) => Promise<void> }): Promise<void> {
    await this.runAdminCase({
      what: args.what,
      body: async (ids, failures) => {
        const [, base] = await this.listAdmins({ pageSize: 1 });
        const baseTotal = base.Data?.TotalRecords ?? 0;
        const control = this.data.createAdminPayload();
        const [controlResponse, controlBody] = await this.createTrackedAdmin(control, ids);
        expect(controlResponse.status(), `control (valid Admin): ${controlBody.CodeError ?? 'no error code'}`).toBe(200);

        for (const row of args.rows) {
          try {
            const [response, body] = await this.createTrackedAdmin(row.payload(control), ids);
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
            const [, list] = await this.listAdmins({ pageSize: 1 });
            if ((list.Data?.TotalRecords ?? 0) !== baseTotal + ids.length) {
              failures.push(`${row.label}: the Admin total changed after the rejected create`);
            }
          }
          catch (error) {
            failures.push(`row ${row.label}: ${this.firstLine(error)}`);
          }
        }
        await args.extra?.(ids, failures, control);
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): input validation (USR-003 .. USR-006)
  // ============================================

  /** USR-003: a username on a personal domain (gmail, hotmail, yahoo, outlook) is refused (400 `VALIDATION_ERROR` "correos corporativos"); nothing is created. */
  @atc('USR-003')
  async rejectPersonalEmailDomains(): Promise<void> {
    const rows: AdminInputRow[] = this.data.createPersonalEmails().map(row => ({
      label: `username (${row.label})`,
      payload: () => this.data.createAdminPayload({ UserName: row.value }),
      outcome: 'reject' as const,
      message: /corporativos/i,
    }));
    await this.runAdminInput({ rows, what: 'personal e-mail domains' });
  }

  /**
   * USR-004: an invalid or duplicate username is refused. No at sign, no domain dot, a space and 256 characters are 400
   * `VALIDATION_ERROR`; the username of the control Admin and the username of the ROOT are 400 `USER_DUPLICATE`; nothing is created.
   */
  @atc('USR-004')
  async rejectInvalidAndDuplicateEmails(): Promise<void> {
    const rows: AdminInputRow[] = [
      ...this.data.createInvalidEmails().map(row => ({
        label: `username (${row.label})`,
        payload: () => this.data.createAdminPayload({ UserName: row.value }),
        outcome: 'reject' as const,
        message: /correo v.lido|M.ximo/i,
      })),
      { label: 'username of the control Admin (duplicate)', payload: control => this.data.createAdminPayload({ UserName: control.UserName }), outcome: 'reject', code: 'USER_DUPLICATE', message: /ya existe/i },
      { label: 'username of the root (duplicate)', payload: () => this.data.createAdminPayload({ UserName: this.config.testUser.email }), outcome: 'reject', code: 'USER_DUPLICATE', message: /ya existe/i },
    ];
    await this.runAdminInput({ rows, what: 'username validation' });
  }

  /**
   * USR-005: the full name has a minimum of 3 and a maximum of 100 (the case and the form). Control first, then 2 characters
   * (400 "Mínimo 3") and 101 characters (400 "Máximo 100") refused, and LAST a name of 3 and one of 100 characters accepted.
   * The two refusals fail today: the backend has no minimum and allows 255.
   */
  @atc('USR-005')
  async rejectInvalidNameLengths(): Promise<void> {
    const rows: AdminInputRow[] = [
      { label: 'name (2 characters)', payload: () => this.data.createAdminPayload({ FullName: 'ab' }), outcome: 'reject', message: /M.nimo 3/i },
      { label: 'name (101 characters)', payload: () => this.data.createAdminPayload({ FullName: this.data.createDeviceNameOfLength(101) }), outcome: 'reject', message: LENGTH_MESSAGE },
      { label: 'name (3 characters, limit)', payload: () => this.data.createAdminPayload({ FullName: 'abc' }), outcome: 'accept', message: LENGTH_MESSAGE },
      { label: 'name (100 characters, limit)', payload: () => this.data.createAdminPayload({ FullName: this.data.createDeviceNameOfLength(100) }), outcome: 'accept', message: LENGTH_MESSAGE },
    ];
    await this.runAdminInput({ rows, what: 'full name length' });
  }

  /**
   * USR-006: weak passwords are refused at create (shorter than 8, no upper case, no lower case, no digit, empty) naming the
   * rule, and at edit (the same values: 400, the empty string too). After the weak edits the ORIGINAL password still signs in
   * (one positive login). The value never reaches a message.
   */
  @atc('USR-006')
  async rejectWeakPasswords(): Promise<void> {
    const weak = this.data.createWeakPasswords();
    const rows: AdminInputRow[] = weak.map(row => ({
      label: `password at create (${row.rule})`,
      payload: () => this.data.createAdminPayload({ Password: row.value }),
      outcome: 'reject' as const,
      message: WEAK_PASSWORD_MESSAGES[row.rule],
    }));
    await this.runAdminInput({
      rows,
      what: 'password strength',
      extra: async (ids, failures, control) => {
        const controlId = ids[0];
        for (const row of weak) {
          const [response, body] = await this.attemptUpdateAdmin(controlId, { Password: row.value });
          const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
          verify(failures, response.status() === 400 && body.Ok === false && body.CodeError === 'VALIDATION_ERROR' && WEAK_PASSWORD_MESSAGES[row.rule].test(text), `password at edit (${row.rule}): HTTP ${response.status()} CodeError=${String(body.CodeError)} (expected 400, VALIDATION_ERROR naming the rule)`);
        }
        const signIn = await this.adminSignIn({ UserName: control.UserName ?? '', Password: control.Password ?? '' });
        verify(failures, signIn.status === 200, `sign-in with the original password after the weak edits: HTTP ${signIn.status} ${signIn.code ?? 'no error code'} (expected 200)`);
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): catalog (USR-001, 002, 007, 008)
  // ============================================

  /**
   * USR-001: list, search and state. Two generated Admins share a token: pages of 1 give 2 pages, the search finds exactly the
   * expected Admin by username and by name, neither is root and both are active. After one is deleted the default list hides it
   * and `includeDeleted=true` shows it flagged `IsDeleted`.
   */
  @atc('USR-001')
  async listAdminsWithSearchAndState(): Promise<void> {
    const token = this.data.createUsernameOfLength(14).slice(6);
    const specs = ['Alfa', 'Beta'].map((suffix, index) => ({
      payload: this.data.createAdminPayload({ UserName: `qa.adm.${token}.${index}@example.com`, FullName: `QAX${token} ${suffix}` }),
      id: 0,
    }));
    await this.runAdminCase({
      what: 'admin list',
      body: async (ids, failures) => {
        for (const spec of specs) {
          const [response, body] = await this.createTrackedAdmin(spec.payload, ids);
          spec.id = this.createdId(body);
          verify(failures, response.status() === 200 && spec.id > 0, `create ${spec.payload.FullName}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        }
        const [alfa, beta] = specs;
        if (specs.some(spec => spec.id === 0)) {
          return;
        }
        const [firstResponse, first] = await this.listAdmins({ searchTerm: token, page: 1, pageSize: 1 });
        const [secondResponse, second] = await this.listAdmins({ searchTerm: token, page: 2, pageSize: 1 });
        const pagedIds = [...(first.Data?.Data ?? []), ...(second.Data?.Data ?? [])].map(row => row.Id).sort((a, b) => a - b);
        verify(failures, firstResponse.status() === 200 && secondResponse.status() === 200 && first.Data?.Data.length === 1 && second.Data?.Data.length === 1 && first.Data.TotalRecords === 2 && pagedIds.join() === [alfa.id, beta.id].sort((a, b) => a - b).join(), `pages of 1: HTTP ${firstResponse.status()}/${secondResponse.status()}, ${String(first.Data?.Data.length)}+${String(second.Data?.Data.length)} rows, total ${String(first.Data?.TotalRecords)} (expected 1+1 rows covering both Admins, total 2)`);

        const searches: Array<{ label: string, term: string, expected: number[] }> = [
          { label: 'by username', term: String(alfa.payload.UserName), expected: [alfa.id] },
          { label: 'by name (lower case)', term: String(beta.payload.FullName).toLowerCase(), expected: [beta.id] },
          { label: 'without a match', term: `zz${token}`, expected: [] },
        ];
        for (const search of searches) {
          const [response, body] = await this.listAdmins({ searchTerm: search.term, pageSize: 10 });
          const found = body.Data?.Data.map(row => row.Id) ?? [];
          verify(failures, response.status() === 200 && found.join() === search.expected.join() && body.Data?.TotalRecords === search.expected.length, `search ${search.label}: HTTP ${response.status()}, rows [${found.join()}] total ${String(body.Data?.TotalRecords)} (expected [${search.expected.join()}])`);
        }
        const [stateResponse, state] = await this.listAdmins({ searchTerm: token, pageSize: 10 });
        verify(failures, stateResponse.status() === 200 && (state.Data?.Data ?? []).every(row => row.IsActive && !row.IsRoot && !row.IsDeleted), 'a generated Admin is not active, is root or is deleted');

        const [deleteResponse, deleted] = await this.attemptDeleteAdmin(beta.id);
        verify(failures, deleteResponse.status() === 200 && deleted.Ok === true, `delete: HTTP ${deleteResponse.status()} ${deleted.CodeError ?? 'no error code'}`);
        const [hiddenResponse, hidden] = await this.listAdmins({ searchTerm: token, pageSize: 10 });
        verify(failures, hiddenResponse.status() === 200 && hidden.Data?.TotalRecords === 1 && hidden.Data.Data[0]?.Id === alfa.id, `after the delete, the default list: HTTP ${hiddenResponse.status()}, total ${String(hidden.Data?.TotalRecords)} (expected only the live Admin)`);
        const [shownResponse, shown] = await this.listAdmins({ searchTerm: token, pageSize: 10, includeDeleted: true });
        const gone = shown.Data?.Data.find(row => row.Id === beta.id);
        verify(failures, shownResponse.status() === 200 && shown.Data?.TotalRecords === 2 && gone?.IsDeleted === true, `with includeDeleted, total ${String(shown.Data?.TotalRecords)} and the deleted Admin flagged IsDeleted=${String(gone?.IsDeleted)} (expected 2 and true)`);
      },
    });
  }

  /**
   * USR-002: create an Admin with a corporate e-mail, name and password. The answer is 200 and `Ok`; the Admin is active, not
   * locked, not root, keeps username and name as sent and has `CreatedBy`. It is found by `GET {id}`, by `GET email/{username}`
   * and by the username search (exactly 1 match).
   */
  @atc('USR-002')
  async createAdminWithCorporateEmail(): Promise<void> {
    const sent = this.data.createAdminPayload();
    await this.runAdminCase({
      what: 'admin create',
      body: async (ids, failures) => {
        const [response, body] = await this.createTrackedAdmin(sent, ids);
        verify(failures, response.status() === 200 && body.Ok === true && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        if (ids.length !== 1) {
          return;
        }
        const [readResponse, read] = await this.getAdmin(ids[0]);
        const admin = read.Data;
        verify(failures, readResponse.status() === 200 && admin !== undefined, `read by id: HTTP ${readResponse.status()}`);
        if (admin) {
          verify(failures, admin.IsActive === true && admin.IsLockedOut === false && admin.IsRoot === false && admin.IsDeleted === false, 'read: the Admin is not active, is locked, root or deleted');
          verify(failures, admin.UserName === sent.UserName && admin.FullName === sent.FullName, 'read: username or name differ from what was sent');
          verify(failures, typeof admin.CreatedBy === 'string' && admin.CreatedBy !== '', 'read: CreatedBy is not set');
        }
        const [mailResponse, byMail] = await this.getAdminByEmail(String(sent.UserName));
        verify(failures, mailResponse.status() === 200 && byMail.Data?.Id === ids[0], `read by e-mail: HTTP ${mailResponse.status()} (expected the created Admin)`);
        const [listResponse, list] = await this.listAdmins({ searchTerm: String(sent.UserName), pageSize: 10 });
        verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 1 && list.Data.Data[0]?.Id === ids[0], `search by username: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 1 and the created Admin)`);
      },
    });
  }

  /**
   * USR-007: edit and change the password. An edit that sends only a new name answers 200, reads back, and the Admin still
   * signs in with the ORIGINAL password (an empty/omitted password does not change it). Then a new password: the old one is
   * refused (401) and the new one signs in. (One refused login; the address limiter window is waited out at the end.)
   */
  @atc('USR-007')
  async editAdminAndChangePassword(): Promise<void> {
    const sent = this.data.createAdminPayload();
    const original: LoginPayload = { UserName: sent.UserName, Password: sent.Password };
    const newPassword = this.data.createActivationPassword();
    let lastFailureAt: number | undefined;
    try {
      await this.runAdminCase({
        what: 'admin edit and password change',
        body: async (ids, failures) => {
          const [response, body] = await this.createTrackedAdmin(sent, ids);
          verify(failures, response.status() === 200 && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          if (ids.length !== 1) {
            return;
          }
          const newName = `QAX editado ${this.data.createUsernameOfLength(12).slice(6)}`;
          const [editResponse, edited] = await this.attemptUpdateAdmin(ids[0], { FullName: newName });
          verify(failures, editResponse.status() === 200 && edited.Ok === true, `edit name: HTTP ${editResponse.status()} ${edited.CodeError ?? 'no error code'}`);
          const [readResponse, read] = await this.getAdmin(ids[0]);
          verify(failures, readResponse.status() === 200 && read.Data?.FullName === newName && read.Data.UserName === sent.UserName, 'read after edit: name is not the new value or the username changed');
          const keep = await this.adminSignIn(original);
          verify(failures, keep.status === 200, `sign-in with the ORIGINAL password after an edit without password: HTTP ${keep.status} ${keep.code ?? 'no error code'} (expected 200)`);

          const [changeResponse, changed] = await this.attemptUpdateAdmin(ids[0], { Password: newPassword });
          verify(failures, changeResponse.status() === 200 && changed.Ok === true, `change password: HTTP ${changeResponse.status()} ${changed.CodeError ?? 'no error code'}`);
          const oldOne = await this.adminSignIn(original);
          lastFailureAt = Date.now();
          verify(failures, oldOne.status === 401, `sign-in with the OLD password after the change: HTTP ${oldOne.status} ${oldOne.code ?? 'no error code'} (expected 401)`);
          const newOne = await this.adminSignIn({ UserName: sent.UserName, Password: newPassword });
          verify(failures, newOne.status === 200, `sign-in with the NEW password: HTTP ${newOne.status} ${newOne.code ?? 'no error code'} (expected 200)`);
        },
      });
    }
    finally {
      await this.releaseLimiterWindow(lastFailureAt).catch(() => undefined);
    }
  }

  /**
   * USR-008: deactivate and delete. `IsActive` false answers 200 and reads back; the sign-in with the CORRECT password is
   * refused; re-activating restores it. The delete answers 200, hides the Admin from the default list and the sign-in is refused
   * again. (Two refused logins, below the address limiter; the window is waited out at the end.)
   */
  @atc('USR-008')
  async refuseSignInOfInactiveAndDeletedAdmin(): Promise<void> {
    const sent = this.data.createAdminPayload();
    const credentials: LoginPayload = { UserName: sent.UserName, Password: sent.Password };
    let lastFailureAt: number | undefined;
    try {
      await this.runAdminCase({
        what: 'inactive and deleted admin',
        body: async (ids, failures) => {
          const [response, body] = await this.createTrackedAdmin(sent, ids);
          verify(failures, response.status() === 200 && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          if (ids.length !== 1) {
            return;
          }
          const control = await this.adminSignIn(credentials);
          verify(failures, control.status === 200, `control sign-in while active: HTTP ${control.status} ${control.code ?? 'no error code'}`);

          const [offResponse, off] = await this.attemptUpdateAdmin(ids[0], { IsActive: false });
          verify(failures, offResponse.status() === 200 && off.Ok === true, `deactivate: HTTP ${offResponse.status()} ${off.CodeError ?? 'no error code'}`);
          const [offReadResponse, offRead] = await this.getAdmin(ids[0]);
          verify(failures, offReadResponse.status() === 200 && offRead.Data?.IsActive === false, 'after the deactivation, the Admin reads IsActive=true');
          const refused = await this.adminSignIn(credentials);
          lastFailureAt = Date.now();
          verify(failures, refused.status === 401 || refused.status === 403, `sign-in while inactive: HTTP ${refused.status} ${refused.code ?? 'no error code'} (expected a 401/403 refusal)`);

          const [onResponse, on] = await this.attemptUpdateAdmin(ids[0], { IsActive: true });
          verify(failures, onResponse.status() === 200 && on.Ok === true, `reactivate: HTTP ${onResponse.status()} ${on.CodeError ?? 'no error code'}`);
          const again = await this.adminSignIn(credentials);
          verify(failures, again.status === 200, `sign-in after the reactivation: HTTP ${again.status} ${again.code ?? 'no error code'} (expected 200)`);

          const [deleteResponse, deleted] = await this.attemptDeleteAdmin(ids[0]);
          verify(failures, deleteResponse.status() === 200 && deleted.Ok === true, `delete: HTTP ${deleteResponse.status()} ${deleted.CodeError ?? 'no error code'}`);
          const [listResponse, list] = await this.listAdmins({ searchTerm: String(sent.UserName), pageSize: 10 });
          verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 0, `after the delete, the username search: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 0)`);
          const gone = await this.adminSignIn(credentials);
          lastFailureAt = Date.now();
          verify(failures, gone.status === 401 || gone.status === 403, `sign-in after the delete: HTTP ${gone.status} ${gone.code ?? 'no error code'} (expected a 401/403 refusal)`);
        },
      });
    }
    finally {
      await this.releaseLimiterWindow(lastFailureAt).catch(() => undefined);
    }
  }

  // ============================================
  // Test Cases (ATCs): lockout and self-protection (USR-009, 011)
  // ============================================

  /**
   * USR-009: the lockout is visible and the unlock works. The global Admin threshold is read first; that many wrong passwords
   * (sent in batches below the address limiter of 4 failures / 30 s) lock a GENERATED Admin; the root read shows `IsLockedOut`
   * true; `PATCH unlock` answers 200 and the read shows `IsLockedOut` false and 0 failed attempts; the correct sign-in works.
   * Wrong passwords never reach a real account.
   */
  @atc('USR-009')
  async showAdminLockoutAndUnlock(): Promise<void> {
    const sent = this.data.createAdminPayload();
    const correct: LoginPayload = { UserName: sent.UserName, Password: sent.Password };
    const wrong: LoginPayload = { UserName: sent.UserName, Password: this.data.createWrongPassword() };
    let lastFailureAt: number | undefined;
    try {
      await this.runAdminCase({
        what: 'admin lockout',
        body: async (ids, failures) => {
          const [response, body] = await this.createTrackedAdmin(sent, ids);
          verify(failures, response.status() === 200 && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          if (ids.length !== 1) {
            return;
          }
          const [, threshold] = await this.getAdminLockoutThreshold();
          const limit = threshold.Data?.MaxFailedLoginAttempts ?? 3;
          let inWindow = 0;
          for (let attempt = 1; attempt <= limit; attempt++) {
            if (inWindow === 3) {
              await this.releaseLimiterWindow(lastFailureAt);
              inWindow = 0;
            }
            const refused = await this.adminSignIn(wrong);
            lastFailureAt = Date.now();
            inWindow++;
            const expectedCode = attempt === limit ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS';
            verify(failures, refused.status === 401 && refused.code === expectedCode, `wrong password ${attempt} of ${limit}: HTTP ${refused.status} ${refused.code ?? 'no error code'} (expected 401 ${expectedCode})`);
          }
          const [lockedResponse, locked] = await this.getAdmin(ids[0]);
          verify(failures, lockedResponse.status() === 200 && locked.Data?.IsLockedOut === true, `after ${limit} wrong passwords, IsLockedOut reads ${String(locked.Data?.IsLockedOut)} (expected true)`);

          const [unlockResponse, unlocked] = await this.unlockAdmin(ids[0]);
          verify(failures, unlockResponse.status() === 200 && unlocked.Ok === true, `unlock: HTTP ${unlockResponse.status()} ${unlocked.CodeError ?? 'no error code'}`);
          const [openResponse, open] = await this.getAdmin(ids[0]);
          verify(failures, openResponse.status() === 200 && open.Data?.IsLockedOut === false && open.Data.FailedLoginAttempts === 0, `after the unlock, IsLockedOut=${String(open.Data?.IsLockedOut)} failed attempts=${String(open.Data?.FailedLoginAttempts)} (expected false and 0)`);
          const again = await this.adminSignIn(correct);
          verify(failures, again.status === 200, `sign-in after the unlock: HTTP ${again.status} ${again.code ?? 'no error code'} (expected 200)`);
        },
      });
    }
    finally {
      await this.releaseLimiterWindow(lastFailureAt).catch(() => undefined);
    }
  }

  /**
   * USR-011: an Admin cannot deactivate or delete itself. A GENERATED Admin signs in (its own session) and tries
   * `PUT IsActive=false` and `DELETE` on its own id: both must be refused (4xx, `Ok` false) and the root read must show it still
   * active and not deleted. Both calls are accepted today (HAL-41): the cleanup deletes the generated Admin with the root session.
   */
  @atc('USR-011')
  async refuseSelfDeactivationAndDeletion(): Promise<void> {
    const sent = this.data.createAdminPayload();
    await this.runAdminCase({
      what: 'admin self-protection',
      body: async (ids, failures) => {
        const [response, body] = await this.createTrackedAdmin(sent, ids);
        verify(failures, response.status() === 200 && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        if (ids.length !== 1) {
          return;
        }
        const adminId = ids[0];
        const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
        try {
          const auth = new AuthApi({ request: context });
          const own = new UsersApi({ request: context });
          const [, , session] = await auth.startAdminSession({ UserName: sent.UserName, Password: sent.Password });
          own.setCryptoSession(session);

          const [offResponse, off] = await own.attemptUpdateAdmin(adminId, { IsActive: false });
          verify(failures, offResponse.status() >= 400 && offResponse.status() < 500 && off.Ok === false, `deactivate itself: HTTP ${offResponse.status()} Ok=${String(off.Ok)} (expected a 4xx refusal)`);
          const [deleteResponse, deleted] = await own.attemptDeleteAdmin(adminId);
          verify(failures, deleteResponse.status() >= 400 && deleteResponse.status() < 500 && deleted.Ok === false, `delete itself: HTTP ${deleteResponse.status()} Ok=${String(deleted.Ok)} (expected a 4xx refusal)`);
          await auth.logout().catch(() => undefined);
        }
        finally {
          await context.dispose().catch(() => undefined);
        }
        const [stateResponse, state] = await this.listAdmins({ searchTerm: String(sent.UserName), pageSize: 10 });
        const row = state.Data?.Data.find(entry => entry.Id === adminId);
        verify(failures, stateResponse.status() === 200 && row !== undefined && row.IsActive === true && row.IsDeleted === false, `after the attempts, the Admin is ${row ? `IsActive=${String(row.IsActive)} IsDeleted=${String(row.IsDeleted)}` : 'missing from the list'} (expected active and not deleted)`);
      },
    });
  }
}
