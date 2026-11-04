/**
 * KATA Architecture - Layer 3: Tenant Management API Component (TEN cases)
 *
 * Platform Administrator work on tenants. Block 2.2 (create) and 2.3 (edit, logo, status, delete). Blocks 2.5 (operators, configuration) and 2.6 (detail, TenantAdmin panel) Helpers named `attempt*`
 * assert nothing and return the raw answer (the rejected-input cases read the status and the error code themselves).
 *
 * Endpoints (relative to config.apiUrl, encrypted JSON bodies):
 * - GET    /Tenant, /Tenant/{id}                  - list (SearchTerm, IncludeDeleted, Page, PageSize) and read
 * - POST   /Tenant                                - create
 * - PUT    /Tenant/{id}                           - edit (name, database data, parameters, `IsActive`); the RNEC never changes
 * - PUT    /Tenant/{id}/logo                      - logo as a data URI
 * - PATCH  /Tenant/{id}/config                    - `ValidateMacSerial` and the security parameters
 * - PATCH  /Tenant/{id}/operator                  - main and contingency operator
 * - PATCH  /Tenant/{id}/api-credentials           - API user and password
 * - DELETE /Tenant/{id}                           - soft delete (the RNEC stays reserved)
 *
 * Secret handling: database passwords and API passwords travel only in bodies; no failure message prints a body.
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, CreatedEntityData, CreateTenantPayload } from '@schemas/auth.types';
import type { TenantFullData } from '@schemas/resources.types';
import type { PagedData } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { expect, request as playwrightRequest } from '@playwright/test';
import { atc } from '@utils/decorators';

/** One row of a tenant input case: the fields that change over a valid payload and what must happen. */
interface TenantInputRow {
  label: string
  overrides: Record<string, unknown>
  outcome: 'reject' | 'accept'
  /** A fragment of the validation message the refusal must carry (not checked for `binding` rows). */
  message?: RegExp
  /** The value cannot even be read as the field's type: the answer is a plain 400, not `VALIDATION_ERROR`. */
  binding?: boolean
}

/** What the tenant list accepts. */
interface TenantListQuery {
  searchTerm?: string
  includeDeleted?: boolean
  page?: number
  pageSize?: number
}

/** What generating a tenant secret answers: the plain secret comes once, the masked one stays. */
interface TenantSecretData {
  PlainTextSecret: string
  MaskedSecret: string
  IsActive: boolean
}

/** The messages the backend gives (Spanish, accents matched loosely). */
const RNEC_MESSAGE = /RNEC es requerido|Solo letras may.sculas y n.meros/i;
const NAME_MIN_MESSAGE = /M.nimo 3 caracteres/i;
const NAME_MAX_MESSAGE = /M.ximo 255 caracteres/i;
const NAME_PATTERN_MESSAGE = /Solo letras, n.meros/i;
const HOST_MESSAGE = /Formato inv.lido/i;
const IDENTIFIER_MESSAGE = /Debe comenzar con letra/i;
const PASSWORD_MESSAGE = /M.nimo 8 caracteres/i;
const PORT_MESSAGE = /puerto debe estar entre 1 y 65535/i;
const FINGERS_MESSAGE = /dedos bloqueados debe estar entre 0 y 8/i;
const CONTINGENCY_MESSAGE = /contingencia no puede ser el mismo que el principal/i;
const DUPLICATE_RNEC_MESSAGE = /Ya existe un tenant con el RNEC/i;

/** The numeric parameters of a tenant: each must be 0 or more. */
const NUMERIC_PARAMETERS = [
  'MaxFailedLoginAttempts',
  'MaxInactivityMinutes',
  'ConsecutiveAttemptsLimit',
  'ConsecutiveAttemptsSeconds',
  'RetryLockMinutes',
  'FailedAttemptsLimit',
  'FailedAttemptsMinutes',
  'FailedLockMinutes',
  'SuccessAttemptsLimit',
  'SuccessAttemptsMinutes',
  'SuccessLockMinutes',
  'BlockedFingersMinutes',
];

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class TenantManagementApi extends SecureApi {
  // ============================================
  // Helpers (no ATC)
  // ============================================

  /** Create a tenant with ANY body; asserts nothing. */
  async attemptCreateTenant(payload: object): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    return this.securePOST<CreatedEntityData, object>('/Tenant', payload);
  }

  /** Read one tenant; asserts nothing. */
  async getTenant(tenantId: number): Promise<[APIResponse, ApiEnvelope<TenantFullData>]> {
    return this.secureGET<TenantFullData>(`/Tenant/${tenantId}`);
  }

  /** List tenants; asserts nothing. */
  async listTenants(query: TenantListQuery = {}): Promise<[APIResponse, ApiEnvelope<PagedData<TenantFullData>>]> {
    const params = new URLSearchParams();
    if (query.page !== undefined) { params.set('Page', String(query.page)); }
    if (query.pageSize !== undefined) { params.set('PageSize', String(query.pageSize)); }
    if (query.searchTerm !== undefined) { params.set('SearchTerm', query.searchTerm); }
    if (query.includeDeleted !== undefined) { params.set('IncludeDeleted', String(query.includeDeleted)); }
    const text = params.toString();
    return this.secureGET<PagedData<TenantFullData>>(`/Tenant${text === '' ? '' : `?${text}`}`);
  }

  /** Edit a tenant with ANY body; asserts nothing. */
  async attemptUpdateTenant(tenantId: number, payload: object): Promise<[APIResponse, ApiEnvelope<TenantFullData>]> {
    return this.securePUT<TenantFullData, object>(`/Tenant/${tenantId}`, payload);
  }

  /** Set the logo (a data URI); asserts nothing. */
  async attemptUpdateLogo(tenantId: number, logo: string): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.securePUT<unknown, { Logo: string }>(`/Tenant/${tenantId}/logo`, { Logo: logo });
  }

  /** Change the tenant configuration; asserts nothing. */
  async attemptUpdateConfig(tenantId: number, payload: object): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.securePATCHWithBody<unknown, object>(`/Tenant/${tenantId}/config`, payload);
  }

  /** Assign operators; asserts nothing. */
  async attemptAssignOperator(tenantId: number, payload: object): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.securePATCHWithBody<unknown, object>(`/Tenant/${tenantId}/operator`, payload);
  }

  /** Set the API credentials. Undecorated: the body carries a password; asserts nothing. */
  async attemptSetApiCredentials(tenantId: number, payload: object): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    await this.awaitSensitiveSlot();
    return this.securePATCHWithBody<unknown, object>(`/Tenant/${tenantId}/api-credentials`, payload);
  }

  /** A PATCH without a body on any tenant sub-route; asserts nothing. */
  async attemptBodylessPatch(tenantId: number, route: string): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.securePATCH<unknown>(`/Tenant/${tenantId}/${route}`);
  }

  /** Delete a tenant; asserts nothing. */
  async attemptDeleteTenant(tenantId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/Tenant/${tenantId}`);
  }

  /** The tenant (alive or deleted) with exactly this RNEC, or null. */
  private async findByRnec(rnec: string, includeDeleted = true): Promise<TenantFullData | null> {
    const [, body] = await this.listTenants({ searchTerm: rnec, includeDeleted, pageSize: 20 });
    return (body.Data?.Data ?? []).find(row => row.Rnec === rnec) ?? null;
  }

  /** First line of an error, for a failure list (no stack, no call log, never a credential). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** Create a tenant recording its id for cleanup BEFORE judging the answer. */
  private async createTracked(payload: object, createdIds: number[]): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const answer = await this.attemptCreateTenant(payload);
    const id = answer[1].Data?.Id;
    if (typeof id === 'number' && id > 0) {
      createdIds.push(id);
    }
    return answer;
  }

  /** Delete generated tenants, tolerating the ones already deleted (404 or 400 `already deleted`). Returns one line per failure. */
  private async cleanupCreated(tenantIds: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of tenantIds) {
      try {
        const [response] = await this.attemptDeleteTenant(id);
        if (![200, 400, 404].includes(response.status())) {
          failures.push(`delete tenant #${id}: HTTP ${response.status()}`);
        }
      }
      catch (error) {
        failures.push(`delete tenant #${id}: ${this.firstLine(error)}`);
      }
    }
    return failures;
  }

  /** Common frame of the TEN ATCs: one Administrator session, collected failures, cleanup, one thrown error. */
  private async runTenantCase(args: { what: string, body: (createdIds: number[], failures: string[]) => Promise<void> }): Promise<void> {
    const createdIds: number[] = [];
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      await args.body(createdIds, failures);
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      failures.push(...await this.cleanupCreated(createdIds));
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * Shared body of the create-input ATCs. The positive control first (a valid tenant), then the rows in order. A reject row the
   * product wrongly accepts is tracked and reported; an accept row it refuses is reported. A `reject` row must answer 400
   * `VALIDATION_ERROR` with its message and create nothing (looked up by the RNEC it sent).
   */
  private async runTenantRows(args: { rows: TenantInputRow[], what: string }): Promise<void> {
    await this.runTenantCase({
      what: args.what,
      body: async (createdIds, failures) => {
        const [controlResponse, controlBody] = await this.createTracked(this.data.createTenantPayload(), createdIds);
        expect(controlResponse.status(), `control (valid tenant): ${controlBody.CodeError ?? 'no error code'} ${controlBody.Error ?? ''}`).toBe(200);

        for (const row of args.rows) {
          try {
            const payload = this.data.createTenantPayload();
            Object.assign(payload, row.overrides);
            const [response, body] = await this.createTracked(payload, createdIds);
            const status = response.status();
            const created = typeof body.Data?.Id === 'number' && body.Data.Id > 0;
            if (row.outcome === 'accept') {
              verify(failures, status === 200 && body.Ok === true && created, `${row.label}: expected ACCEPTED (200), got HTTP ${status} ${body.CodeError ?? 'no error code'}`);
              continue;
            }
            if (created) {
              failures.push(`${row.label}: the product ACCEPTED the create (HTTP ${status})`);
              continue;
            }
            const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
            if (row.binding === true) {
              verify(failures, status >= 400 && status < 500 && body.Ok !== true, `${row.label}: HTTP ${status} Ok=${String(body.Ok)} (expected a 4xx refusal)`);
            }
            else if (status !== 400 || body.Ok !== false || body.CodeError !== 'VALIDATION_ERROR') {
              failures.push(`${row.label}: HTTP ${status} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 400, false, VALIDATION_ERROR)`);
            }
            else if (row.message !== undefined && !row.message.test(text)) {
              failures.push(`${row.label}: HTTP ${status} VALIDATION_ERROR, the validation message ${row.message} is missing`);
            }
            const rnec = String(payload.Rnec ?? '');
            if (rnec.trim() !== '' && (await this.findByRnec(rnec)) !== null) {
              failures.push(`${row.label}: a tenant with that RNEC exists after the rejected create`);
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
  // Test Cases (ATCs): create (block 2.2)
  // ============================================

  /**
   * TEN-010: create a tenant with the required data. 200 and an id; the tenant reads back with the same RNEC and name, active and
   * with a creator; it is the FIRST row of the list and the total goes up by exactly 1.
   */
  @atc('TEN-010')
  async createTenantWithRequiredData(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant creation',
      body: async (createdIds, failures) => {
        const [, before] = await this.listTenants({ pageSize: 1 });
        const payload = this.data.createTenantPayload();
        const [response, body] = await this.createTracked(payload, createdIds);
        const id = body.Data?.Id ?? 0;
        verify(failures, response.status() === 200 && body.Ok === true && id > 0, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        if (id === 0) {
          return;
        }
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.Rnec === payload.Rnec && read.Data?.BusinessName === payload.BusinessName, 'read: the RNEC or the name differ from what was sent');
        verify(failures, read.Data?.IsActive === true && read.Data.IsDeleted === false && (read.Data.CreatedBy ?? '') !== '', `read: IsActive=${String(read.Data?.IsActive)} IsDeleted=${String(read.Data?.IsDeleted)} CreatedBy=${String(read.Data?.CreatedBy)} (expected true, false, filled)`);
        const [, after] = await this.listTenants({ pageSize: 5 });
        verify(failures, after.Data?.TotalRecords === (before.Data?.TotalRecords ?? 0) + 1, `list total ${String(after.Data?.TotalRecords)} (expected ${(before.Data?.TotalRecords ?? 0) + 1})`);
        verify(failures, after.Data?.Data[0]?.Id === id, `the new tenant is not the first row of the list (first is #${String(after.Data?.Data[0]?.Id)})`);
      },
    });
  }

  /** TEN-011: create with a logs database (host, name, port): the tenant reads back with `LogDbConfigured` true and the port. */
  @atc('TEN-011')
  async createTenantWithLogDatabase(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant with logs database',
      body: async (createdIds, failures) => {
        const payload = this.data.createTenantPayload({ LogDbHost: 'logs.qa-aut.invalid', LogDbName: 'qa_logs', LogDbPort: 27017 });
        const [response, body] = await this.createTracked(payload, createdIds);
        verify(failures, response.status() === 200 && (body.Data?.Id ?? 0) > 0, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, read] = await this.getTenant(body.Data?.Id ?? 0);
        verify(failures, read.Data?.LogDbConfigured === true && read.Data.LogDbPort === 27017, `read: LogDbConfigured=${String(read.Data?.LogDbConfigured)} LogDbPort=${String(read.Data?.LogDbPort)} (expected true and 27017)`);
      },
    });
  }

  /** TEN-012: the MAC-Serial validation is turned on after the create with `PATCH /config`: 200 and the tenant reads back with it on. */
  @atc('TEN-012')
  async createTenantAndEnableMacSerialValidation(): Promise<void> {
    await this.runTenantCase({
      what: 'MAC-Serial validation',
      body: async (createdIds, failures) => {
        const [response, body] = await this.createTracked(this.data.createTenantPayload(), createdIds);
        const id = body.Data?.Id ?? 0;
        verify(failures, response.status() === 200 && id > 0, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, before] = await this.getTenant(id);
        verify(failures, before.Data?.ValidateMacSerial === false, `before: ValidateMacSerial=${String(before.Data?.ValidateMacSerial)} (expected false)`);
        const [configResponse, config] = await this.attemptUpdateConfig(id, { ValidateMacSerial: true });
        verify(failures, configResponse.status() === 200 && config.Ok === true, `PATCH config: HTTP ${configResponse.status()} ${config.CodeError ?? 'no error code'}`);
        const [, after] = await this.getTenant(id);
        verify(failures, after.Data?.ValidateMacSerial === true, `after: ValidateMacSerial=${String(after.Data?.ValidateMacSerial)} (expected true)`);
      },
    });
  }

  /** TEN-014: an empty RNEC, one with lower case, a symbol or a space is refused (400 `VALIDATION_ERROR`, nothing created). */
  @atc('TEN-014')
  async rejectInvalidRnecs(): Promise<void> {
    const rows: TenantInputRow[] = [
      { label: 'RNEC (empty)', overrides: { Rnec: '' }, outcome: 'reject', message: RNEC_MESSAGE },
      { label: 'RNEC (lower case)', overrides: { Rnec: 'abc1' }, outcome: 'reject', message: RNEC_MESSAGE },
      { label: 'RNEC (symbol)', overrides: { Rnec: 'AB-1' }, outcome: 'reject', message: RNEC_MESSAGE },
      { label: 'RNEC (space)', overrides: { Rnec: 'AB 1' }, outcome: 'reject', message: RNEC_MESSAGE },
    ];
    await this.runTenantRows({ rows, what: 'tenant RNEC' });
  }

  /** TEN-015: a second tenant with an existing RNEC is refused (400, the RNEC message) and only one tenant keeps it. */
  @atc('TEN-015')
  async rejectDuplicateRnec(): Promise<void> {
    await this.runTenantCase({
      what: 'duplicate RNEC',
      body: async (createdIds, failures) => {
        const first = this.data.createTenantPayload();
        const [firstResponse, firstBody] = await this.createTracked(first, createdIds);
        expect(firstResponse.status(), `control (first tenant): ${firstBody.CodeError ?? 'no error code'}`).toBe(200);

        const second = this.data.createTenantPayload({ Rnec: first.Rnec });
        const [response, body] = await this.createTracked(second, createdIds);
        const created = typeof body.Data?.Id === 'number' && body.Data.Id > 0;
        if (created) {
          failures.push(`the product ACCEPTED a second tenant with the same RNEC (HTTP ${response.status()})`);
        }
        else {
          const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
          verify(failures, response.status() === 400 && body.Ok === false && DUPLICATE_RNEC_MESSAGE.test(text), `duplicate RNEC: HTTP ${response.status()} Ok=${String(body.Ok)}, message ${DUPLICATE_RNEC_MESSAGE} ${DUPLICATE_RNEC_MESSAGE.test(text) ? 'present' : 'missing'}`);
        }
        const [, list] = await this.listTenants({ searchTerm: String(first.Rnec), pageSize: 20 });
        verify(failures, (list.Data?.Data ?? []).filter(row => row.Rnec === first.Rnec).length === 1, 'more than one tenant holds the RNEC after the duplicate create');
      },
    });
  }

  /** TEN-016: a business name of 2 characters or with symbols not allowed is refused, 256 is refused; 3 and 255 are accepted (last). */
  @atc('TEN-016')
  async rejectInvalidBusinessNames(): Promise<void> {
    const rows: TenantInputRow[] = [
      { label: 'name (2 characters)', overrides: { BusinessName: this.data.createBusinessNameOfLength(2) }, outcome: 'reject', message: NAME_MIN_MESSAGE },
      { label: 'name (256 characters)', overrides: { BusinessName: this.data.createBusinessNameOfLength(256) }, outcome: 'reject', message: NAME_MAX_MESSAGE },
      { label: 'name (symbols not allowed)', overrides: { BusinessName: 'Tenant@@#' }, outcome: 'reject', message: NAME_PATTERN_MESSAGE },
      { label: 'name (3 characters)', overrides: { BusinessName: this.data.createBusinessNameOfLength(3) }, outcome: 'accept' },
      { label: 'name (255 characters)', overrides: { BusinessName: this.data.createBusinessNameOfLength(255) }, outcome: 'accept' },
    ];
    await this.runTenantRows({ rows, what: 'tenant business name' });
  }

  /**
   * TEN-017: database hosts. `localhost`, an IP, `host:5432` and `SERVIDOR\INSTANCIA` are accepted (last); a host with a space or a
   * `$` is refused; the logs host refuses `host:5432`.
   */
  @atc('TEN-017')
  async validateDatabaseHosts(): Promise<void> {
    const rows: TenantInputRow[] = [
      { label: 'DbHost (space)', overrides: { DbHost: 'mi servidor' }, outcome: 'reject', message: HOST_MESSAGE },
      { label: 'DbHost (dollar sign)', overrides: { DbHost: 'servidor$1' }, outcome: 'reject', message: HOST_MESSAGE },
      { label: 'LogDbHost (host:port)', overrides: { LogDbHost: 'logs.servidor.com:5432', LogDbName: 'qa_logs' }, outcome: 'reject', message: HOST_MESSAGE },
      { label: 'DbHost (localhost)', overrides: { DbHost: 'localhost' }, outcome: 'accept' },
      { label: 'DbHost (IP)', overrides: { DbHost: '192.168.1.10' }, outcome: 'accept' },
      { label: 'DbHost (host:port)', overrides: { DbHost: 'db.servidor.com:5432' }, outcome: 'accept' },
      { label: 'DbHost (server\\instance)', overrides: { DbHost: 'SERVIDOR\\INSTANCIA' }, outcome: 'accept' },
    ];
    await this.runTenantRows({ rows, what: 'tenant database host' });
  }

  /** TEN-018: a database name or user that starts with a digit, a symbol or a space is refused; `_db1`, `db-name`, `smoke.user`, `u-1` are accepted (last). */
  @atc('TEN-018')
  async validateDatabaseNameAndUser(): Promise<void> {
    const rows: TenantInputRow[] = [
      { label: 'DbName (starts with a digit)', overrides: { DbName: '1db' }, outcome: 'reject', message: IDENTIFIER_MESSAGE },
      { label: 'DbName (starts with a symbol)', overrides: { DbName: '$db' }, outcome: 'reject', message: IDENTIFIER_MESSAGE },
      { label: 'DbName (starts with a space)', overrides: { DbName: ' db' }, outcome: 'reject', message: IDENTIFIER_MESSAGE },
      { label: 'DbUser (starts with a digit)', overrides: { DbUser: '1user' }, outcome: 'reject', message: IDENTIFIER_MESSAGE },
      { label: 'DbUser (starts with a space)', overrides: { DbUser: ' user' }, outcome: 'reject', message: IDENTIFIER_MESSAGE },
      { label: 'DbName (_db1)', overrides: { DbName: '_db1' }, outcome: 'accept' },
      { label: 'DbName (db-name)', overrides: { DbName: 'db-name' }, outcome: 'accept' },
      { label: 'DbUser (smoke.user)', overrides: { DbUser: 'smoke.user' }, outcome: 'accept' },
      { label: 'DbUser (u-1)', overrides: { DbUser: 'u-1' }, outcome: 'accept' },
    ];
    await this.runTenantRows({ rows, what: 'tenant database name and user' });
  }

  /** TEN-019: a database password of 7 characters is refused and one of 8 is accepted (last). */
  @atc('TEN-019')
  async validateDatabasePasswordLength(): Promise<void> {
    const rows: TenantInputRow[] = [
      { label: 'DbPassword (7 characters)', overrides: { DbPassword: 'Abcdef1' }, outcome: 'reject', message: PASSWORD_MESSAGE },
      { label: 'DbPassword (8 characters)', overrides: { DbPassword: 'Abcdef12' }, outcome: 'accept' },
    ];
    await this.runTenantRows({ rows, what: 'tenant database password' });
  }

  /** TEN-020: a logs port of 0, 65536, 70000 or text is refused; 1 and 65535 are accepted (last). */
  @atc('TEN-020')
  async validateLogDatabasePort(): Promise<void> {
    const logs = { LogDbHost: 'logs.qa-aut.invalid', LogDbName: 'qa_logs' };
    const rows: TenantInputRow[] = [
      { label: 'port 0', overrides: { ...logs, LogDbPort: 0 }, outcome: 'reject', message: PORT_MESSAGE },
      { label: 'port 65536', overrides: { ...logs, LogDbPort: 65536 }, outcome: 'reject', message: PORT_MESSAGE },
      { label: 'port 70000', overrides: { ...logs, LogDbPort: 70000 }, outcome: 'reject', message: PORT_MESSAGE },
      { label: 'port text', overrides: { ...logs, LogDbPort: 'abc' }, outcome: 'reject', binding: true },
      { label: 'port 1', overrides: { ...logs, LogDbPort: 1 }, outcome: 'accept' },
      { label: 'port 65535', overrides: { ...logs, LogDbPort: 65535 }, outcome: 'accept' },
    ];
    await this.runTenantRows({ rows, what: 'tenant logs port' });
  }

  /** TEN-022: a contingency operator equal to the main operator is refused (400 `VALIDATION_ERROR`, nothing created). */
  @atc('TEN-022')
  async rejectContingencyEqualToMainOperator(): Promise<void> {
    const rows: TenantInputRow[] = [
      { label: 'contingency equal to main', overrides: { MainOperatorId: 7, ContingencyOperatorId: 7 }, outcome: 'reject', message: CONTINGENCY_MESSAGE },
    ];
    await this.runTenantRows({ rows, what: 'tenant contingency operator' });
  }

  /** TEN-023: a negative number in any numeric parameter, or a decimal, is refused (nothing created). */
  @atc('TEN-023')
  async rejectNegativeAndDecimalParameters(): Promise<void> {
    const rows: TenantInputRow[] = [
      ...NUMERIC_PARAMETERS.map<TenantInputRow>(name => ({ label: `${name} = -1`, overrides: { [name]: -1 }, outcome: 'reject' })),
      { label: 'MaxInactivityMinutes = 1.5', overrides: { MaxInactivityMinutes: 1.5 }, outcome: 'reject', binding: true },
      { label: 'RetryLockMinutes = 2.5', overrides: { RetryLockMinutes: 2.5 }, outcome: 'reject', binding: true },
    ];
    await this.runTenantRows({ rows, what: 'tenant numeric parameters' });
  }

  /** TEN-024: `BlockedFingersLimit` 9 is refused; 0 and 8 are accepted (last). */
  @atc('TEN-024')
  async validateBlockedFingersLimit(): Promise<void> {
    const rows: TenantInputRow[] = [
      { label: 'BlockedFingersLimit 9', overrides: { BlockedFingersLimit: 9 }, outcome: 'reject', message: FINGERS_MESSAGE },
      { label: 'BlockedFingersLimit 0', overrides: { BlockedFingersLimit: 0 }, outcome: 'accept' },
      { label: 'BlockedFingersLimit 8', overrides: { BlockedFingersLimit: 8 }, outcome: 'accept' },
    ];
    await this.runTenantRows({ rows, what: 'tenant blocked fingers limit' });
  }

  /** TEN-025: a tenant created with only the required fields reads back with no parameters (null), the flags off and no logs database or operators. */
  @atc('TEN-025')
  async createTenantWithOnlyRequiredFields(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant defaults',
      body: async (createdIds, failures) => {
        const payload = this.data.createTenantPayload({ MaxFailedLoginAttempts: undefined });
        const [response, body] = await this.createTracked(payload, createdIds);
        verify(failures, response.status() === 200 && (body.Data?.Id ?? 0) > 0, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, read] = await this.getTenant(body.Data?.Id ?? 0);
        const data = read.Data;
        const parameters = [...NUMERIC_PARAMETERS, 'BlockedFingersLimit'] as Array<keyof TenantFullData>;
        const set = parameters.filter(name => data?.[name] !== null && data?.[name] !== undefined);
        verify(failures, set.length === 0, `parameters with a value after a create without them: ${set.join(', ')} (expected none)`);
        verify(failures, data?.HitTwoFingers === false && data.RequireLocation === false && data.ManualFingerSelection === false && data.ValidateMacSerial === false, 'a flag is on after a create without it');
        verify(failures, data?.LogDbConfigured === false && (data.MainOperatorId ?? null) === null && (data.ContingencyOperatorId ?? null) === null, 'logs database or operators are set after a create without them');
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): edit, logo, status and delete (block 2.3)
  // ============================================

  /** Create a valid tenant for an edit case: tracked, asserted. Returns its id and payload. */
  private async createForEdit(createdIds: number[]): Promise<{ id: number, payload: CreateTenantPayload }> {
    const payload = this.data.createTenantPayload();
    const [response, body] = await this.createTracked(payload, createdIds);
    expect(response.status(), `control (create): ${body.CodeError ?? 'no error code'}`).toBe(200);
    return { id: body.Data?.Id ?? 0, payload };
  }

  /** TEN-030: the business name and the security parameters change with `PUT`; the tenant reads back with them and `UpdatedBy`. */
  @atc('TEN-030')
  async editBusinessNameAndParameters(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant edit',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const edit = { BusinessName: this.data.createBusinessNameOfLength(20), MaxFailedLoginAttempts: 5, MaxInactivityMinutes: 20, BlockedFingersLimit: 4, HitTwoFingers: true, RequireLocation: true };
        const [response, body] = await this.attemptUpdateTenant(id, edit);
        verify(failures, response.status() === 200 && body.Ok === true, `PUT: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, read] = await this.getTenant(id);
        const data = read.Data;
        verify(failures, data?.BusinessName === edit.BusinessName, 'the business name did not change');
        verify(failures, data?.MaxFailedLoginAttempts === 5 && data.MaxInactivityMinutes === 20 && data.BlockedFingersLimit === 4, `parameters read back: ${String(data?.MaxFailedLoginAttempts)}, ${String(data?.MaxInactivityMinutes)}, ${String(data?.BlockedFingersLimit)} (expected 5, 20, 4)`);
        verify(failures, data?.HitTwoFingers === true && data.RequireLocation === true, 'the flags did not change');
        verify(failures, (data?.UpdatedBy ?? '') !== '', 'UpdatedBy is empty after the edit');
      },
    });
  }

  /** TEN-031: the RNEC cannot be edited: a `PUT` that also sends another RNEC leaves the RNEC as it was. */
  @atc('TEN-031')
  async keepRnecOnEdit(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant RNEC edit',
      body: async (createdIds, failures) => {
        const { id, payload } = await this.createForEdit(createdIds);
        const other = this.data.createRnecOfLength(10);
        const [response, body] = await this.attemptUpdateTenant(id, { BusinessName: this.data.createBusinessNameOfLength(20), Rnec: other });
        verify(failures, (response.status() === 200 && body.Ok === true) || (response.status() === 400 && body.Ok === false), `PUT with another RNEC: HTTP ${response.status()} (expected 200 ignoring it, or a 400)`);
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.Rnec === payload.Rnec, 'the RNEC changed after the edit');
        verify(failures, (await this.findByRnec(other)) === null, 'a tenant holds the RNEC that was sent in the PUT');
      },
    });
  }

  /** TEN-032: an edit with a business name of 2 characters, one with symbols or an empty one gets the same refusals as the create; the name stays. */
  @atc('TEN-032')
  async rejectInvalidDataOnEdit(): Promise<void> {
    await this.runTenantCase({
      what: 'invalid tenant edit',
      body: async (createdIds, failures) => {
        const { id, payload } = await this.createForEdit(createdIds);
        const rows = [
          { label: 'name (2 characters)', name: this.data.createBusinessNameOfLength(2), message: NAME_MIN_MESSAGE },
          { label: 'name (symbols not allowed)', name: 'Tenant@@#', message: NAME_PATTERN_MESSAGE },
          { label: 'name (empty)', name: '', message: /vac.o|requerido/i },
        ];
        for (const row of rows) {
          const [response, body] = await this.attemptUpdateTenant(id, { BusinessName: row.name });
          const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
          verify(failures, response.status() === 400 && body.Ok === false && body.CodeError === 'VALIDATION_ERROR' && row.message.test(text), `edit to ${row.label}: HTTP ${response.status()} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)}, message ${row.message} ${row.message.test(text) ? 'present' : 'missing'} (expected the create refusal)`);
        }
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.BusinessName === payload.BusinessName, `the business name is now ${String(read.Data?.BusinessName)} after the refused edits`);
      },
    });
  }

  /** TEN-033: a valid PNG logo is accepted (200) and the tenant reads back with it. */
  @atc('TEN-033')
  async saveValidLogo(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant logo',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const logo = this.data.validLogoPng;
        const [response, body] = await this.attemptUpdateLogo(id, logo);
        verify(failures, response.status() === 200 && body.Ok === true, `logo: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.Logo === logo, 'the tenant does not read back the logo that was saved');
      },
    });
  }

  /**
   * TEN-034: a logo that is not PNG, JPEG or WEBP (a GIF), a text declared as `image/png` and a PNG of 750 KB (the limit is 500 KB)
   * are refused (a 4xx) and the tenant keeps no logo. The backend only checks the declared type and a 2 MB size.
   */
  @atc('TEN-034')
  async rejectInvalidLogos(): Promise<void> {
    await this.runTenantCase({
      what: 'invalid tenant logo',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const rows = [
          { label: 'GIF', logo: this.data.gifLogo },
          { label: 'text declared as image/png', logo: this.data.createTextLogoDeclaredAsPng() },
          { label: 'PNG of 750 KB', logo: this.data.createPngLogoOfKilobytes(750) },
        ];
        for (const row of rows) {
          const [response, body] = await this.attemptUpdateLogo(id, row.logo);
          verify(failures, response.status() >= 400 && response.status() < 500 && body.Ok !== true, `logo ${row.label}: HTTP ${response.status()} Ok=${String(body.Ok)} (expected a 4xx refusal)`);
        }
        const [, read] = await this.getTenant(id);
        verify(failures, (read.Data?.Logo ?? null) === null, 'the tenant keeps a logo after the refused ones');
      },
    });
  }

  /** TEN-035: `PUT { IsActive: false }` disables the tenant: 200, it reads back inactive and still shows in the list. */
  @atc('TEN-035')
  async disableTenant(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant disable',
      body: async (createdIds, failures) => {
        const { id, payload } = await this.createForEdit(createdIds);
        const [response, body] = await this.attemptUpdateTenant(id, { IsActive: false });
        verify(failures, response.status() === 200 && body.Ok === true, `disable: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.IsActive === false, `after the disable IsActive=${String(read.Data?.IsActive)} (expected false)`);
        const listed = await this.findByRnec(String(payload.Rnec), false);
        verify(failures, listed !== null && listed.IsActive === false, 'the disabled tenant is missing from the list or reads active there');
      },
    });
  }

  /** TEN-036: `PUT { IsActive: true }` enables a disabled tenant: 200 and it reads back active. */
  @atc('TEN-036')
  async enableTenant(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant enable',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const [disable] = await this.attemptUpdateTenant(id, { IsActive: false });
        expect(disable.status(), 'control: the tenant is disabled first').toBe(200);
        const [response, body] = await this.attemptUpdateTenant(id, { IsActive: true });
        verify(failures, response.status() === 200 && body.Ok === true, `enable: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.IsActive === true, `after the enable IsActive=${String(read.Data?.IsActive)} (expected true)`);
      },
    });
  }

  /** TEN-038: the status moves with `PUT { IsActive }`; the routes `activate` and `deactivate` do not exist (404 or 405) and change nothing. */
  @atc('TEN-038')
  async changeStatusOnlyWithPut(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant status endpoint',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const [put] = await this.attemptUpdateTenant(id, { IsActive: false });
        verify(failures, put.status() === 200, `PUT IsActive: HTTP ${put.status()} (expected 200)`);
        for (const route of ['activate', 'deactivate']) {
          const [response] = await this.attemptBodylessPatch(id, route);
          verify(failures, [404, 405].includes(response.status()), `PATCH /${route}: HTTP ${response.status()} (expected 404 or 405: the route is not exposed)`);
        }
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.IsActive === false, 'the status changed through a route that should not exist');
      },
    });
  }

  /** TEN-040: deleting is a soft delete: 200, the tenant leaves the normal list and shows with `IncludeDeleted` (deleted, who and when); a second delete answers 400. */
  @atc('TEN-040')
  async deleteTenantSoftly(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant delete',
      body: async (createdIds, failures) => {
        const { id, payload } = await this.createForEdit(createdIds);
        const rnec = String(payload.Rnec);
        const [response, body] = await this.attemptDeleteTenant(id);
        verify(failures, response.status() === 200 && body.Ok === true, `delete: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        verify(failures, (await this.findByRnec(rnec, false)) === null, 'the deleted tenant still shows in the normal list');
        const history = await this.findByRnec(rnec, true);
        verify(failures, history !== null && history.IsDeleted === true && (history.DeletedAt ?? '') !== '' && (history.DeletedBy ?? '') !== '', 'the deleted tenant is missing with IncludeDeleted or lacks IsDeleted, DeletedAt or DeletedBy');
        const [again, againBody] = await this.attemptDeleteTenant(id);
        verify(failures, again.status() === 400 && againBody.Ok === false, `second delete: HTTP ${again.status()} Ok=${String(againBody.Ok)} (expected 400, false)`);
      },
    });
  }

  /**
   * TEN-041: a tenant with children (a branch, a UserApp and a TenantAdmin) must not be deleted (owner decision, 2026-11-04): the delete
   * is refused (a 4xx), the tenant stays active and its branches stay reachable. The product deletes it without checking children
   * today (HAL-17), so this fails. The children come from `TenantChildrenSteps`, which also removes them.
   */
  @atc('TEN-041')
  async refuseDeletingTenantWithChildren(tenantId: number): Promise<void> {
    await this.runTenantCase({
      what: 'tenant delete with children',
      body: async (_createdIds, failures) => {
        const [response, body] = await this.attemptDeleteTenant(tenantId);
        verify(failures, response.status() >= 400 && response.status() < 500 && body.Ok !== true, `delete with children: HTTP ${response.status()} Ok=${String(body.Ok)} (expected a 4xx refusal)`);
        const [, read] = await this.getTenant(tenantId);
        verify(failures, read.Data?.IsDeleted === false && read.Data.IsActive === true, `after the delete IsDeleted=${String(read.Data?.IsDeleted)} IsActive=${String(read.Data?.IsActive)} (expected false, true)`);
        const [branches] = await this.secureGET<unknown>(`/tenants/${tenantId}/branches?PageSize=1`);
        verify(failures, branches.status() === 200, `the branches of the tenant answer HTTP ${branches.status()} after the delete (expected 200)`);
      },
    });
  }

  /** TEN-042: the RNEC of a deleted tenant stays reserved (owner decision, 2026-11-04): a new tenant with it is refused (400, the RNEC message). */
  @atc('TEN-042')
  async keepRnecReservedAfterDelete(): Promise<void> {
    await this.runTenantCase({
      what: 'RNEC of a deleted tenant',
      body: async (createdIds, failures) => {
        const { id, payload } = await this.createForEdit(createdIds);
        const [deleted] = await this.attemptDeleteTenant(id);
        expect(deleted.status(), 'control: the tenant is deleted').toBe(200);
        const [response, body] = await this.createTracked(this.data.createTenantPayload({ Rnec: payload.Rnec }), createdIds);
        const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
        if (typeof body.Data?.Id === 'number' && body.Data.Id > 0) {
          failures.push(`the product ACCEPTED a new tenant with the RNEC of a deleted one (HTTP ${response.status()})`);
        }
        else {
          verify(failures, response.status() === 400 && body.Ok === false && DUPLICATE_RNEC_MESSAGE.test(text), `reuse of the RNEC: HTTP ${response.status()} Ok=${String(body.Ok)}, message ${DUPLICATE_RNEC_MESSAGE.test(text) ? 'present' : 'missing'} (expected 400 and the RNEC message)`);
        }
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): API credentials, secret and sensitive fields (block 2.4)
  // ============================================

  /** Generate a tenant secret; asserts nothing. Undecorated: the body carries the Administrator password and the secret. */
  private async attemptGenerateSecret(tenantId: number, body: { AdminPassword: string, CustomSecret?: string }, paced = true): Promise<[APIResponse, ApiEnvelope<TenantSecretData>]> {
    if (paced) { await this.awaitSensitiveSlot(); }
    return this.securePOST<TenantSecretData, typeof body>(`/Tenant/${tenantId}/secret`, body);
  }

  /** Revoke the tenant secret; asserts nothing. Undecorated: the body carries the Administrator password. */
  private async attemptRevokeSecret(tenantId: number, adminPassword: string): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    await this.awaitSensitiveSlot();
    return this.securePATCHWithBody<unknown, { AdminPassword: string }>(`/Tenant/${tenantId}/secret/revoke`, { AdminPassword: adminPassword });
  }

  /** Reveal one sensitive field; asserts nothing. Undecorated: the body carries the Administrator password. */
  private async attemptReveal(route: 'db-config' | 'api-credentials', tenantId: number, adminPassword: string, field: string): Promise<[APIResponse, ApiEnvelope<{ Value?: string | null }>]> {
    await this.awaitSensitiveSlot();
    return this.securePOST<{ Value?: string | null }, { AdminPassword: string, Field: string }>(`/Tenant/${tenantId}/${route}/detail`, { AdminPassword: adminPassword, Field: field });
  }

  /** The Administrator password of the suite (read by name, never printed). */
  private get adminPassword(): string {
    return this.config.testUser.password;
  }

  /**
   * One machine login with the tenant's client id (the RNEC) and client secret, no body: the secret is judged first, so the error
   * code tells whether the secret is accepted. Returns only the status and the code. Undecorated: the secret is a secret.
   */
  private async apiLoginWithSecret(rnec: string, secret: string): Promise<{ status: number, code: string | null }> {
    const [response, body] = await this.apiPOST<ApiEnvelope<unknown>, { Data: string }>('/Auth/login/api', { Data: '' }, { headers: { ClientId: rnec, ClientSecret: secret } });
    return { status: response.status(), code: body.CodeError ?? null };
  }

  /** Shared body of the API credential rows (TEN-051 to 053): a fresh tenant, the rows in order, accepted rows last. */
  private async runCredentialRows(args: { rows: Array<{ label: string, user?: string, password?: string, outcome: 'reject' | 'accept', message?: RegExp }>, what: string }): Promise<void> {
    await this.runTenantCase({
      what: args.what,
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        for (const row of args.rows) {
          const credentials = { ApiUsername: row.user ?? this.data.createApiUsername(), ApiPassword: row.password ?? this.data.createApiPassword() };
          const [response, body] = await this.attemptSetApiCredentials(id, credentials);
          if (row.outcome === 'accept') {
            verify(failures, response.status() === 200 && body.Ok === true, `${row.label}: expected ACCEPTED (200), got HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
            continue;
          }
          const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
          if (response.status() !== 400 || body.Ok !== false || body.CodeError !== 'VALIDATION_ERROR') {
            failures.push(`${row.label}: HTTP ${response.status()} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 400, false, VALIDATION_ERROR)`);
          }
          else if (row.message !== undefined && !row.message.test(text)) {
            failures.push(`${row.label}: HTTP ${response.status()} VALIDATION_ERROR, the validation message ${row.message} is missing`);
          }
        }
      },
    });
  }

  /** TEN-050: valid API credentials are accepted (200) and the tenant goes from `HasApiCredentials` false to true. */
  @atc('TEN-050')
  async setValidApiCredentials(): Promise<void> {
    await this.runTenantCase({
      what: 'API credentials',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const [, before] = await this.getTenant(id);
        verify(failures, before.Data?.HasApiCredentials === false, `before: HasApiCredentials=${String(before.Data?.HasApiCredentials)} (expected false)`);
        const [response, body] = await this.attemptSetApiCredentials(id, { ApiUsername: this.data.createApiUsername(), ApiPassword: this.data.createApiPassword() });
        verify(failures, response.status() === 200 && body.Ok === true, `set: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, after] = await this.getTenant(id);
        verify(failures, after.Data?.HasApiCredentials === true, `after: HasApiCredentials=${String(after.Data?.HasApiCredentials)} (expected true)`);
      },
    });
  }

  /** TEN-051: an API password of 11 characters is refused («Mínimo 12»); one of exactly 12 is accepted (last). */
  @atc('TEN-051')
  async validateApiPasswordLength(): Promise<void> {
    await this.runCredentialRows({
      what: 'API password length',
      rows: [
        { label: 'password (11 characters)', password: `Qa1!${'x'.repeat(7)}`, outcome: 'reject', message: /M.nimo 12 caracteres/i },
        { label: 'password (12 characters)', password: `Qa1!${'x'.repeat(8)}`, outcome: 'accept' },
      ],
    });
  }

  /** TEN-052: an API password without upper case, lower case, a digit or a special character is refused with the message of that rule. */
  @atc('TEN-052')
  async validateApiPasswordComplexity(): Promise<void> {
    const messages = [/may.scula/i, /min.scula/i, /n.mero/i, /car.cter especial/i];
    await this.runCredentialRows({
      what: 'API password complexity',
      rows: this.data.createWeakApiPasswords().map((row, index) => ({ label: `password (${row.label})`, password: row.value, outcome: 'reject', message: messages[index] })),
    });
  }

  /** TEN-053: an API user of 2 characters, with a space or of 51 is refused; one of 50 is accepted (last). */
  @atc('TEN-053')
  async validateApiUsername(): Promise<void> {
    const fifty = `qax${'a'.repeat(47)}`;
    await this.runCredentialRows({
      what: 'API user name',
      rows: [
        { label: 'user (2 characters)', user: 'ab', outcome: 'reject', message: /m.nimo 4/i },
        { label: 'user (with a space)', user: 'ab cd', outcome: 'reject', message: /solo puede contener letras/i },
        { label: 'user (51 characters)', user: `${fifty}b`, outcome: 'reject', message: /superar los 50/i },
        { label: 'user (50 characters)', user: fifty, outcome: 'accept' },
      ],
    });
  }

  /**
   * TEN-054: an automatic secret with the right Administrator password: 200, the plain secret comes in the answer (once), the masked
   * one is different from it and the tenant reads back with an ACTIVE masked secret.
   */
  @atc('TEN-054')
  async generateAutomaticSecret(): Promise<void> {
    await this.runTenantCase({
      what: 'automatic secret',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const [response, body] = await this.attemptGenerateSecret(id, { AdminPassword: this.adminPassword });
        const plain = body.Data?.PlainTextSecret ?? '';
        verify(failures, response.status() === 200 && body.Ok === true && plain.length >= 32, `generate: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}, the plain secret has ${plain.length} characters (expected 32 or more)`);
        verify(failures, (body.Data?.MaskedSecret ?? '') !== '' && body.Data?.MaskedSecret !== plain && body.Data?.IsActive === true, 'the masked secret is empty, equals the plain one or is not active');
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.TenantSecretIsActive === true && (read.Data.TenantSecretMasked ?? '') !== '' && read.Data.TenantSecretMasked !== plain, 'the tenant does not read back an active masked secret');
      },
    });
  }

  /** TEN-055: a wrong Administrator password is refused with 401 `ADMIN_PASSWORD_INVALID` and the tenant keeps no secret. */
  @atc('TEN-055')
  async refuseSecretWithWrongAdminPassword(): Promise<void> {
    await this.runTenantCase({
      what: 'secret with a wrong password',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const [response, body] = await this.attemptGenerateSecret(id, { AdminPassword: this.data.createWrongPassword() });
        verify(failures, response.status() === 401 && body.Ok === false && body.CodeError === 'ADMIN_PASSWORD_INVALID', `wrong password: HTTP ${response.status()} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 401, false, ADMIN_PASSWORD_INVALID)`);
        verify(failures, (body.Data?.PlainTextSecret ?? '') === '', 'a plain secret came back with a wrong password');
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.TenantSecretIsActive !== true && (read.Data?.TenantSecretMasked ?? null) === null, 'the tenant has a secret after the refused generation');
      },
    });
  }

  /** TEN-056: a custom secret of 31 characters is refused («Mínimo 32»); one of exactly 32 is accepted (last). */
  @atc('TEN-056')
  async validateCustomSecretLength(): Promise<void> {
    await this.runTenantCase({
      what: 'custom secret length',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const [short, shortBody] = await this.attemptGenerateSecret(id, { AdminPassword: this.adminPassword, CustomSecret: this.data.createTenantSecret(31) });
        const text = `${shortBody.Error ?? ''} ${JSON.stringify(shortBody.ValidationErrors ?? [])}`;
        verify(failures, short.status() === 400 && shortBody.CodeError === 'VALIDATION_ERROR' && /M.nimo 32 caracteres/i.test(text), `31 characters: HTTP ${short.status()} CodeError=${String(shortBody.CodeError)}, message ${/M.nimo 32 caracteres/i.test(text) ? 'present' : 'missing'} (expected 400, VALIDATION_ERROR, «Mínimo 32»)`);
        const [exact, exactBody] = await this.attemptGenerateSecret(id, { AdminPassword: this.adminPassword, CustomSecret: this.data.createTenantSecret(32) });
        verify(failures, exact.status() === 200 && exactBody.Ok === true, `32 characters: HTTP ${exact.status()} ${exactBody.CodeError ?? 'no error code'} (expected 200)`);
      },
    });
  }

  /** TEN-057: a custom secret without upper case, lower case, a digit or a special character is refused with the message of that rule. */
  @atc('TEN-057')
  async validateCustomSecretComplexity(): Promise<void> {
    await this.runTenantCase({
      what: 'custom secret complexity',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const messages = [/may.scula/i, /min.scula/i, /n.mero/i, /car.cter especial/i];
        for (const [index, row] of this.data.createWeakTenantSecrets().entries()) {
          const [response, body] = await this.attemptGenerateSecret(id, { AdminPassword: this.adminPassword, CustomSecret: row.value });
          const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
          verify(failures, response.status() === 400 && body.CodeError === 'VALIDATION_ERROR' && messages[index].test(text), `secret (${row.label}): HTTP ${response.status()} CodeError=${String(body.CodeError)}, message ${messages[index]} ${messages[index].test(text) ? 'present' : 'missing'}`);
        }
        const [, read] = await this.getTenant(id);
        verify(failures, read.Data?.TenantSecretIsActive !== true, 'the tenant has an active secret after the refused ones');
      },
    });
  }

  /** TEN-058: the plain secret is shown once. After generating it, reading the tenant (alone and in the list) returns only the masked secret, never the plain one. */
  @atc('TEN-058')
  async showPlainSecretOnlyOnce(): Promise<void> {
    await this.runTenantCase({
      what: 'plain secret shown once',
      body: async (createdIds, failures) => {
        const { id, payload } = await this.createForEdit(createdIds);
        const [, generated] = await this.attemptGenerateSecret(id, { AdminPassword: this.adminPassword });
        const plain = generated.Data?.PlainTextSecret ?? '';
        expect(plain.length, 'control: the plain secret came with the generation').toBeGreaterThanOrEqual(32);
        const [, read] = await this.getTenant(id);
        const [, list] = await this.listTenants({ searchTerm: String(payload.Rnec), pageSize: 5 });
        verify(failures, !JSON.stringify(read).includes(plain), 'the plain secret is in the tenant read');
        verify(failures, !JSON.stringify(list).includes(plain), 'the plain secret is in the tenant list');
        verify(failures, (read.Data?.TenantSecretMasked ?? '') !== '' && read.Data?.TenantSecretMasked !== plain, 'the tenant read does not carry a masked secret');
      },
    });
  }

  /**
   * TEN-059: revoking. A wrong Administrator password is refused (401 `ADMIN_PASSWORD_INVALID`) and the secret stays active; the right one
   * answers 200 and leaves the secret inactive; the machine login then answers `SECRET_NOT_ACTIVE`.
   */
  @atc('TEN-059')
  async revokeSecret(): Promise<void> {
    let lastFailureAt: number | undefined;
    try {
      await this.runTenantCase({
        what: 'secret revoke',
        body: async (createdIds, failures) => {
          const { id, payload } = await this.createForEdit(createdIds);
          const [, generated] = await this.attemptGenerateSecret(id, { AdminPassword: this.adminPassword });
          const plain = generated.Data?.PlainTextSecret ?? '';
          expect(plain.length, 'control: a secret was generated').toBeGreaterThanOrEqual(32);

          const [wrong, wrongBody] = await this.attemptRevokeSecret(id, this.data.createWrongPassword());
          verify(failures, wrong.status() === 401 && wrongBody.CodeError === 'ADMIN_PASSWORD_INVALID', `revoke with a wrong password: HTTP ${wrong.status()} CodeError=${String(wrongBody.CodeError)} (expected 401, ADMIN_PASSWORD_INVALID)`);
          const [, still] = await this.getTenant(id);
          verify(failures, still.Data?.TenantSecretIsActive === true, 'the secret is not active after a refused revoke');

          const [response, body] = await this.attemptRevokeSecret(id, this.adminPassword);
          verify(failures, response.status() === 200 && body.Ok === true, `revoke: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          const [, after] = await this.getTenant(id);
          verify(failures, after.Data?.TenantSecretIsActive === false, `after the revoke TenantSecretIsActive=${String(after.Data?.TenantSecretIsActive)} (expected false)`);

          const login = await this.apiLoginWithSecret(String(payload.Rnec), plain);
          lastFailureAt = Date.now();
          verify(failures, login.status === 401 && login.code === 'SECRET_NOT_ACTIVE', `machine login with the revoked secret: HTTP ${login.status} ${login.code ?? 'no error code'} (expected 401 SECRET_NOT_ACTIVE)`);
        },
      });
    }
    finally {
      await this.awaitLimiterRelease(lastFailureAt).catch(() => undefined);
    }
  }

  /**
   * TEN-060: regenerating with an active secret. The new secret answers 200, the masked secret changes and the regeneration date is filled;
   * the previous secret no longer works for the machine login (its answer differs from the new one's) and cannot be used again.
   */
  @atc('TEN-060')
  async regenerateActiveSecret(): Promise<void> {
    let lastFailureAt: number | undefined;
    try {
      await this.runTenantCase({
        what: 'secret regeneration',
        body: async (createdIds, failures) => {
          const { id, payload } = await this.createForEdit(createdIds);
          const first = this.data.createTenantSecret();
          const second = this.data.createTenantSecret();
          const [firstResponse] = await this.attemptGenerateSecret(id, { AdminPassword: this.adminPassword, CustomSecret: first });
          expect(firstResponse.status(), 'control: the first secret is generated').toBe(200);
          const [, before] = await this.getTenant(id);

          const [response, body] = await this.attemptGenerateSecret(id, { AdminPassword: this.adminPassword, CustomSecret: second });
          verify(failures, response.status() === 200 && body.Ok === true, `regenerate: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          const [, after] = await this.getTenant(id);
          verify(failures, after.Data?.TenantSecretMasked !== before.Data?.TenantSecretMasked, 'the masked secret did not change');
          verify(failures, (after.Data?.TenantSecretRegeneratedAt ?? '') !== '', 'TenantSecretRegeneratedAt is empty after regenerating');

          const oldLogin = await this.apiLoginWithSecret(String(payload.Rnec), first);
          lastFailureAt = Date.now();
          const newLogin = await this.apiLoginWithSecret(String(payload.Rnec), second);
          lastFailureAt = Date.now();
          verify(failures, oldLogin.status === 401 && oldLogin.code === 'INVALID_CREDENTIALS', `machine login with the previous secret: HTTP ${oldLogin.status} ${oldLogin.code ?? 'no error code'} (expected 401 INVALID_CREDENTIALS)`);
          verify(failures, newLogin.code !== oldLogin.code, `the machine login answers the same for the old and the new secret (${newLogin.code ?? 'no code'}): the previous one cannot be told apart from a valid one`);
          const [reuse, reuseBody] = await this.attemptGenerateSecret(id, { AdminPassword: this.adminPassword, CustomSecret: first });
          verify(failures, reuse.status() === 400 && reuseBody.CodeError === 'SECRET_REUSE_HISTORY', `reusing the previous secret: HTTP ${reuse.status()} ${reuseBody.CodeError ?? 'no error code'} (expected 400 SECRET_REUSE_HISTORY)`);
        },
      });
    }
    finally {
      await this.awaitLimiterRelease(lastFailureAt).catch(() => undefined);
    }
  }

  /**
   * TEN-061: sensitive fields are revealed only with the right Administrator password. The five database fields and the API user are
   * revealed with it (with the value that was sent); with a wrong one (tried on a database field and on the API user, to spare the sensitive
   * limiter) the answer is 401 and carries no value; a field outside the list
   * (the database password, the API password) is refused with 400 `INVALID_FIELD`.
   */
  @atc('TEN-061')
  async revealSensitiveFieldsOnlyWithAdminPassword(): Promise<void> {
    await this.runTenantCase({
      what: 'sensitive fields',
      body: async (createdIds, failures) => {
        const payload = this.data.createTenantPayload({ LogDbHost: 'logs.qa-aut.invalid', LogDbName: 'qa_logs', LogDbPort: 27017 });
        const [created, createdBody] = await this.createTracked(payload, createdIds);
        expect(created.status(), `control (create): ${createdBody.CodeError ?? 'no error code'}`).toBe(200);
        const id = createdBody.Data?.Id ?? 0;
        const user = this.data.createApiUsername();
        const [credentials] = await this.attemptSetApiCredentials(id, { ApiUsername: user, ApiPassword: this.data.createApiPassword() });
        expect(credentials.status(), 'control: the API credentials are set').toBe(200);

        const fields: Array<{ route: 'db-config' | 'api-credentials', field: string, value: string }> = [
          { route: 'db-config', field: 'dbHost', value: String(payload.DbHost) },
          { route: 'db-config', field: 'dbName', value: String(payload.DbName) },
          { route: 'db-config', field: 'dbUser', value: String(payload.DbUser) },
          { route: 'db-config', field: 'logDbHost', value: 'logs.qa-aut.invalid' },
          { route: 'db-config', field: 'logDbName', value: 'qa_logs' },
          { route: 'api-credentials', field: 'apiUsername', value: user },
        ];
        for (const item of fields) {
          const [right, rightBody] = await this.attemptReveal(item.route, id, this.adminPassword, item.field);
          verify(failures, right.status() === 200 && rightBody.Data?.Value === item.value, `reveal ${item.field} with the right password: HTTP ${right.status()}, value ${rightBody.Data?.Value === item.value ? 'matches' : 'differs'} (expected 200 and the value that was sent)`);
          if (!['dbHost', 'apiUsername'].includes(item.field)) {
            continue;
          }
          const [wrong, wrongBody] = await this.attemptReveal(item.route, id, this.data.createWrongPassword(), item.field);
          verify(failures, wrong.status() === 401 && wrongBody.CodeError === 'ADMIN_PASSWORD_INVALID' && (wrongBody.Data?.Value ?? null) === null, `reveal ${item.field} with a wrong password: HTTP ${wrong.status()} CodeError=${String(wrongBody.CodeError)} (expected 401, ADMIN_PASSWORD_INVALID, no value)`);
        }
        for (const item of [{ route: 'db-config' as const, field: 'dbPassword' }, { route: 'api-credentials' as const, field: 'apiPassword' }]) {
          const [response, body] = await this.attemptReveal(item.route, id, this.adminPassword, item.field);
          verify(failures, response.status() === 400 && body.CodeError === 'INVALID_FIELD' && (body.Data?.Value ?? null) === null, `reveal ${item.field}: HTTP ${response.status()} CodeError=${String(body.CodeError)} (expected 400 INVALID_FIELD, no value)`);
        }
      },
    });
  }

  /**
   * TEN-062: repeated wrong Administrator passwords have a limit. A GENERATED Administrator (never the suite's own account) signs in on its
   * own session and sends 12 wrong passwords to the secret route: a 429 (rate limit) or a locked account must appear. The limit exists
   * (10 per minute) but is switched off outside production (HAL-50), so this fails here.
   */
  @atc('TEN-062')
  async limitRepeatedWrongAdminPasswords(): Promise<void> {
    await this.runTenantCase({
      what: 'repeated wrong Administrator passwords',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const admin = this.data.createAdminPayload();
        const [adminResponse, adminBody] = await this.securePOST<CreatedEntityData, typeof admin>('/User', admin);
        const adminId = adminBody.Data?.Id ?? 0;
        expect(adminResponse.status(), `control (generated Administrator): ${adminBody.CodeError ?? 'no error code'}`).toBe(200);
        try {
          const statuses = await this.sendWrongPasswordsAsAdmin({ userName: admin.UserName ?? '', password: admin.Password ?? '' }, id, 12);
          this.recordSensitiveCalls(statuses.length);
          const limited = statuses.some(status => status === 429 || status === 423);
          verify(failures, limited, `12 wrong Administrator passwords: statuses ${[...new Set(statuses)].join(',')}; no 429 or lock appeared (expected a limit)`);
        }
        finally {
          const [removed] = await this.secureDELETE<unknown>(`/User/${adminId}`);
          if (![200, 404].includes(removed.status())) {
            failures.push(`delete the generated Administrator: HTTP ${removed.status()}`);
          }
        }
      },
    });
  }

  /** Sign in as the generated Administrator on its OWN context and send `times` wrong passwords to the secret route. Returns only the statuses. */
  private async sendWrongPasswordsAsAdmin(credentials: { userName: string, password: string }, tenantId: number, times: number): Promise<number[]> {
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const probe = new TenantManagementApi({ request: context });
      await probe.openCryptoSession();
      await probe.signInAdministrator({ UserName: credentials.userName, Password: credentials.password });
      const statuses: number[] = [];
      for (let attempt = 0; attempt < times; attempt++) {
        const [response] = await probe.attemptGenerateSecret(tenantId, { AdminPassword: this.data.createWrongPassword() }, false);
        statuses.push(response.status());
      }
      await probe.postLogout().catch(() => undefined);
      return statuses;
    }
    finally {
      await context.dispose().catch(() => undefined);
    }
  }

  /**
   * TEN-063: the API password history is the last 5. With P0..P5 set in turn, reusing P0 (or any of the five before the current one) is refused with
   * 400 `PASSWORD_REUSE_HISTORY`; after one more change (P6) P0 is older than the last 5 and is accepted again.
   */
  @atc('TEN-063')
  async limitApiPasswordReuseToLastFive(): Promise<void> {
    await this.runTenantCase({
      what: 'API password history',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const user = this.data.createApiUsername();
        const passwords = Array.from({ length: 7 }, () => this.data.createApiPassword());
        for (const [index, password] of passwords.slice(0, 6).entries()) {
          const [response, body] = await this.attemptSetApiCredentials(id, { ApiUsername: user, ApiPassword: password });
          expect(response.status(), `control: password P${index} is set: ${body.CodeError ?? 'no error code'}`).toBe(200);
        }
        for (const index of [0, 1, 4]) {
          const [response, body] = await this.attemptSetApiCredentials(id, { ApiUsername: user, ApiPassword: passwords[index] });
          verify(failures, response.status() === 400 && body.CodeError === 'PASSWORD_REUSE_HISTORY', `reuse of P${index} (within the last 5): HTTP ${response.status()} ${body.CodeError ?? 'no error code'} (expected 400 PASSWORD_REUSE_HISTORY)`);
        }
        const [sixth] = await this.attemptSetApiCredentials(id, { ApiUsername: user, ApiPassword: passwords[6] });
        expect(sixth.status(), 'control: password P6 is set').toBe(200);
        const [old, oldBody] = await this.attemptSetApiCredentials(id, { ApiUsername: user, ApiPassword: passwords[0] });
        verify(failures, old.status() === 200 && oldBody.Ok === true, `reuse of P0 once it left the last 5: HTTP ${old.status()} ${oldBody.CodeError ?? 'no error code'} (expected 200)`);
      },
    });
  }

  /**
   * TEN-043: nothing can be done on a deleted tenant. Read, edit, logo, configuration, operator, API credentials and status are refused
   * (a 4xx, never a 5xx) and the tenant, read with `IncludeDeleted`, keeps its name, its state and no logo.
   */
  @atc('TEN-043')
  async blockActionsOnDeletedTenant(): Promise<void> {
    await this.runTenantCase({
      what: 'actions on a deleted tenant',
      body: async (createdIds, failures) => {
        const { id, payload } = await this.createForEdit(createdIds);
        const [deleted] = await this.attemptDeleteTenant(id);
        expect(deleted.status(), 'control: the tenant is deleted').toBe(200);

        const actions: Array<{ label: string, run: () => Promise<[APIResponse, ApiEnvelope<unknown>]> }> = [
          { label: 'read', run: async () => this.getTenant(id) },
          { label: 'edit', run: async () => this.attemptUpdateTenant(id, { BusinessName: this.data.createBusinessNameOfLength(20) }) },
          { label: 'enable', run: async () => this.attemptUpdateTenant(id, { IsActive: true }) },
          { label: 'logo', run: async () => this.attemptUpdateLogo(id, this.data.validLogoPng) },
          { label: 'configuration', run: async () => this.attemptUpdateConfig(id, { ValidateMacSerial: true }) },
          { label: 'operator', run: async () => this.attemptAssignOperator(id, { MainOperatorId: 5 }) },
          { label: 'API credentials', run: async () => this.attemptSetApiCredentials(id, { ApiUsername: this.data.createApiUsername(), ApiPassword: this.data.createApiPassword() }) },
        ];
        for (const action of actions) {
          const [response, body] = await action.run();
          verify(failures, response.status() >= 400 && response.status() < 500 && body.Ok !== true, `${action.label} on a deleted tenant: HTTP ${response.status()} Ok=${String(body.Ok)} (expected a 4xx refusal)`);
        }
        const kept = await this.findByRnec(String(payload.Rnec), true);
        verify(failures, kept !== null && kept.IsDeleted === true && kept.BusinessName === payload.BusinessName && (kept.Logo ?? null) === null && (kept.MainOperatorId ?? null) === null && kept.ValidateMacSerial === false, 'the deleted tenant changed after the refused actions');
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): operators and configuration (block 2.5)
  // ============================================

  /** Create a generated operator and record its id for cleanup BEFORE judging the answer. Returns 0 when the create failed. */
  private async createTrackedOperator(operatorIds: number[]): Promise<number> {
    const [, body] = await this.securePOST<CreatedEntityData, object>('/operators', this.data.createPlainOperatorPayload());
    const id = body.Data?.Id ?? 0;
    if (id > 0) {
      operatorIds.push(id);
    }
    return id;
  }

  /**
   * Frame of the operator cases: a tenant and `count` generated operators. At the end the tenant is deleted first (an operator in use
   * cannot be removed) and then the operators; a refusal is reported.
   */
  private async runOperatorCase(args: { what: string, count: number, body: (tenantId: number, operators: number[], failures: string[]) => Promise<void> }): Promise<void> {
    await this.runTenantCase({
      what: args.what,
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const operatorIds: number[] = [];
        try {
          for (let index = 0; index < args.count; index++) {
            expect(await this.createTrackedOperator(operatorIds), `control: operator ${index + 1} is created`).toBeGreaterThan(0);
          }
          await args.body(id, operatorIds, failures);
        }
        finally {
          await this.attemptDeleteTenant(id).catch(() => undefined);
          for (const operatorId of operatorIds) {
            const [removed] = await this.secureDELETE<unknown>(`/operators/${operatorId}`);
            if (![200, 404].includes(removed.status())) {
              failures.push(`delete operator #${operatorId}: HTTP ${removed.status()}`);
            }
          }
        }
      },
    });
  }

  /** TEN-070: a main and a contingency operator are assigned (200) and the tenant reads back with both. */
  @atc('TEN-070')
  async assignMainAndContingencyOperators(): Promise<void> {
    await this.runOperatorCase({
      what: 'operator assignment',
      count: 2,
      body: async (tenantId, [main, contingency], failures) => {
        const [response, body] = await this.attemptAssignOperator(tenantId, { MainOperatorId: main, ContingencyOperatorId: contingency });
        verify(failures, response.status() === 200 && body.Ok === true, `assign: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, read] = await this.getTenant(tenantId);
        verify(failures, read.Data?.MainOperatorId === main && read.Data.ContingencyOperatorId === contingency, `operators read back: ${String(read.Data?.MainOperatorId)} and ${String(read.Data?.ContingencyOperatorId)} (expected ${main} and ${contingency})`);
      },
    });
  }

  /** TEN-071: clearing the contingency operator leaves it `null` and keeps the main operator. */
  @atc('TEN-071')
  async clearContingencyOperator(): Promise<void> {
    await this.runOperatorCase({
      what: 'contingency operator removal',
      count: 2,
      body: async (tenantId, [main, contingency], failures) => {
        const [assigned] = await this.attemptAssignOperator(tenantId, { MainOperatorId: main, ContingencyOperatorId: contingency });
        expect(assigned.status(), 'control: both operators are assigned').toBe(200);
        const [response, body] = await this.attemptAssignOperator(tenantId, { MainOperatorId: main, ContingencyOperatorId: null });
        verify(failures, response.status() === 200 && body.Ok === true, `clear: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const [, read] = await this.getTenant(tenantId);
        verify(failures, (read.Data?.ContingencyOperatorId ?? null) === null, `the contingency operator is ${String(read.Data?.ContingencyOperatorId)} after clearing it (expected null)`);
        verify(failures, read.Data?.MainOperatorId === main, `the main operator is ${String(read.Data?.MainOperatorId)} after clearing the contingency (expected ${main})`);
      },
    });
  }

  /**
   * TEN-072: a main or contingency operator that does not exist, or was deleted, is refused (a 4xx) and the assignment stays as it was.
   * The backend only checks that the id is above 0 (HAL-44), so the nonexistent and deleted rows fail here.
   */
  @atc('TEN-072')
  async rejectUnavailableOperators(): Promise<void> {
    await this.runOperatorCase({
      what: 'unavailable operator assignment',
      count: 2,
      body: async (tenantId, [main, spare], failures) => {
        const [control] = await this.attemptAssignOperator(tenantId, { MainOperatorId: main });
        expect(control.status(), 'control: a valid main operator is assigned').toBe(200);
        const [removed] = await this.secureDELETE<unknown>(`/operators/${spare}`);
        expect(removed.status(), 'control: the spare operator is deleted').toBe(200);

        const rows = [
          { label: 'main operator that does not exist', payload: { MainOperatorId: 88888888 } },
          { label: 'main operator already deleted', payload: { MainOperatorId: spare } },
          { label: 'contingency operator that does not exist', payload: { MainOperatorId: main, ContingencyOperatorId: 88888888 } },
          { label: 'contingency operator already deleted', payload: { MainOperatorId: main, ContingencyOperatorId: spare } },
        ];
        for (const row of rows) {
          const [response, body] = await this.attemptAssignOperator(tenantId, row.payload);
          verify(failures, response.status() >= 400 && response.status() < 500 && body.Ok !== true, `${row.label}: HTTP ${response.status()} Ok=${String(body.Ok)} (expected a 4xx refusal)`);
        }
        const [, read] = await this.getTenant(tenantId);
        verify(failures, read.Data?.MainOperatorId === main && (read.Data.ContingencyOperatorId ?? null) === null, `after the refusals the operators are ${String(read.Data?.MainOperatorId)} and ${String(read.Data?.ContingencyOperatorId)} (expected ${main} and null)`);
      },
    });
  }

  /** TEN-073: `ValidateMacSerial` is switched on and off with `PATCH /config`; the tenant reads back with each value. */
  @atc('TEN-073')
  async toggleMacSerialValidation(): Promise<void> {
    await this.runTenantCase({
      what: 'MAC-serial validation',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        for (const value of [true, false]) {
          const [response, body] = await this.attemptUpdateConfig(id, { ValidateMacSerial: value });
          verify(failures, response.status() === 200 && body.Ok === true, `ValidateMacSerial=${String(value)}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          const [, read] = await this.getTenant(id);
          verify(failures, read.Data?.ValidateMacSerial === value, `ValidateMacSerial reads back ${String(read.Data?.ValidateMacSerial)} (expected ${String(value)})`);
        }
      },
    });
  }

  /** TEN-074: the lockout parameters persist, with `PATCH /config` and with `PUT`; the tenant reads back with each set. */
  @atc('TEN-074')
  async persistLockoutParameters(): Promise<void> {
    await this.runTenantCase({
      what: 'lockout parameters',
      body: async (createdIds, failures) => {
        const { id } = await this.createForEdit(createdIds);
        const sets = [
          { label: 'PATCH /config', send: async (values: object) => this.attemptUpdateConfig(id, values), values: { MaxFailedLoginAttempts: 5, MaxInactivityMinutes: 25, BlockedFingersLimit: 4, BlockedFingersMinutes: 15, RetryLockMinutes: 10 } },
          { label: 'PUT', send: async (values: object) => this.attemptUpdateTenant(id, values), values: { MaxFailedLoginAttempts: 7, MaxInactivityMinutes: 40, BlockedFingersLimit: 6, BlockedFingersMinutes: 20, RetryLockMinutes: 12 } },
        ];
        for (const set of sets) {
          const [response, body] = await set.send(set.values);
          verify(failures, response.status() === 200 && body.Ok === true, `${set.label}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          const [, read] = await this.getTenant(id);
          const stored = read.Data as unknown as Record<string, unknown> | null;
          for (const [field, value] of Object.entries(set.values)) {
            verify(failures, stored?.[field] === value, `${set.label}: ${field} reads back ${String(stored?.[field])} (expected ${value})`);
          }
        }
      },
    });
  }

  /** TEN-075: `HitTwoFingers`, `RequireLocation` and `ManualFingerSelection` persist when the tenant is created and when it is edited. */
  @atc('TEN-075')
  async persistFingerAndLocationOptions(): Promise<void> {
    await this.runTenantCase({
      what: 'finger and location options',
      body: async (createdIds, failures) => {
        const options = ['HitTwoFingers', 'RequireLocation', 'ManualFingerSelection'];
        const payload = this.data.createTenantPayload();
        Object.assign(payload, { HitTwoFingers: true, RequireLocation: true, ManualFingerSelection: true });
        const [created, createdBody] = await this.createTracked(payload, createdIds);
        expect(created.status(), `control (create): ${createdBody.CodeError ?? 'no error code'}`).toBe(200);
        const id = createdBody.Data?.Id ?? 0;
        const readOptions = async () => {
          const [, read] = await this.getTenant(id);
          return read.Data as unknown as Record<string, unknown> | null;
        };
        const afterCreate = await readOptions();
        for (const option of options) {
          verify(failures, afterCreate?.[option] === true, `create: ${option} reads back ${String(afterCreate?.[option])} (expected true)`);
        }
        const [response, body] = await this.attemptUpdateTenant(id, { HitTwoFingers: false, RequireLocation: false, ManualFingerSelection: false });
        verify(failures, response.status() === 200 && body.Ok === true, `edit: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        const afterEdit = await readOptions();
        for (const option of options) {
          verify(failures, afterEdit?.[option] === false, `edit: ${option} reads back ${String(afterEdit?.[option])} (expected false)`);
        }
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): detail and my-tenant panel (block 2.6)
  // ============================================

  /** TEN-080: the detail of a tenant loads whole and agrees with its row in the list. */
  @atc('TEN-080')
  async readTenantDetail(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant detail',
      body: async (createdIds, failures) => {
        const { id, payload } = await this.createForEdit(createdIds);
        const [response, body] = await this.getTenant(id);
        const detail = body.Data;
        verify(failures, response.status() === 200 && body.Ok === true && detail?.Id === id, `detail: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        verify(failures, detail?.Rnec === payload.Rnec && detail?.BusinessName === payload.BusinessName, 'the detail does not carry the RNEC and the name that were created');
        verify(failures, detail?.IsActive === true && detail.IsDeleted === false && (detail.CreatedBy ?? '') !== '', 'the detail does not show an active, not deleted tenant with its creator');
        verify(failures, detail?.HasApiCredentials === false && detail.LogDbConfigured === false && detail.ValidateMacSerial === false, 'the detail does not show the state of the credentials, the log database and the MAC-serial validation');
        const row = await this.findByRnec(String(payload.Rnec), false);
        verify(failures, row?.Id === detail?.Id && row?.BusinessName === detail?.BusinessName && row?.IsActive === detail?.IsActive, 'the list row and the detail disagree');
      },
    });
  }

  /** TEN-081: an id that does not exist answers a controlled 404 and a non-numeric or invalid one a controlled 4xx, never a 5xx. */
  @atc('TEN-081')
  async answerUnknownTenantIdsInControlledWay(): Promise<void> {
    await this.runTenantCase({
      what: 'unknown tenant ids',
      body: async (_createdIds, failures) => {
        const rows = [
          { label: 'id that does not exist', id: '2147000000', status: [404] },
          { label: 'id 0', id: '0', status: [400, 404] },
          { label: 'negative id', id: '-1', status: [400, 404] },
          { label: 'non-numeric id', id: 'abc', status: [400, 404] },
        ];
        for (const row of rows) {
          try {
            const [response, body] = await this.secureGET<unknown>(`/Tenant/${row.id}`);
            verify(failures, row.status.includes(response.status()) && body.Ok !== true, `${row.label}: HTTP ${response.status()} Ok=${String(body.Ok)} ${body.CodeError ?? 'no error code'} (expected ${row.status.join(' or ')})`);
          }
          catch (error) {
            failures.push(`${row.label}: no controlled answer (${this.firstLine(error)})`);
          }
        }
      },
    });
  }

  /**
   * Sign in once as a TenantAdmin on its OWN context (own cookie jar and crypto session: the Administrator session of the ATC is left
   * alone), run the callback with that probe and the tenant id the login names, and sign out. Undecorated: the credentials are a secret.
   */
  private async asTenantAdmin<T>(credentials: { userName: string, password: string }, run: (probe: TenantManagementApi, ownTenantId: number) => Promise<T>): Promise<T> {
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    try {
      const probe = new TenantManagementApi({ request: context });
      await probe.openCryptoSession();
      const [, login] = await probe.signInTenantUser({ UserName: credentials.userName, Password: credentials.password });
      const ownTenantId = login.Data?.TenantId ?? 0;
      expect(ownTenantId, 'control: the TenantAdmin login names its tenant').toBeGreaterThan(0);
      try {
        return await run(probe, ownTenantId);
      }
      finally {
        await probe.postLogout().catch(() => undefined);
      }
    }
    finally {
      await context.dispose().catch(() => undefined);
    }
  }

  /** The suite's own TenantAdmin (read by name). Only used for read-only and refusal checks. */
  private get realTenantAdmin(): { userName: string, password: string } {
    return { userName: this.config.tenantAdminUser.email, password: this.config.tenantAdminUser.password };
  }

  /** Judge an answer that must be a 403 (a 403 that carries the CSRF message is inconclusive). */
  private expectForbidden(failures: string[], label: string, answer: [APIResponse, ApiEnvelope<unknown>]): void {
    const [response, body] = answer;
    const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
    if (response.status() === 403 && /csrf/i.test(text)) {
      failures.push(`${label}: inconclusive, the 403 carries the CSRF message`);
      return;
    }
    verify(failures, response.status() === 403 && body.Ok === false, `${label}: HTTP ${response.status()} Ok=${String(body.Ok)} ${body.CodeError ?? 'no error code'} (expected 403)`);
  }

  /**
   * TEN-083: data of a tenant does not show in another. The real TenantAdmin asks for a GENERATED tenant: the detail, the list of
   * tenants and the branches of that tenant are refused with 403, and its own tenant is a different one.
   */
  @atc('TEN-083')
  async isolateTenantDataFromOtherTenantAdmins(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant isolation',
      body: async (createdIds, failures) => {
        const { id: foreignId } = await this.createForEdit(createdIds);
        await this.asTenantAdmin(this.realTenantAdmin, async (probe, ownTenantId) => {
          expect(ownTenantId, 'the generated tenant must not be the TenantAdmin\'s own').not.toBe(foreignId);
          this.expectForbidden(failures, 'detail of another tenant', await probe.getTenant(foreignId));
          this.expectForbidden(failures, 'branches of another tenant', await probe.secureGET<unknown>(`/tenants/${foreignId}/branches`));
          this.expectForbidden(failures, 'list of tenants', await probe.listTenants({ pageSize: 5 }));
          const [mine, mineBody] = await probe.secureGET<TenantFullData>('/Tenant/my-tenant');
          verify(failures, mine.status() === 200 && mineBody.Data?.Id === ownTenantId, `my-tenant: HTTP ${mine.status()}, tenant ${String(mineBody.Data?.Id)} (expected ${ownTenantId})`);
        });
      },
    });
  }

  /** TEN-090: `GET /Tenant/my-tenant` returns only the TenantAdmin's own tenant (the one its login names); the list of all tenants is refused. */
  @atc('TEN-090')
  async readOnlyOwnTenant(): Promise<void> {
    await this.runTenantCase({
      what: 'my-tenant read',
      body: async (_createdIds, failures) => {
        await this.asTenantAdmin(this.realTenantAdmin, async (probe, ownTenantId) => {
          const [response, body] = await probe.secureGET<TenantFullData>('/Tenant/my-tenant');
          verify(failures, response.status() === 200 && body.Ok === true && body.Data?.Id === ownTenantId, `my-tenant: HTTP ${response.status()}, tenant ${String(body.Data?.Id)} (expected ${ownTenantId})`);
          const [, adminView] = await this.getTenant(ownTenantId);
          verify(failures, body.Data?.Rnec === adminView.Data?.Rnec && body.Data?.BusinessName === adminView.Data?.BusinessName, 'my-tenant does not match what the Administrator reads for that tenant');
          this.expectForbidden(failures, 'list of tenants', await probe.listTenants({ pageSize: 5 }));
        });
      },
    });
  }

  /**
   * TEN-091: a TenantAdmin edits the data and the logo of its own tenant. Works on a GENERATED tenant and TenantAdmin. The name and a
   * parameter change with `PUT /Tenant/my-tenant`; the TenantAdmin cannot change the operator (HAL-43: it accepts it) and can change
   * the logo (the only logo route is Administrator only).
   */
  @atc('TEN-091')
  async editOwnTenantAsTenantAdmin(args: { tenantId: number, username: string, readPassword: () => Promise<string> }): Promise<void> {
    await this.runTenantCase({
      what: 'my-tenant edit',
      body: async (_createdIds, failures) => {
        const credentials = { userName: args.username, password: await args.readPassword() };
        await this.asTenantAdmin(credentials, async (probe, ownTenantId) => {
          expect(ownTenantId, 'control: the generated TenantAdmin names the generated tenant').toBe(args.tenantId);
          const name = this.data.createBusinessNameOfLength(20);
          const [response, body] = await probe.securePUT<TenantFullData, object>('/Tenant/my-tenant', { BusinessName: name, MaxInactivityMinutes: 25 });
          verify(failures, response.status() === 200 && body.Ok === true, `edit: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
          const [, edited] = await this.getTenant(args.tenantId);
          verify(failures, edited.Data?.BusinessName === name && edited.Data.MaxInactivityMinutes === 25, 'the Administrator does not read the data the TenantAdmin edited');

          const [operatorResponse] = await probe.securePUT<TenantFullData, object>('/Tenant/my-tenant', { MainOperatorId: 99999 });
          const [, afterOperator] = await this.getTenant(args.tenantId);
          verify(failures, (afterOperator.Data?.MainOperatorId ?? null) === null, `the TenantAdmin changed the main operator to ${String(afterOperator.Data?.MainOperatorId)} (HTTP ${operatorResponse.status()}); the operator is Administrator only`);

          const logo = this.data.validLogoPng;
          const [logoResponse, logoBody] = await probe.attemptUpdateLogo(args.tenantId, logo);
          verify(failures, logoResponse.status() === 200 && logoBody.Ok === true, `logo: HTTP ${logoResponse.status()} ${logoBody.CodeError ?? 'no error code'} (expected the TenantAdmin to change its own logo)`);
          const [, withLogo] = await this.getTenant(args.tenantId);
          verify(failures, withLogo.Data?.Logo === logo, 'the tenant does not read back the logo');
        });
      },
    });
  }

  /**
   * TEN-092: a TenantAdmin changes the API credentials with its own password. Works on a GENERATED tenant and TenantAdmin. A wrong
   * password is refused with 401 `ADMIN_PASSWORD_INVALID` and changes nothing; the right one applies (200) and the tenant shows API
   * credentials. The backend looks the TenantAdmin up among the UserApps and answers 401 to both (HAL-45), so the right-password row fails.
   */
  @atc('TEN-092')
  async changeApiCredentialsAsTenantAdmin(args: { tenantId: number, username: string, readPassword: () => Promise<string> }): Promise<void> {
    await this.runTenantCase({
      what: 'my-tenant API credentials',
      body: async (_createdIds, failures) => {
        const password = await args.readPassword();
        await this.asTenantAdmin({ userName: args.username, password }, async (probe) => {
          const send = async (adminPassword: string) => {
            await probe.awaitSensitiveSlot();
            return probe.securePATCHWithBody<unknown, object>('/Tenant/my-tenant/api-credentials', { ApiUsername: this.data.createApiUsername(), ApiPassword: this.data.createApiPassword(), AdminPassword: adminPassword });
          };
          const [wrong, wrongBody] = await send(this.data.createWrongPassword());
          verify(failures, wrong.status() === 401 && wrongBody.CodeError === 'ADMIN_PASSWORD_INVALID', `wrong password: HTTP ${wrong.status()} ${wrongBody.CodeError ?? 'no error code'} (expected 401 ADMIN_PASSWORD_INVALID)`);
          const [, untouched] = await this.getTenant(args.tenantId);
          verify(failures, untouched.Data?.HasApiCredentials === false, 'the wrong password changed the API credentials');

          const [right, rightBody] = await send(password);
          verify(failures, right.status() === 200 && rightBody.Ok === true, `right password: HTTP ${right.status()} ${rightBody.CodeError ?? 'no error code'} (expected 200)`);
          const [, applied] = await this.getTenant(args.tenantId);
          verify(failures, applied.Data?.HasApiCredentials === true, 'the right password did not set the API credentials');
        });
      },
    });
  }

  /** TEN-093: a TenantAdmin that reads, edits or deletes another tenant by id gets 403 and the tenant does not change. */
  @atc('TEN-093')
  async refuseTenantByIdToTenantAdmin(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant by id as TenantAdmin',
      body: async (createdIds, failures) => {
        const { id: foreignId, payload } = await this.createForEdit(createdIds);
        await this.asTenantAdmin(this.realTenantAdmin, async (probe) => {
          this.expectForbidden(failures, 'read', await probe.getTenant(foreignId));
          this.expectForbidden(failures, 'edit', await probe.attemptUpdateTenant(foreignId, { BusinessName: this.data.createBusinessNameOfLength(20) }));
          this.expectForbidden(failures, 'delete', await probe.attemptDeleteTenant(foreignId));
        });
        const [, read] = await this.getTenant(foreignId);
        verify(failures, read.Data?.BusinessName === payload.BusinessName && read.Data?.IsDeleted === false, 'the tenant changed after the refused calls');
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): listing, search and paging (block 2.1)
  // ============================================

  /**
   * Create one tenant per name (the business name carries a token shared by the whole case), recording each id for cleanup BEFORE
   * judging the answer. Returns id and RNEC per tenant, in order.
   */
  private async createNamedTenants(names: string[], createdIds: number[]): Promise<Array<{ id: number, rnec: string }>> {
    const created: Array<{ id: number, rnec: string }> = [];
    for (const name of names) {
      const payload = this.data.createTenantPayload();
      payload.BusinessName = name;
      const [response, body] = await this.createTracked(payload, createdIds);
      expect(response.status(), `control (create "${name}"): ${body.CodeError ?? 'no error code'}`).toBe(200);
      created.push({ id: body.Data?.Id ?? 0, rnec: String(payload.Rnec) });
    }
    return created;
  }

  /** A short token that makes a search match only the tenants of this case. */
  private searchToken(): string {
    return `QAL${this.data.createRnecOfLength(8)}`;
  }

  /** TEN-001: the list loads paged (200, page 1, default size 10) with consistent totals, and a created tenant shows in it. */
  @atc('TEN-001')
  async loadTenantList(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant list',
      body: async (createdIds, failures) => {
        const token = this.searchToken();
        const [tenant] = await this.createNamedTenants([`${token} Uno`], createdIds);
        const [response, body] = await this.listTenants();
        const data = body.Data;
        verify(failures, response.status() === 200 && body.Ok === true && Array.isArray(data?.Data), `list: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        verify(failures, (data?.Page ?? 1) === 1 && (data?.PageSize ?? 10) === 10 && (data?.Data.length ?? 0) <= 10, `default page: page ${String(data?.Page)}, size ${String(data?.PageSize)}, ${data?.Data.length ?? 0} rows (expected page 1, size 10, at most 10 rows)`);
        verify(failures, (data?.TotalRecords ?? 0) >= (data?.Data.length ?? 0) && (data?.TotalRecords ?? 0) >= 1, `TotalRecords ${String(data?.TotalRecords)} with ${data?.Data.length ?? 0} rows`);
        const pageSize = data?.PageSize ?? 10;
        verify(failures, (data?.TotalPages ?? 0) === Math.max(1, Math.ceil((data?.TotalRecords ?? 0) / pageSize)), `TotalPages ${String(data?.TotalPages)} does not match ${String(data?.TotalRecords)} records of ${pageSize}`);
        const incomplete = (data?.Data ?? []).filter(row => !row.Rnec || !row.BusinessName || typeof row.IsActive !== 'boolean' || typeof row.IsDeleted !== 'boolean');
        verify(failures, incomplete.length === 0, `${incomplete.length} row(s) without RNEC, name or state`);
        const found = await this.findByRnec(tenant.rnec, false);
        verify(failures, found?.Id === tenant.id, 'the created tenant is not found in the list');
      },
    });
  }

  /**
   * TEN-002: the search filters by business name and by RNEC, with no regard to case; a term with no match answers 200 with an empty
   * page (TotalRecords 0).
   */
  @atc('TEN-002')
  async searchTenantsByNameAndRnec(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant search',
      body: async (createdIds, failures) => {
        const token = this.searchToken();
        const [alpha, beta] = await this.createNamedTenants([`${token} Alpha`, `${token} Beta`], createdIds);
        const rows = [
          { label: 'shared name token', term: token, expected: [alpha.id, beta.id] },
          { label: 'name fragment in lower case', term: `${token} alpha`.toLowerCase(), expected: [alpha.id] },
          { label: 'name fragment in upper case', term: `${token} BETA`.toUpperCase(), expected: [beta.id] },
          { label: 'RNEC', term: alpha.rnec, expected: [alpha.id] },
          { label: 'RNEC in lower case', term: beta.rnec.toLowerCase(), expected: [beta.id] },
          { label: 'no match', term: `ZZ${this.data.createRnecOfLength(10)}`, expected: [] },
        ];
        for (const row of rows) {
          const [response, body] = await this.listTenants({ searchTerm: row.term, pageSize: 20 });
          const ids = (body.Data?.Data ?? []).map(item => item.Id).sort((a, b) => a - b);
          const expected = [...row.expected].sort((a, b) => a - b);
          verify(failures, response.status() === 200 && body.Ok === true && JSON.stringify(ids) === JSON.stringify(expected), `${row.label}: HTTP ${response.status()}, tenants [${ids.join(',')}] (expected [${expected.join(',')}])`);
          verify(failures, response.status() !== 200 || (body.Data?.TotalRecords ?? -1) === expected.length, `${row.label}: TotalRecords ${String(body.Data?.TotalRecords)} (expected ${expected.length})`);
        }
      },
    });
  }

  /**
   * TEN-003: the state of a tenant. The API has no state parameter (the screen filters), so this checks what the screen filters on: an
   * active, a disabled and a deleted tenant show with the right flags, the deleted one only with `IncludeDeleted`, and the totals add up.
   */
  @atc('TEN-003')
  async listTenantsByState(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant state in the list',
      body: async (createdIds, failures) => {
        const token = this.searchToken();
        const [active, disabled, deleted] = await this.createNamedTenants([`${token} Activo`, `${token} Inactivo`, `${token} Eliminado`], createdIds);
        const [off] = await this.attemptUpdateTenant(disabled.id, { IsActive: false });
        expect(off.status(), 'control: the second tenant is disabled').toBe(200);
        const [removed] = await this.attemptDeleteTenant(deleted.id);
        expect(removed.status(), 'control: the third tenant is deleted').toBe(200);

        const [, visible] = await this.listTenants({ searchTerm: token, pageSize: 20 });
        const visibleRows = visible.Data?.Data ?? [];
        verify(failures, visibleRows.length === 2 && visible.Data?.TotalRecords === 2 && !visibleRows.some(row => row.Id === deleted.id), `without IncludeDeleted: ${visibleRows.length} rows, total ${String(visible.Data?.TotalRecords)} (expected the active and the disabled tenant only)`);
        verify(failures, visibleRows.find(row => row.Id === active.id)?.IsActive === true && visibleRows.find(row => row.Id === disabled.id)?.IsActive === false, 'the active and disabled flags are wrong');

        const [, all] = await this.listTenants({ searchTerm: token, includeDeleted: true, pageSize: 20 });
        const allRows = all.Data?.Data ?? [];
        const counts = { active: allRows.filter(row => row.IsActive && !row.IsDeleted).length, inactive: allRows.filter(row => !row.IsActive && !row.IsDeleted).length, deleted: allRows.filter(row => row.IsDeleted).length };
        verify(failures, all.Data?.TotalRecords === 3 && counts.active === 1 && counts.inactive === 1 && counts.deleted === 1, `with IncludeDeleted: total ${String(all.Data?.TotalRecords)}, ${counts.active} active, ${counts.inactive} inactive, ${counts.deleted} deleted (expected 3, 1, 1, 1)`);
      },
    });
  }

  /**
   * TEN-004: paging. Five tenants of one token are read with pages of 2 (2, 2, 1 rows, no repeats, TotalRecords 5 and TotalPages 3), with
   * sizes 10, 20, 50 and 100 (same five rows), and the page size is capped and page 0 is read as page 1 without an error.
   */
  @atc('TEN-004')
  async pageTenantList(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant paging',
      body: async (createdIds, failures) => {
        const token = this.searchToken();
        const created = await this.createNamedTenants(['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'].map(word => `${token} ${word}`), createdIds);
        const wanted = created.map(item => item.id).sort((a, b) => a - b);

        const seen: number[] = [];
        for (const [page, size] of [[1, 2], [2, 2], [3, 1]]) {
          const [response, body] = await this.listTenants({ searchTerm: token, page, pageSize: 2 });
          const ids = (body.Data?.Data ?? []).map(item => item.Id);
          seen.push(...ids);
          verify(failures, response.status() === 200 && ids.length === size && body.Data?.TotalRecords === 5 && body.Data.TotalPages === 3, `page ${page} of size 2: HTTP ${response.status()}, ${ids.length} rows, total ${String(body.Data?.TotalRecords)}, pages ${String(body.Data?.TotalPages)} (expected ${size} rows, 5, 3)`);
        }
        verify(failures, JSON.stringify([...seen].sort((a, b) => a - b)) === JSON.stringify(wanted), `the three pages hold [${[...seen].sort((a, b) => a - b).join(',')}] (expected the five created tenants once each)`);

        for (const pageSize of [10, 20, 50, 100]) {
          const [response, body] = await this.listTenants({ searchTerm: token, pageSize });
          const ids = (body.Data?.Data ?? []).map(item => item.Id).sort((a, b) => a - b);
          verify(failures, response.status() === 200 && JSON.stringify(ids) === JSON.stringify(wanted) && body.Data?.TotalPages === 1, `page size ${pageSize}: HTTP ${response.status()}, ${ids.length} rows, ${String(body.Data?.TotalPages)} pages (expected the same 5 rows in 1 page)`);
        }

        const [beyond, beyondBody] = await this.listTenants({ searchTerm: token, page: 9, pageSize: 2 });
        verify(failures, beyond.status() === 200 && (beyondBody.Data?.Data.length ?? 0) === 0 && beyondBody.Data?.TotalRecords === 5, `page 9: HTTP ${beyond.status()}, ${beyondBody.Data?.Data.length ?? 0} rows, total ${String(beyondBody.Data?.TotalRecords)} (expected an empty page with the real total)`);
        const [zero, zeroBody] = await this.listTenants({ searchTerm: token, page: 0, pageSize: 2 });
        verify(failures, zero.status() === 200 && zeroBody.Data?.Page === 1 && (zeroBody.Data?.Data.length ?? 0) === 2, `page 0: HTTP ${zero.status()}, page ${String(zeroBody.Data?.Page)} (expected page 1 with 2 rows)`);
        const [huge, hugeBody] = await this.listTenants({ searchTerm: token, pageSize: 100000 });
        verify(failures, huge.status() === 200 && (hugeBody.Data?.PageSize ?? 0) > 0 && (hugeBody.Data?.PageSize ?? 0) <= 1000 && (hugeBody.Data?.Data.length ?? 0) === 5, `page size 100000: HTTP ${huge.status()}, size ${String(hugeBody.Data?.PageSize)} (expected it capped at 1000 or less)`);
      },
    });
  }

  /**
   * TEN-006: a search with accents, ñ and special characters answers 200 with no error, and `%` and `_` are searched literally (every
   * row holds the term; they are not wildcards).
   */
  @atc('TEN-006')
  async searchWithSpecialCharacters(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant search with special characters',
      body: async (_createdIds, failures) => {
        const terms = ['Ñandú', 'ñ', 'á é í ó ú', '%', '_', '\'', '"', '\\', '<script>', ';--', '%%', 'a'.repeat(300)];
        for (const term of terms) {
          const label = term.length > 20 ? `a repeated ${term.length} times` : term;
          try {
            const [response, body] = await this.listTenants({ searchTerm: term, pageSize: 20 });
            verify(failures, response.status() === 200 && body.Ok === true, `"${label}": HTTP ${response.status()} ${body.CodeError ?? 'no error code'} (expected 200)`);
            if (response.status() === 200 && ['%', '_', '%%'].includes(term)) {
              const outsiders = (body.Data?.Data ?? []).filter(row => !`${row.Rnec} ${row.BusinessName}`.toLowerCase().includes(term.toLowerCase()));
              verify(failures, outsiders.length === 0, `"${label}" acted as a wildcard: ${outsiders.length} row(s) do not hold it`);
            }
          }
          catch (error) {
            failures.push(`"${label}": no controlled answer (${this.firstLine(error)})`);
          }
        }
      },
    });
  }

  /**
   * TEN-007: the total follows the changes with no reload. Reading the same search after each step: 0, 1 and 2 after the creates, 1
   * after a delete, and 2 again with `IncludeDeleted`; the total always equals the rows of the page.
   */
  @atc('TEN-007')
  async keepTenantTotalAfterCreateAndDelete(): Promise<void> {
    await this.runTenantCase({
      what: 'tenant total',
      body: async (createdIds, failures) => {
        const token = this.searchToken();
        const total = async (includeDeleted = false) => {
          const [, body] = await this.listTenants({ searchTerm: token, includeDeleted, pageSize: 20 });
          return { total: body.Data?.TotalRecords ?? -1, rows: body.Data?.Data.length ?? -2 };
        };
        const step = (label: string, seen: { total: number, rows: number }, expected: number) => {
          verify(failures, seen.total === expected && seen.rows === expected, `${label}: total ${seen.total} and ${seen.rows} rows (expected ${expected} and ${expected})`);
        };
        step('before creating', await total(), 0);
        const [first] = await this.createNamedTenants([`${token} Uno`], createdIds);
        step('after the first create', await total(), 1);
        await this.createNamedTenants([`${token} Dos`], createdIds);
        step('after the second create', await total(), 2);
        const [removed] = await this.attemptDeleteTenant(first.id);
        expect(removed.status(), 'control: the first tenant is deleted').toBe(200);
        step('after the delete', await total(), 1);
        step('after the delete, with IncludeDeleted', await total(true), 2);
      },
    });
  }

  // ============================================
  // Helpers for the Steps that prepare tenant children (no ATC)
  // ============================================

  /** Create a child row (branch, terminal, device, UserApp, product...) with a body; returns its id, or 0 when it was refused. */
  async createChild(route: string, payload: object): Promise<number> {
    const [, body] = await this.securePOST<CreatedEntityData, object>(route, payload);
    return body.Data?.Id ?? 0;
  }

  /** Total records of any paged list route; -1 when the answer has no total. */
  async totalOf(route: string): Promise<number> {
    const [, body] = await this.secureGET<PagedData<unknown>>(route);
    return body.Data?.TotalRecords ?? -1;
  }

  /** Ids of the rows of a list route (the first 100). */
  async listChildIds(route: string): Promise<number[]> {
    const [, body] = await this.secureGET<PagedData<{ Id?: number, IdProduct?: number }>>(route);
    return (body.Data?.Data ?? []).map(row => row.Id ?? row.IdProduct ?? 0).filter(id => id > 0);
  }

  /** Delete a child row; returns the HTTP status. */
  async deleteChild(route: string): Promise<number> {
    const [response] = await this.secureDELETE<unknown>(route);
    return response.status();
  }
}
