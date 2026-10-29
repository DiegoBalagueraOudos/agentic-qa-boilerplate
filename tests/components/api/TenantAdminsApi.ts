/**
 * KATA Architecture - Layer 3: TenantAdmins API Component
 *
 * Helpers for TenantAdmins (generated accounts for the welcome-mail and ADM cases).
 * The Administrator creates a TenantAdmin that stays pending (`MustChangePassword = true`)
 * and removes it afterwards. The temporary password and the activation token are NOT in
 * any response: the backend only e-mails them (read through `MailboxApi`). The ADM ATCs
 * live here on top of these helpers (ADM-001..008, 010 and 012; ADM-009 and ADM-013 are UI, in
 * `TenantAdminsPage`). The lifecycle ATCs (001, 003, 008, 005, 006, 007, 012, 010) share ONE
 * mailed account that the spec hands over; mail and token work arrives as callbacks and thunks
 * from `TenantAdminAccountSteps`, so no ATC calls another component or another ATC.
 *
 * Secret handling: a method whose arguments or answer can carry a token, cookie or password
 * (`attemptUpdateTenantAdmin` payload, `activateAccount`, `attemptTenantLogin`) is UNDECORATED and runs
 * behind `withSecretGuard`, so no value reaches a step title, a log or an error. Activation
 * secrets arrive as thunks (`() => Promise<string>`), which print as `[Function]`.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - GET    /tenants/{tenantId}/tenant-admins              - list (paged)
 * - GET    /tenants/{tenantId}/tenant-admins/{id}         - read one
 * - POST   /tenants/{tenantId}/tenant-admins              - create (SuperAdminSistema)
 * - PUT    /tenants/{tenantId}/tenant-admins/{id}         - update (name, position, password, status)
 * - DELETE /tenants/{tenantId}/tenant-admins/{id}         - delete
 * - PATCH  /tenants/{tenantId}/tenant-admins/{id}/unlock  - clear a lockout
 * - POST   /Auth/tenant-admin/activate                    - anonymous, activation with the mailed token
 * - POST   /Auth/tenant-admin/resend-activation           - anonymous, sends a new activation mail
 * - POST   /Auth/login/tenant                             - tenant-admin sign-in (own session)
 */

import type { APIRequestContext, APIResponse } from '@playwright/test';
import type {
  ActivateAccountPayload,
  ApiEnvelope,
  CreateTenantAdminPayload,
  LoginPayload,
  ResendActivationPayload,
  TenantAdminData,
  TenantAdminRecord,
  UpdateTenantAdminPayload,
} from '@schemas/auth.types';
import type { PagedData } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { expect, request as playwrightRequest } from '@playwright/test';
import { atc, step } from '@utils/decorators';

/** An account a rejected-input row wrongly created: its id (to delete) and user name (to clear its mail). */
export interface CreatedAccount {
  id: number
  username: string
}

/**
 * Where the rejected-input ATCs (ADM-002, ADM-004) try to create admins. `trackCreated` receives
 * any account a row wrongly created, so the spec can delete it and its mail (the create sends a mail).
 */
export interface RejectedInputTarget {
  tenantId: number
  trackCreated: (account: CreatedAccount) => void
}

/** One rejected create: what was sent, and the validation message (a fragment) the answer must carry. */
interface RejectedCreateRow {
  label: string
  payload: CreateTenantAdminPayload
  message: RegExp
}

/** Where a TenantAdmin lives. Flat object so a call keeps at most two positional parameters. */
export interface TenantAdminTarget {
  tenantId: number
  tenantAdminId: number
}

/**
 * What an anonymous call answered: status and error code only. Never a body, token or cookie
 * value (`sessionCookiesIssued` is by cookie NAME).
 */
export interface AccountCallResult {
  status: number
  ok: boolean
  code: string | null
  error: string | null
  sessionCookiesIssued: boolean
}

/** The shared lifecycle account: where it lives and its user name (a generated, corporate e-mail). */
export interface LifecycleAdminTarget extends TenantAdminTarget {
  userName: string
}

/** ADM-001: the create, plus the mail and cleanup hooks the Steps provide. */
export interface CreateLifecycleAdminArgs {
  tenantId: number
  /** Called with the new account as soon as the create answers, BEFORE any check, so cleanup finds it. */
  adopt: (account: { id: number, username: string, fullName?: string }) => void
  /** Waits for the mail sandbox slot (12 s gap) before the create. */
  waitForMailSlot: () => Promise<void>
  /** Marks that a mail was just triggered. */
  markMailSent: () => void
  /** Waits for the welcome mail and keeps its token privately (the Steps). */
  confirmWelcomeMail: () => Promise<void>
}

/** ADM-003: the existing account and the two tenants the duplicate is tried in. */
export interface DuplicateEmailTarget {
  tenantId: number
  secondTenantId: number
  userName: string
  /** Receives any account a row wrongly created (its mail is cleared by the Steps). */
  trackCreated: (account: CreatedAccount) => void
}

/** ADM-008: the pending account and the mail and token hooks of the Steps. */
export interface ResendActivationArgs {
  userName: string
  waitForMailSlot: () => Promise<void>
  markMailSent: () => void
  /** Waits for the resent mail; throws if the token did not change. */
  confirmResentMail: () => Promise<void>
  /** The token of the first (welcome) mail, as a thunk. */
  readFirstActivationToken: () => Promise<string>
}

/** ADM-005: the activated account; the new password is handed back so later ATCs use the current one. */
export interface EditLifecycleAdminArgs extends LifecycleAdminTarget {
  rememberPassword: (newPassword: string) => void
}

/** ADM-006, 007, 012: the activated account and its CURRENT password as a thunk. */
export interface CredentialedAdminArgs extends LifecycleAdminTarget {
  readPassword: () => Promise<string>
}

/** The validation message each weak-password row must carry (`ApplyPasswordRules`, no special character). */
const WEAK_PASSWORD_MESSAGES: Record<string, RegExp> = {
  'min-length': /Mínimo 8/,
  'uppercase': /mayúscula/i,
  'lowercase': /minúscula/i,
  'digit': /número/i,
  'empty': /vacía/i,
};

/** A 4xx answer with `Ok` false: the shape of every refusal the lifecycle ATCs expect. */
function isRefusal(status: number, ok: boolean): boolean {
  return status >= 400 && status < 500 && !ok;
}

export class TenantAdminsApi extends SecureApi {
  // ============================================
  // Helpers (Private)
  // ============================================

  /**
   * Run an anonymous call in its OWN request context and crypto session (clean cookie jar),
   * so the caller's Administrator session is never touched. Always disposes the context.
   */
  private async inOwnSession<T>(action: (api: TenantAdminsApi, context: APIRequestContext) => Promise<T>): Promise<T> {
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const api = new TenantAdminsApi({ request: context });
      await api.openCryptoSession();
      return await action(api, context);
    }
    finally {
      await context.dispose().catch(() => undefined);
    }
  }

  /** Reduce an answer to status and error code. */
  private async toCallResult(answer: {
    response: APIResponse
    body: ApiEnvelope<unknown>
    context: APIRequestContext
  }): Promise<AccountCallResult> {
    const { response, body, context } = answer;
    const { cookies } = await context.storageState();
    const names = cookies.map(c => c.name);
    return {
      status: response.status(),
      ok: body.Ok === true,
      code: body.CodeError ?? null,
      error: body.Error ?? null,
      sessionCookiesIssued: this.sessionCookies.every(name => names.includes(name)),
    };
  }

  /**
   * Try one create that the product must refuse. Returns the failures of this row (label, status
   * and code only, never a body): not a 4xx, `Ok` true, the validation message missing, or the
   * tenant no longer empty. An account a row wrongly created is reported to `trackCreated` and
   * deleted here (it also sent a mail: that is a finding). `accepted` tells the caller to STOP
   * sending further creates, since every wrongly accepted create sends one more mail.
   */
  private async rejectedCreateFailures(target: RejectedInputTarget, row: RejectedCreateRow): Promise<{ failures: string[], accepted: boolean }> {
    const failures: string[] = [];
    const [response, body] = await this.attemptCreateTenantAdmin(target.tenantId, row.payload);
    const status = response.status();

    const createdId = body.Data?.Id;
    if (typeof createdId === 'number' && createdId > 0) {
      target.trackCreated({ id: createdId, username: row.payload.UserName ?? '' });
      failures.push(`${row.label}: the product ACCEPTED the create (HTTP ${status}, an account and a mail were produced)`);
      await this.attemptDeleteTenantAdmin({ tenantId: target.tenantId, tenantAdminId: createdId });
      return { failures, accepted: true };
    }

    if (status < 400 || status >= 500) {
      failures.push(`${row.label}: HTTP ${status}, expected a 4xx`);
    }
    else if (body.Ok === true) {
      failures.push(`${row.label}: HTTP ${status} but Ok is true`);
    }
    else if (!row.message.test(`${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`)) {
      failures.push(`${row.label}: HTTP ${status} ${body.CodeError ?? 'no error code'}, the validation message ${row.message} is missing`);
    }

    const [, list] = await this.listTenantAdmins(target.tenantId);
    const count = list.Data?.Data.length ?? 0;
    if (count !== 0) {
      failures.push(`${row.label}: the tenant has ${count} admins after the row, expected 0`);
    }
    return { failures, accepted: false };
  }

  /** First line of an error, for a failure list (no stack, no call log). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** Run one check; a throw becomes a failure line. Returns the value, or undefined when it failed. */
  private async collect<T>(check: { failures: string[], label: string, action: () => Promise<T> }): Promise<T | undefined> {
    const { failures, label, action } = check;
    try {
      return await action();
    }
    catch (error) {
      failures.push(`${label}: ${this.firstLine(error)}`);
      return undefined;
    }
  }

  /** Read the full record of one TenantAdmin (a failure line when the read fails). */
  private async readRecord(read: { failures: string[], label: string, target: TenantAdminTarget }): Promise<TenantAdminRecord | undefined> {
    const { failures, label, target } = read;
    const result = await this.collect({ failures, label, action: async () => this.getTenantAdmin(target) });
    return result?.[1].Data ?? undefined;
  }

  /** An update that must answer 200 and `Ok`: true when it did, else records the failure (status and code only). */
  private async updateAccepted(update: { failures: string[], label: string, target: TenantAdminTarget, payload: UpdateTenantAdminPayload }): Promise<boolean> {
    const { failures, label, target, payload } = update;
    const [response, body] = await this.attemptUpdateTenantAdmin(target, payload);
    if (response.status() !== 200 || body.Ok !== true) {
      failures.push(`${label}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
      return false;
    }
    return true;
  }

  /** A sign-in that must succeed (a positive login); records the failure with status and code only. */
  private async signInAccepted(signIn: { failures: string[], label: string, credentials: LoginPayload }): Promise<void> {
    const { failures, label, credentials } = signIn;
    const result = await this.attemptTenantLogin(credentials);
    if (result.status !== 200 || !result.ok) {
      failures.push(`${label}: HTTP ${result.status} ${result.code ?? 'no error code'}, expected a sign-in`);
    }
  }

  // ============================================
  // Helpers (no ATC)
  // ============================================

  /**
   * Create a pending TenantAdmin. Fixed assertions: 200, `Ok` and an id. The
   * `Warning` and `MustChangePassword` checks are the CALLER's: the created id must be
   * recorded for cleanup BEFORE they run, or a created-but-warned account is orphaned.
   */
  @step
  async createTenantAdmin(
    tenantId: number,
    payload: CreateTenantAdminPayload,
  ): Promise<[APIResponse, ApiEnvelope<TenantAdminData>]> {
    const [response, body] = await this.securePOST<TenantAdminData, CreateTenantAdminPayload>(
      `/tenants/${tenantId}/tenant-admins`,
      payload,
    );

    expect(response.status(), `create tenantadmin: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  /**
   * Create attempt that asserts NOTHING: for the rejected-input cases, which check the answer
   * themselves. A row the product wrongly accepts creates an account (and sends a mail), so the
   * caller must delete `body.Data.Id` whenever it is present.
   */
  @step
  async attemptCreateTenantAdmin(
    tenantId: number,
    payload: CreateTenantAdminPayload,
  ): Promise<[APIResponse, ApiEnvelope<TenantAdminData>]> {
    return this.securePOST<TenantAdminData, CreateTenantAdminPayload>(`/tenants/${tenantId}/tenant-admins`, payload);
  }

  /** List the TenantAdmins of a tenant (first page of up to 100). Fixed assertions: 200, `Ok`, a list. */
  @step
  async listTenantAdmins(tenantId: number): Promise<[APIResponse, ApiEnvelope<PagedData<TenantAdminRecord>>]> {
    const [response, body] = await this.secureGET<PagedData<TenantAdminRecord>>(
      `/tenants/${tenantId}/tenant-admins?Page=1&PageSize=100`,
    );

    expect(response.status(), `list tenantadmins: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(Array.isArray(body.Data?.Data)).toBe(true);

    return [response, body];
  }

  /** Read one TenantAdmin. Fixed assertions: 200, `Ok`, the id asked for. */
  @step
  async getTenantAdmin(target: TenantAdminTarget): Promise<[APIResponse, ApiEnvelope<TenantAdminRecord>]> {
    const { tenantId, tenantAdminId } = target;
    const [response, body] = await this.secureGET<TenantAdminRecord>(`/tenants/${tenantId}/tenant-admins/${tenantAdminId}`);

    expect(response.status(), `get tenantadmin: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBe(tenantAdminId);

    return [response, body];
  }

  /**
   * Update attempt that asserts NOTHING (rejected-input cases). Undecorated: the payload can
   * carry a password and a step title would print it.
   */
  async attemptUpdateTenantAdmin(
    target: TenantAdminTarget,
    payload: UpdateTenantAdminPayload,
  ): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const { tenantId, tenantAdminId } = target;
    return this.securePUT<unknown, UpdateTenantAdminPayload>(`/tenants/${tenantId}/tenant-admins/${tenantAdminId}`, payload);
  }

  /** Clear the lockout of a TenantAdmin. Fixed assertions: 200, `Ok`. */
  @step
  async unlockTenantAdmin(target: TenantAdminTarget): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const { tenantId, tenantAdminId } = target;
    const [response, body] = await this.securePATCH<unknown>(`/tenants/${tenantId}/tenant-admins/${tenantAdminId}/unlock`);

    expect(response.status(), `unlock tenantadmin: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /** Delete a TenantAdmin. Fixed assertions: 200, `Ok`. */
  @step
  async deleteTenantAdmin(tenantId: number, tenantAdminId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.attemptDeleteTenantAdmin({ tenantId, tenantAdminId });

    expect(response.status(), `delete tenantadmin: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /** Delete attempt that asserts NOTHING (a delete the product must refuse). */
  @step
  async attemptDeleteTenantAdmin(target: TenantAdminTarget): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const { tenantId, tenantAdminId } = target;
    return this.secureDELETE<unknown>(`/tenants/${tenantId}/tenant-admins/${tenantAdminId}`);
  }

  /**
   * Activate a pending account with the mailed token (anonymous, own session). The token and
   * the new password arrive as thunks and are read only here. Asserts nothing: it returns
   * status and error code, so the caller checks success or the refusal of a stale token.
   */
  async activateAccount(
    token: () => Promise<string>,
    newPassword: () => Promise<string>,
  ): Promise<AccountCallResult> {
    return this.withSecretGuard('activate account', 'activation token', async () => {
      const payload: ActivateAccountPayload = { Token: await token(), NewPassword: await newPassword() };
      return this.inOwnSession(async (api, context) => {
        const [response, body] = await api.securePOST<unknown, ActivateAccountPayload>('/Auth/tenant-admin/activate', payload);
        return this.toCallResult({ response, body, context });
      });
    });
  }

  /**
   * Ask for a new activation mail (anonymous, own session). SENDS A MAIL when the account is
   * pending: call it only from a case that budgets that mail. Asserts nothing.
   */
  async resendActivation(userName: string): Promise<AccountCallResult> {
    const payload: ResendActivationPayload = { UserName: userName };
    return this.inOwnSession(async (api, context) => {
      const [response, body] = await api.securePOST<unknown, ResendActivationPayload>('/Auth/tenant-admin/resend-activation', payload);
      return this.toCallResult({ response, body, context });
    });
  }

  /**
   * One tenant-admin sign-in in its OWN session (clean cookie jar, own crypto session), signed
   * out again when it succeeds. Asserts nothing: it returns status and error code, so the caller
   * can check a lockout, an inactive account or a positive login. Undecorated: carries a password.
   */
  async attemptTenantLogin(credentials: LoginPayload): Promise<AccountCallResult> {
    return this.withSecretGuard('tenant login', 'session', async () =>
      this.inOwnSession(async (api, context) => {
        const [response, body] = await api.securePOST<unknown, LoginPayload>(this.tenantLoginEndpoint, credentials);
        const result = await this.toCallResult({ response, body, context });
        if (result.ok) {
          await api.postLogout().catch(() => undefined);
        }
        return result;
      }));
  }

  // ============================================
  // Test Cases (ATCs)
  // ============================================

  /**
   * ADM-002: an invalid e-mail format or a personal/free domain is refused at create.
   *
   * Own crypto session, ONE positive Administrator login. Each row (no format, `a@b`, 256
   * characters, gmail, hotmail, yahoo, outlook and the other blocked domains, upper-case
   * variants) must answer a 4xx with `Ok` false and the validation message, and the tenant must
   * still have 0 admins afterwards. A refused create sends no mail; a row the product wrongly
   * accepts is deleted and reported. Failures are thrown once, naming row and status only.
   */
  @atc('ADM-002')
  async rejectInvalidAndPersonalEmails(target: RejectedInputTarget): Promise<void> {
    const failures: string[] = [];
    const formatRows: RejectedCreateRow[] = this.data.createInvalidAdminEmails().map(row => ({
      label: `invalid e-mail (${row.label})`,
      payload: this.data.createTenantAdminPayload({ UserName: row.value }),
      message: row.label === '256 characters' ? /Máximo 255/ : /correo válido/i,
    }));
    const personalRows: RejectedCreateRow[] = this.data.createPersonalDomainEmails().map(row => ({
      label: `personal domain (${row.label})`,
      payload: this.data.createTenantAdminPayload({ UserName: row.value }),
      message: /correos corporativos/i,
    }));

    await this.openAdministratorSession();
    try {
      const rows = [...formatRows, ...personalRows];
      for (const [index, row] of rows.entries()) {
        const outcome = await this.rejectedCreateFailures(target, row);
        failures.push(...outcome.failures);
        if (outcome.accepted) {
          failures.push(`stopped after row ${index + 1} of ${rows.length}: no more creates are sent once the product accepts one (each sends a mail)`);
          break;
        }
      }
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} e-mail checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * ADM-004: a name over 255 characters and a position over 100 are refused at create.
   *
   * Own crypto session, ONE positive Administrator login. Three rows (name 256, position 101,
   * both) with an otherwise valid corporate e-mail: each answers a 4xx with `Ok` false and the
   * "Máximo" message, and the tenant still has 0 admins. The "accepted at the limit" half is
   * NOT here: a valid create sends a mail, so 255 / 100 are exercised as edit data in ADM-005.
   * Failures are thrown once, naming row and status only.
   */
  @atc('ADM-004')
  async rejectOversizedNameAndPosition(target: RejectedInputTarget): Promise<void> {
    const failures: string[] = [];
    const { fullName, position } = this.data.createOversizedAdminFields();
    const rows: RejectedCreateRow[] = [
      {
        label: 'name of 256 characters',
        payload: this.data.createTenantAdminPayload({ FullName: fullName }),
        message: /Máximo 255 caracteres/,
      },
      {
        label: 'position of 101 characters',
        payload: this.data.createTenantAdminPayload({ Position: position }),
        message: /Máximo 100 caracteres/,
      },
      {
        label: 'name of 256 and position of 101 characters',
        payload: this.data.createTenantAdminPayload({ FullName: fullName, Position: position }),
        message: /Máximo 255 caracteres[\s\S]*Máximo 100 caracteres|Máximo 100 caracteres[\s\S]*Máximo 255 caracteres/,
      },
    ];

    await this.openAdministratorSession();
    try {
      for (const [index, row] of rows.entries()) {
        const outcome = await this.rejectedCreateFailures(target, row);
        failures.push(...outcome.failures);
        if (outcome.accepted) {
          failures.push(`stopped after row ${index + 1} of ${rows.length}: no more creates are sent once the product accepts one (each sends a mail)`);
          break;
        }
      }
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} field-length checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * ADM-001: create a TenantAdmin with a valid corporate e-mail.
   *
   * SENDS ONE MAIL (the welcome mail) and is the only lifecycle ATC that creates an account.
   * Own crypto session, ONE positive Administrator login. The create must answer 200, `Ok`,
   * `MustChangePassword` and `PendingActivation` true and no `Warning`; the list must show the
   * account as pending; the welcome mail must arrive (confirmed by the Steps through a callback,
   * which also keeps the activation token privately). The id is handed to `adopt` right after the
   * create answers, before any check, so cleanup always finds the account.
   */
  @atc('ADM-001')
  async createTenantAdminWithCorporateEmail(args: CreateLifecycleAdminArgs): Promise<void> {
    const { tenantId, adopt, waitForMailSlot, markMailSent, confirmWelcomeMail } = args;
    const failures: string[] = [];
    const payload = this.data.createTenantAdminPayload();
    const userName = payload.UserName ?? '';

    await waitForMailSlot();
    await this.openAdministratorSession();
    try {
      const [response, body] = await this.attemptCreateTenantAdmin(tenantId, payload);
      markMailSent();

      const createdId = body.Data?.Id;
      if (typeof createdId !== 'number' || createdId <= 0) {
        throw new Error(`create tenantadmin: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}, no account was returned`);
      }
      adopt({ id: createdId, username: userName, fullName: payload.FullName ?? undefined });

      if (response.status() !== 200 || body.Ok !== true) {
        failures.push(`create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}, expected 200 and Ok`);
      }
      if (body.Data?.MustChangePassword !== true) {
        failures.push('create: MustChangePassword is not true');
      }
      if (body.Data?.PendingActivation !== true) {
        failures.push('create: PendingActivation is not true');
      }
      if (body.Warning) {
        failures.push('create: the answer carries a Warning (the welcome mail was not sent)');
      }

      const listed = await this.collect({ failures, label: 'list after create', action: async () => this.listTenantAdmins(tenantId) });
      const row = listed?.[1].Data?.Data.find(admin => admin.Id === createdId);
      if (listed && !row) {
        failures.push('list after create: the new account is not listed');
      }
      else if (row) {
        if (row.PendingActivation !== true || row.MustChangePassword !== true) {
          failures.push('list after create: the account is not shown as pending activation');
        }
        if (row.UserName.toLowerCase() !== userName.toLowerCase()) {
          failures.push('list after create: the listed user name differs from the one created');
        }
      }

      if (response.status() === 200) {
        await this.collect({ failures, label: 'welcome mail', action: confirmWelcomeMail });
      }
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} create checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * ADM-003: a duplicate e-mail is refused, whatever the tenant or the letter case.
   *
   * Mail free. Own crypto session, ONE positive Administrator login. Rows: the e-mail of the
   * existing account in the same tenant, in a second generated tenant, and in upper case in the
   * same tenant. Each must answer a 4xx with `Ok` false and "ya está registrado"; afterwards the
   * first tenant still has exactly 1 admin and the second 0. A row the product wrongly accepts is
   * deleted and reported (it also sent a mail).
   */
  @atc('ADM-003')
  async rejectDuplicateEmail(target: DuplicateEmailTarget): Promise<void> {
    const { tenantId, secondTenantId, userName, trackCreated } = target;
    const failures: string[] = [];
    const rows = [
      { label: 'same e-mail, same tenant', tenant: tenantId, email: userName },
      { label: 'same e-mail, second tenant', tenant: secondTenantId, email: userName },
      { label: 'upper-case e-mail, same tenant', tenant: tenantId, email: userName.toUpperCase() },
    ];

    await this.openAdministratorSession();
    try {
      for (const [index, row] of rows.entries()) {
        const [response, body] = await this.attemptCreateTenantAdmin(row.tenant, this.data.createTenantAdminPayload({ UserName: row.email }));
        const createdId = body.Data?.Id;
        if (typeof createdId === 'number' && createdId > 0) {
          trackCreated({ id: createdId, username: row.email });
          failures.push(`${row.label}: the product ACCEPTED the duplicate (HTTP ${response.status()}, an account and a mail were produced)`);
          await this.attemptDeleteTenantAdmin({ tenantId: row.tenant, tenantAdminId: createdId });
          failures.push(`stopped after row ${index + 1} of ${rows.length}: no more creates are sent once the product accepts one (each sends a mail)`);
          break;
        }
        if (!isRefusal(response.status(), body.Ok === true)) {
          failures.push(`${row.label}: HTTP ${response.status()} Ok ${String(body.Ok)}, expected a 4xx refusal`);
        }
        else if (!/ya está registrado/i.test(`${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`)) {
          failures.push(`${row.label}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}, the "ya está registrado" message is missing`);
        }
      }

      for (const [tenant, expected] of [[tenantId, 1], [secondTenantId, 0]] as const) {
        const listed = await this.collect({ failures, label: `list of tenant #${tenant}`, action: async () => this.listTenantAdmins(tenant) });
        const count = listed?.[1].Data?.Data.length;
        if (count !== undefined && count !== expected) {
          failures.push(`tenant #${tenant} has ${count} admins after the duplicates, expected ${expected}`);
        }
      }
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} duplicate e-mail checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * ADM-005: edit name, position, password and status of an ACTIVATED account.
   *
   * Mail free. Own crypto session, ONE positive Administrator login. Name of 255 and position of
   * 100 characters (the allowed limit) persist and `UpdatedBy`/`UpdatedAt` are set; disable
   * (`IsActive` false) then enable; a password change answers 200 and the NEW password signs in
   * (a positive login). The new password is handed to `rememberPassword` so the next ATCs use the
   * current one. The account is left enabled.
   */
  @atc('ADM-005')
  async editNamePositionPasswordAndStatus(args: EditLifecycleAdminArgs): Promise<void> {
    const { rememberPassword, userName } = args;
    const failures: string[] = [];
    const limit = this.data.createMaxLengthAdminFields();
    let disabled = false;

    await this.openAdministratorSession();
    try {
      const beforeEdit = await this.readRecord({ failures, label: 'read before the edit', target: args });
      if (await this.updateAccepted({ failures, label: 'edit name and position', target: args, payload: { FullName: limit.fullName, Position: limit.position } })) {
        const record = await this.readRecord({ failures, label: 'read after name and position', target: args });
        if (record) {
          if (record.FullName !== limit.fullName) {
            failures.push('name of 255 characters did not persist');
          }
          if (record.Position !== limit.position) {
            failures.push('position of 100 characters did not persist');
          }
          // UpdatedAt must move forward (a null "before" counts as the earliest). UpdatedBy is only asserted
          // non-empty: the record exposes a display identity of the actor, not a stable id to compare with.
          const updatedBefore = beforeEdit?.UpdatedAt ? Date.parse(beforeEdit.UpdatedAt) : Number.NEGATIVE_INFINITY;
          const updatedAfter = record.UpdatedAt ? Date.parse(record.UpdatedAt) : Number.NaN;
          if (!(updatedAfter > updatedBefore)) {
            failures.push('UpdatedAt did not move forward after the edit');
          }
          if (!record.UpdatedBy) {
            failures.push('UpdatedBy was not set by the edit');
          }
        }
      }

      if (await this.updateAccepted({ failures, label: 'disable', target: args, payload: { IsActive: false } })) {
        disabled = true;
        const record = await this.readRecord({ failures, label: 'read after disable', target: args });
        if (record && record.IsActive !== false) {
          failures.push('disable: the account is still active');
        }
      }
      if (await this.updateAccepted({ failures, label: 'enable', target: args, payload: { IsActive: true } })) {
        disabled = false;
        const record = await this.readRecord({ failures, label: 'read after enable', target: args });
        if (record && record.IsActive !== true) {
          failures.push('enable: the account is still inactive');
        }
      }

      const newPassword = this.data.createActivationPassword();
      if (await this.updateAccepted({ failures, label: 'change password', target: args, payload: { Password: newPassword } })) {
        rememberPassword(newPassword);
        await this.signInAccepted({ failures, label: 'sign-in with the new password', credentials: { UserName: userName, Password: newPassword } });
      }
    }
    finally {
      if (disabled) {
        await this.attemptUpdateTenantAdmin(args, { IsActive: true }).catch(() => undefined);
      }
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} edit checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * ADM-006: a weak password is refused on edit and nothing changes.
   *
   * Mail free. Own crypto session, ONE positive Administrator login, on the ACTIVATED account.
   * Five rows (7 characters, no upper case, no lower case, no digit, empty), each answering a 4xx
   * with `Ok` false and the message of the rule it breaks (no special character is required: that
   * rule belongs to API credentials). Afterwards the CURRENT password still signs in. Failures
   * name the row only, never the password.
   */
  @atc('ADM-006')
  async rejectWeakPasswordOnEdit(args: CredentialedAdminArgs): Promise<void> {
    const { userName, readPassword } = args;
    const failures: string[] = [];

    await this.openAdministratorSession();
    try {
      for (const row of this.data.createWeakPasswords()) {
        const label = `weak password (${row.rule})`;
        const [response, body] = await this.attemptUpdateTenantAdmin(args, { Password: row.value });
        if (!isRefusal(response.status(), body.Ok === true)) {
          failures.push(`${label}: HTTP ${response.status()} Ok ${String(body.Ok)}, expected a 4xx refusal`);
        }
        else if (!WEAK_PASSWORD_MESSAGES[row.rule].test(`${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`)) {
          failures.push(`${label}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}, the rule message is missing`);
        }
      }

      await this.signInAccepted({ failures, label: 'current password after the weak edits', credentials: { UserName: userName, Password: await readPassword() } });
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} weak-password checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * ADM-007: a locked TenantAdmin is unlocked by the Administrator and can sign in again.
   *
   * Mail free. Own crypto session, ONE positive Administrator login. The failed logins go ONLY
   * to the GENERATED account (3 wrong passwords: the third answers 401 `ACCOUNT_LOCKED`; the
   * correct-password-while-locked probe is not repeated, it would be the 4th failure and trip the
   * address limiter). Then `IsLockedOut` is true; the unlock clears it and `FailedLoginAttempts`;
   * the correct password signs in. The address limiter window is waited out in `finally`.
   */
  @atc('ADM-007')
  async unlockLockedTenantAdmin(args: CredentialedAdminArgs): Promise<void> {
    const { userName, readPassword } = args;
    const failures: string[] = [];
    let lastAttemptAt: number | undefined;
    let bodyPassed = false;
    let releaseError: unknown;

    await this.openAdministratorSession();
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const result = await this.attemptTenantLogin({ UserName: userName, Password: this.data.createWrongPassword() });
        lastAttemptAt = Date.now();
        const expectedCode = attempt === 3 ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS';
        if (result.status !== 401 || result.code !== expectedCode) {
          failures.push(`wrong password #${attempt}: HTTP ${result.status} ${result.code ?? 'no error code'}, expected 401 ${expectedCode}`);
        }
      }

      const locked = await this.readRecord({ failures, label: 'read after the lock', target: args });
      if (locked && locked.IsLockedOut !== true) {
        failures.push('after 3 wrong passwords the account is not locked');
      }

      if (await this.collect({ failures, label: 'unlock', action: async () => this.unlockTenantAdmin(args) })) {
        const unlocked = await this.readRecord({ failures, label: 'read after the unlock', target: args });
        if (unlocked && (unlocked.IsLockedOut !== false || unlocked.FailedLoginAttempts !== 0)) {
          failures.push('after the unlock the account is still locked or keeps failed attempts');
        }
      }

      await this.signInAccepted({ failures, label: 'sign-in after the unlock', credentials: { UserName: userName, Password: await readPassword() } });

      if (failures.length > 0) {
        throw new Error(`${failures.length} unlock checks failed. ${failures.join('; ')}`);
      }
      bodyPassed = true;
    }
    finally {
      releaseError = await this.signOutAndReleaseLimiter(lastAttemptAt, bodyPassed);
    }
    if (releaseError !== undefined) {
      throw releaseError;
    }
  }

  /**
   * ADM-008: resend the activation mail of a PENDING account.
   *
   * SENDS ONE MAIL. Anonymous calls in their own sessions. The resend answers the generic OK; a
   * new mail arrives with a token different from the first (confirmed by the Steps through a
   * callback); the OLD token is then refused (400 `ACTIVATION_TOKEN_INVALID`; any other status, a 429
   * included, is inconclusive and fails). Run only while the account is pending, before
   * the activation. Tagged `@resend` by the spec so it can be left out of the first run.
   */
  @atc('ADM-008')
  async resendActivationWithNewToken(args: ResendActivationArgs): Promise<void> {
    const { userName, waitForMailSlot, markMailSent, confirmResentMail, readFirstActivationToken } = args;
    const failures: string[] = [];

    await waitForMailSlot();
    const resend = await this.resendActivation(userName);
    markMailSent();
    if (resend.status !== 200 || !resend.ok) {
      throw new Error(`resend activation: HTTP ${resend.status} ${resend.code ?? 'no error code'}, expected 200 and Ok (no mail to wait for)`);
    }

    await this.collect({ failures, label: 'resent mail', action: confirmResentMail });

    const probePassword = this.data.createActivationPassword();
    const oldToken = await this.activateAccount(readFirstActivationToken, async () => probePassword);
    if (oldToken.status !== 400 || oldToken.code !== 'ACTIVATION_TOKEN_INVALID') {
      failures.push(oldToken.status === 400
        ? `old token after the resend: HTTP 400 ${oldToken.code ?? 'no error code'}, expected ACTIVATION_TOKEN_INVALID`
        : `old token after the resend: HTTP ${oldToken.status}, inconclusive (rl-auth limiter), not a verdict`);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} resend checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * ADM-010: the only administrator of a tenant cannot be deleted (rule decided by the owner).
   *
   * Mail free; the LAST step of the lifecycle chain, on the shared account (the tenant's only
   * admin). Own crypto session, ONE positive Administrator login. The delete must be refused (400 or 409,
   * `Ok` false) and the account must still be listed afterwards. If the product allows the delete
   * this ATC FAILS (a product defect: HAL-27). The Steps' cleanup tolerates both outcomes.
   */
  @atc('ADM-010')
  async rejectDeleteOfOnlyAdmin(target: TenantAdminTarget): Promise<void> {
    const { tenantId, tenantAdminId } = target;
    const failures: string[] = [];

    await this.openAdministratorSession();
    try {
      const before = await this.collect({ failures, label: 'list before the delete', action: async () => this.listTenantAdmins(tenantId) });
      const admins = before?.[1].Data?.Data;
      if (admins && (admins.length !== 1 || admins[0].Id !== tenantAdminId)) {
        failures.push(`precondition: the tenant has ${admins.length} admins, expected only the shared one`);
      }

      const [response, body] = await this.attemptDeleteTenantAdmin(target);
      const status = response.status();
      if ((status === 400 || status === 409) && body.Ok !== true) {
        // business refusal, as expected
      }
      else if (status === 401 || status === 403 || status === 404 || status === 429) {
        failures.push(`delete of the only admin: HTTP ${status}, inconclusive (not a business refusal), not a verdict`);
      }
      else {
        failures.push(`delete of the only admin: HTTP ${status} Ok ${String(body.Ok)}, expected a business refusal (400 or 409)`);
      }

      const after = await this.collect({ failures, label: 'list after the delete', action: async () => this.listTenantAdmins(tenantId) });
      if (after && !after[1].Data?.Data.some(admin => admin.Id === tenantAdminId)) {
        failures.push('after the delete attempt the only admin is no longer listed');
      }
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} last-admin checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * ADM-012: a disabled TenantAdmin cannot sign in, even with the CORRECT password.
   *
   * Mail free. Own crypto session, ONE positive Administrator login. The account is disabled through
   * the API; the sign-in with its correct password answers 401 `TENANT_ADMIN_INACTIVE` (the status,
   * not the password, is the only possible cause); after re-enabling, the same credentials sign in.
   * The account is re-enabled in `finally` whatever happens, and the address limiter window is
   * waited out.
   */
  @atc('ADM-012')
  async rejectInactiveTenantAdminLogin(args: CredentialedAdminArgs): Promise<void> {
    const { userName, readPassword } = args;
    const failures: string[] = [];
    let lastAttemptAt: number | undefined;
    let disabled = false;
    let bodyPassed = false;
    let releaseError: unknown;

    await this.openAdministratorSession();
    try {
      disabled = await this.updateAccepted({ failures, label: 'disable', target: args, payload: { IsActive: false } });
      if (!disabled) {
        throw new Error(`${failures.length} inactive-login checks failed. ${failures.join('; ')}`);
      }

      const refused = await this.attemptTenantLogin({ UserName: userName, Password: await readPassword() });
      lastAttemptAt = Date.now();
      if (refused.status !== 401 || refused.code !== 'TENANT_ADMIN_INACTIVE') {
        failures.push(`sign-in while inactive: HTTP ${refused.status} ${refused.code ?? 'no error code'}, expected 401 TENANT_ADMIN_INACTIVE`);
      }

      if (await this.updateAccepted({ failures, label: 'enable', target: args, payload: { IsActive: true } })) {
        disabled = false;
        await this.signInAccepted({ failures, label: 'sign-in after enabling', credentials: { UserName: userName, Password: await readPassword() } });
      }

      if (failures.length > 0) {
        throw new Error(`${failures.length} inactive-login checks failed. ${failures.join('; ')}`);
      }
      bodyPassed = true;
    }
    finally {
      if (disabled) {
        await this.attemptUpdateTenantAdmin(args, { IsActive: true }).catch(() => undefined);
      }
      releaseError = await this.signOutAndReleaseLimiter(lastAttemptAt, bodyPassed);
    }
    if (releaseError !== undefined) {
      throw releaseError;
    }
  }
}
