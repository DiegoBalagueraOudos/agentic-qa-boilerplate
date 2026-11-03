/**
 * KATA Architecture - Layer 3: Terminals API Component (data helper for the SUC cases)
 *
 * A minimal helper: SUC-001, SUC-009 and SUC-010 need a terminal that belongs to a generated
 * branch (a branch with an active terminal reports `TerminalsCount` and cannot be deactivated or
 * deleted). No ATC lives here; the TER prefix will extend this component later.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - POST   /tenants/{tenantId}/terminals        - create
 * - GET    /tenants/{tenantId}/terminals/{id}   - read one
 * - PUT    /tenants/{tenantId}/terminals/{id}   - update (here: IsActive)
 * - DELETE /tenants/{tenantId}/terminals/{id}   - soft delete
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, CreatedEntityData } from '@schemas/auth.types';
import type { BulkImportResultData, CreateTerminalPayload, TerminalData, UpdateTerminalPayload } from '@schemas/resources.types';
import type { PagedData } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { expect } from '@playwright/test';
import { atc, step } from '@utils/decorators';

/** The generated tenant and branch a TER input case works in. */
export interface TerminalScope {
  tenantId: number
  branchId: number
}

/**
 * One row of a TER input case. `reject` rows must answer `status` (400), `Ok` false, `code` (`VALIDATION_ERROR`) and
 * carry `message`, and create nothing; `accept` rows must answer 200.
 */
interface TerminalInputRow {
  label: string
  payload: object
  outcome: 'reject' | 'accept'
  status?: number
  code?: string
  message: RegExp
}

/** TER-014 and TER-015: the tenant and branch, plus the data moves of the steps class (device create/deactivate/read, terminal hand-over). */
export interface TerminalDeviceArgs {
  tenantId: number
  branchId: number
  track: (terminalId: number) => void
  addDevice: (terminalId: number) => Promise<number>
  deactivateDevice: (deviceId: number) => Promise<void>
  readDevice: (deviceId: number) => Promise<{ status: number, isActive: boolean | null }>
}

/** A generated branch as the TER cases see it: id, the code and the name that were sent. */
export interface GeneratedBranchRef {
  id: number
  code: string
  name: string
}

/** The backend's length refusal ("Maximo N caracteres"). */
const LENGTH_MESSAGE = /M.ximo \d+ caracteres/i;
const BRANCH_MESSAGE = /sede v.lida/i;
const MAC_MESSAGE = /MAC.*no es v.lido/i;
const TYPE_MESSAGE = /tipo|clasificaci.n/i;

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class TerminalsApi extends SecureApi {
  /** Create a terminal. Fixed assertions: 200, `Ok`, an id in `Data`. */
  @step
  async createTerminal(tenantId: number, payload: CreateTerminalPayload): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const [response, body] = await this.securePOST<CreatedEntityData, CreateTerminalPayload>(`/tenants/${tenantId}/terminals`, payload);

    expect(response.status(), `create terminal: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  // ============================================
  // Non-asserting helpers (TER cases): they return the answer, the ATC judges it
  // ============================================

  /** Create a terminal; asserts nothing. NOT a `@step`: the payload may be hostile. */
  async attemptCreateTerminal(tenantId: number, payload: object): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    return this.securePOST<CreatedEntityData, object>(`/tenants/${tenantId}/terminals`, payload);
  }

  /** Update a terminal with ANY body; asserts nothing. */
  async attemptUpdateTerminal(tenantId: number, terminalId: number, payload: object): Promise<[APIResponse, ApiEnvelope<TerminalData>]> {
    return this.securePUT<TerminalData, object>(`/tenants/${tenantId}/terminals/${terminalId}`, payload);
  }

  /** List a tenant's terminals (optionally one branch's); asserts nothing. */
  async listTerminals(tenantId: number, query: { page?: number, pageSize?: number, searchTerm?: string, branchId?: number } = {}): Promise<[APIResponse, ApiEnvelope<PagedData<TerminalData>>]> {
    const params = new URLSearchParams();
    if (query.page !== undefined) { params.set('Page', String(query.page)); }
    if (query.pageSize !== undefined) { params.set('PageSize', String(query.pageSize)); }
    if (query.searchTerm !== undefined) { params.set('SearchTerm', query.searchTerm); }
    if (query.branchId !== undefined) { params.set('branchId', String(query.branchId)); }
    const text = params.toString();
    return this.secureGET<PagedData<TerminalData>>(`/tenants/${tenantId}/terminals${text === '' ? '' : `?${text}`}`);
  }

  /** Upload one CSV file (multipart, not encrypted); asserts nothing. */
  async importCsv(tenantId: number, file: { name: string, content: string }): Promise<[APIResponse, ApiEnvelope<BulkImportResultData>]> {
    return this.secureMultipartPOST<BulkImportResultData>(`/tenants/${tenantId}/terminals/import-csv`, {
      name: file.name,
      mimeType: 'text/csv',
      buffer: Buffer.from(file.content, 'utf8'),
    });
  }

  /** Read one terminal; asserts nothing. */
  async getTerminal(tenantId: number, terminalId: number): Promise<[APIResponse, ApiEnvelope<TerminalData>]> {
    return this.secureGET<TerminalData>(`/tenants/${tenantId}/terminals/${terminalId}`);
  }

  /** Activate or deactivate a terminal. Fixed assertions: 200, `Ok`. */
  @step
  async setTerminalActive(tenantId: number, terminalId: number, isActive: boolean): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.securePUT<unknown, UpdateTerminalPayload>(`/tenants/${tenantId}/terminals/${terminalId}`, { IsActive: isActive });

    expect(response.status(), `set terminal active=${String(isActive)}: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /** Soft-delete a terminal; asserts nothing (cleanup tolerates a terminal that is already gone). */
  async attemptDeleteTerminal(tenantId: number, terminalId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/tenants/${tenantId}/terminals/${terminalId}`);
  }

  // ============================================
  // Test Cases (ATCs): input validation (TER-003 .. TER-012)
  // ============================================

  /** First line of an error, for a failure list (no stack, no call log). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** Delete generated terminals, tolerating the ones already gone (404). Returns one line per failure. */
  private async cleanupCreated(tenantId: number, terminalIds: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of terminalIds) {
      try {
        const [response] = await this.attemptDeleteTerminal(tenantId, id);
        if (response.status() !== 200 && response.status() !== 404) {
          failures.push(`delete terminal #${id}: HTTP ${response.status()}`);
        }
      }
      catch (error) {
        failures.push(`delete terminal #${id}: ${this.firstLine(error)}`);
      }
    }
    return failures;
  }

  /** The terminal id an answer created, or 0. */
  private createdId(body: ApiEnvelope<CreatedEntityData>): number {
    const id = body.Data?.Id;
    return typeof id === 'number' && id > 0 ? id : 0;
  }

  /**
   * Shared body of the TER input cases. Own crypto session, ONE positive Administrator login. The positive
   * control first (a valid terminal, or `args.control`), then every row. A `reject` row must answer its status
   * (400 unless set), `Ok` false, its code (`VALIDATION_ERROR` unless set) and carry its message, and create
   * nothing: the tenant's terminal total must equal the base plus what was created so far. An `accept` row must
   * answer 200. A reject row the product wrongly accepts is tracked and reported, and the loop goes on (the values
   * differ, so one accepted row hides nothing). Everything created is deleted before the session closes; every
   * failure is thrown once, naming the row and the status only.
   */
  private async runTerminalInput(args: { scope: TerminalScope, rows: TerminalInputRow[], what: string, control?: object, extra?: (createdIds: number[], failures: string[]) => Promise<void> }): Promise<void> {
    const { tenantId } = args.scope;
    const createdIds: number[] = [];
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      const [, base] = await this.listTerminals(tenantId, { pageSize: 1 });
      const baseTotal = base.Data?.TotalRecords ?? 0;
      const [response, body] = await this.attemptCreateTerminal(tenantId, args.control ?? this.terminalFor(args.scope));
      const controlId = this.createdId(body);
      if (controlId > 0) {
        createdIds.push(controlId);
      }
      expect(response.status(), `control (valid terminal): ${body.CodeError ?? 'no error code'} ${JSON.stringify(body.ValidationErrors ?? [])}`).toBe(200);

      for (const row of args.rows) {
        try {
          const [rowResponse, rowBody] = await this.attemptCreateTerminal(tenantId, row.payload);
          const status = rowResponse.status();
          const id = this.createdId(rowBody);
          if (id > 0) {
            createdIds.push(id);
          }
          if (row.outcome === 'accept') {
            if (status !== 200 || rowBody.Ok !== true || id === 0) {
              failures.push(`${row.label}: expected ACCEPTED (200), got HTTP ${status} ${rowBody.CodeError ?? 'no error code'}`);
            }
            continue;
          }
          if (id > 0) {
            failures.push(`${row.label}: the product ACCEPTED the create (HTTP ${status}, ${rowBody.CodeError ?? 'no error code'})`);
            continue;
          }
          const expectedStatus = row.status ?? 400;
          const expectedCode = row.code ?? 'VALIDATION_ERROR';
          const text = `${rowBody.Error ?? ''} ${JSON.stringify(rowBody.ValidationErrors ?? [])}`;
          if (status !== expectedStatus || rowBody.Ok !== false || rowBody.CodeError !== expectedCode) {
            failures.push(`${row.label}: HTTP ${status} Ok=${String(rowBody.Ok)} CodeError=${String(rowBody.CodeError)} (expected ${expectedStatus}, false, ${expectedCode})`);
          }
          else if (!row.message.test(text)) {
            failures.push(`${row.label}: HTTP ${status} ${expectedCode}, the message ${row.message} is missing`);
          }
          const [, list] = await this.listTerminals(tenantId, { pageSize: 1 });
          if ((list.Data?.TotalRecords ?? 0) !== baseTotal + createdIds.length) {
            failures.push(`${row.label}: the terminal total changed after the rejected create`);
          }
        }
        catch (error) {
          failures.push(`row ${row.label}: ${this.firstLine(error)}`);
        }
      }
      await args.extra?.(createdIds, failures);
    }
    catch (error) {
      failures.push(`control: ${this.firstLine(error)}`);
    }
    finally {
      failures.push(...await this.cleanupCreated(tenantId, createdIds));
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
    }
  }

  /** A valid terminal payload for the scope, with overrides (an omitted field is removed with `omit`). */
  private terminalFor(scope: TerminalScope, overrides: Partial<CreateTerminalPayload> = {}, omit: Array<keyof CreateTerminalPayload> = []): object {
    const payload: Record<string, unknown> = { ...this.data.createTerminalPayload(scope.branchId, overrides) };
    for (const key of omit) {
      delete payload[key];
    }
    return payload;
  }

  /**
   * TER-003: a terminal needs a valid branch. Control first; then the branch omitted and 0 (400
   * `VALIDATION_ERROR` naming the branch), a nonexistent branch (404 `BRANCH_NOT_FOUND`) and an inactive branch
   * (400 `BRANCH_INACTIVE`). Nothing is created.
   */
  @atc('TER-003')
  async rejectMissingBranch(scope: TerminalScope & { inactiveBranchId: number }): Promise<void> {
    const rows: TerminalInputRow[] = [
      { label: 'branch omitted', payload: this.terminalFor(scope, {}, ['BranchId']), outcome: 'reject', message: BRANCH_MESSAGE },
      { label: 'branch 0', payload: this.terminalFor(scope, { BranchId: 0 }), outcome: 'reject', message: BRANCH_MESSAGE },
      { label: 'branch does not exist', payload: this.terminalFor(scope, { BranchId: 999999999 }), outcome: 'reject', status: 404, code: 'BRANCH_NOT_FOUND', message: /sede/i },
      { label: 'branch inactive', payload: this.terminalFor(scope, { BranchId: scope.inactiveBranchId }), outcome: 'reject', code: 'BRANCH_INACTIVE', message: /inactiva/i },
    ];
    await this.runTerminalInput({ scope, rows, what: 'terminal branch', control: this.terminalFor(scope) });
  }

  /**
   * TER-004: invalid terminal names are refused. Control first, then empty, whitespace only and 101 characters
   * (each 400 `VALIDATION_ERROR`, nothing created) and, LAST, the documented boundary: a name of exactly 100
   * characters must be ACCEPTED (case and SPA say 100; the backend limit is 40, so this row fails today).
   */
  @atc('TER-004')
  async rejectInvalidTerminalNames(scope: TerminalScope): Promise<void> {
    const rows: TerminalInputRow[] = this.data.createInvalidTerminalNames().map(row => ({
      label: `name (${row.label})`,
      payload: this.terminalFor(scope, { TerminalName: row.value }),
      outcome: 'reject',
      message: row.label.includes('characters') ? LENGTH_MESSAGE : /nombre.*requerido/i,
    }));
    rows.push({ label: 'name (100 characters, documented limit)', payload: this.terminalFor(scope, { TerminalName: this.data.createTerminalNameOfLength(100) }), outcome: 'accept', message: LENGTH_MESSAGE });
    await this.runTerminalInput({ scope, rows, what: 'terminal name', control: this.terminalFor(scope) });
  }

  /**
   * TER-005: both MAC separators are accepted (`AA:BB:CC:DD:EE:FF` and `aa-bb-cc-dd-ee-02` shapes, generated) and
   * the value is stored as sent (not normalised).
   */
  @atc('TER-005')
  async acceptColonAndHyphenMacs(scope: TerminalScope): Promise<void> {
    const colon = this.data.createMac(':', 'upper');
    const hyphen = this.data.createMac('-', 'lower');
    const rows: TerminalInputRow[] = [
      { label: 'MAC with colons (upper case)', payload: this.terminalFor(scope, { Mac: colon }), outcome: 'accept', message: MAC_MESSAGE },
      { label: 'MAC with hyphens (lower case)', payload: this.terminalFor(scope, { Mac: hyphen }), outcome: 'accept', message: MAC_MESSAGE },
    ];
    await this.runTerminalInput({
      scope,
      rows,
      what: 'terminal MAC format',
      extra: async (createdIds, failures) => {
        for (const [index, sent] of [colon, hyphen].entries()) {
          const id = createdIds[index + 1];
          if (id === undefined) {
            continue;
          }
          const [response, body] = await this.getTerminal(scope.tenantId, id);
          verify(failures, response.status() === 200 && body.Data?.Mac === sent, `read back MAC #${index + 1}: HTTP ${response.status()} or stored value differs from what was sent`);
        }
      },
    });
  }

  /**
   * TER-006: malformed MACs are refused (strict format of the case: six hex pairs with one kind of separator).
   * Empty is "required"; short, long, non-hex letters, no separators, spaces, mixed separators and `ZZ:22` are 400
   * `VALIDATION_ERROR` naming the MAC format. Rows the backend lets through fail today (its pattern accepts any
   * alphanumeric text) and are reported one by one.
   */
  @atc('TER-006')
  async rejectMalformedMacs(scope: TerminalScope): Promise<void> {
    const rows: TerminalInputRow[] = [
      { label: 'MAC empty', payload: this.terminalFor(scope, { Mac: '' }), outcome: 'reject', message: /MAC.*requerida/i },
      ...this.data.createMalformedMacs().map(row => ({
        label: `MAC (${row.label})`,
        payload: this.terminalFor(scope, { Mac: row.value }),
        outcome: 'reject' as const,
        message: MAC_MESSAGE,
      })),
    ];
    await this.runTerminalInput({ scope, rows, what: 'terminal MAC format' });
  }

  /**
   * TER-007: a MAC already used by an active terminal of the tenant is refused (400 `TERMINAL_MAC_DUPLICATE`),
   * also in the other separator and in lower case. Nothing is created and the MAC search finds only the first terminal.
   */
  @atc('TER-007')
  async rejectDuplicateMac(scope: TerminalScope): Promise<void> {
    const mac = this.data.createMac(':', 'upper');
    const duplicate = (label: string, value: string): TerminalInputRow => ({
      label,
      payload: this.terminalFor(scope, { Mac: value }),
      outcome: 'reject',
      code: 'TERMINAL_MAC_DUPLICATE',
      message: /MAC.*registrada/i,
    });
    await this.runTerminalInput({
      scope,
      rows: [
        duplicate('same MAC', mac),
        duplicate('same MAC with hyphens', mac.replace(/:/g, '-')),
        duplicate('same MAC in lower case', mac.toLowerCase()),
      ],
      what: 'duplicate MAC',
      control: this.terminalFor(scope, { Mac: mac }),
      extra: async (_createdIds, failures) => {
        const [response, list] = await this.listTerminals(scope.tenantId, { searchTerm: mac, pageSize: 10 });
        verify(failures, response.status() === 200 && list.Data?.TotalRecords === 1, `search by MAC: HTTP ${response.status()}, total ${String(list.Data?.TotalRecords)} (expected only the first terminal)`);
      },
    });
  }

  /**
   * TER-008: IP addresses. A valid IPv4 and a valid abbreviated IPv6 (`2001:db8::1`) are ACCEPTED; `256.1.1.1`,
   * `1.2.3` and text are 400 `VALIDATION_ERROR`. The IPv6 row is last and fails today (the backend pattern only
   * accepts the full eight-group form).
   */
  @atc('TER-008')
  async validateIpAddresses(scope: TerminalScope): Promise<void> {
    const rows: TerminalInputRow[] = [
      ...this.data.createInvalidIps().map(row => ({
        label: `IP (${row.label})`,
        payload: this.terminalFor(scope, { IpAddress: row.value }),
        outcome: 'reject' as const,
        message: /direcci.n IP/i,
      })),
      { label: 'IP (valid IPv4)', payload: this.terminalFor(scope, { IpAddress: '192.168.10.20' }), outcome: 'accept', message: /direcci.n IP/i },
      { label: 'IP (valid abbreviated IPv6)', payload: this.terminalFor(scope, { IpAddress: '2001:db8::1' }), outcome: 'accept', message: /direcci.n IP/i },
    ];
    await this.runTerminalInput({ scope, rows, what: 'terminal IP address', control: this.terminalFor(scope) });
  }

  /** TER-009: a host name with spaces or symbols is refused (400 `VALIDATION_ERROR` naming the rule); a valid host is accepted. */
  @atc('TER-009')
  async rejectInvalidHostNames(scope: TerminalScope): Promise<void> {
    const rows: TerminalInputRow[] = [
      ...this.data.createInvalidHostNames().map(row => ({
        label: `host (${row.label})`,
        payload: this.terminalFor(scope, { HostName: row.value }),
        outcome: 'reject' as const,
        message: /Host solo permite/i,
      })),
      { label: 'host (valid)', payload: this.terminalFor(scope, { HostName: this.data.createHostName() }), outcome: 'accept', message: /Host/i },
    ];
    await this.runTerminalInput({ scope, rows, what: 'terminal host name', control: this.terminalFor(scope) });
  }

  /** TER-010: only MOVIL (with IMEI) and FIJO are accepted; another value or an empty type is 400 `VALIDATION_ERROR`. */
  @atc('TER-010')
  async restrictDeviceTypeToMovilAndFijo(scope: TerminalScope): Promise<void> {
    const rows: TerminalInputRow[] = [
      { label: 'type FIJO', payload: this.terminalFor(scope, { DeviceType: 'FIJO' }), outcome: 'accept', message: TYPE_MESSAGE },
      { label: 'type MOVIL with IMEI', payload: this.data.createMobileTerminalPayload(scope.branchId), outcome: 'accept', message: TYPE_MESSAGE },
      { label: 'type TABLET', payload: this.terminalFor(scope, { DeviceType: 'TABLET' }), outcome: 'reject', message: /MOVIL o FIJO/i },
      { label: 'type empty', payload: this.terminalFor(scope, { DeviceType: '' }), outcome: 'reject', message: /clasificaci.n.*requerida/i },
    ];
    await this.runTerminalInput({ scope, rows, what: 'terminal device type', control: this.terminalFor(scope) });
  }

  /** TER-011: a mobile terminal needs an IMEI of exactly 15 digits; 14, 16 or letters are 400 `VALIDATION_ERROR`; 15 digits are accepted. */
  @atc('TER-011')
  async requireFifteenDigitImei(scope: TerminalScope): Promise<void> {
    const rows: TerminalInputRow[] = [
      ...this.data.createInvalidImeis().map(row => ({
        label: `IMEI (${row.label})`,
        payload: this.data.createMobileTerminalPayload(scope.branchId, { Imei: row.value }),
        outcome: 'reject' as const,
        message: row.label === 'letters' ? /solo debe contener d.gitos/i : /exactamente 15/i,
      })),
      { label: 'IMEI (15 digits)', payload: this.data.createMobileTerminalPayload(scope.branchId), outcome: 'accept', message: /IMEI/i },
    ];
    await this.runTerminalInput({ scope, rows, what: 'terminal IMEI', control: this.terminalFor(scope) });
  }

  /**
   * TER-012: the IMEI is required for MOVIL (rule confirmed) and not for FIJO. A mobile terminal without IMEI
   * (omitted or empty) is 400 `VALIDATION_ERROR` "requerido"; a fixed terminal without IMEI is accepted. Changing a
   * mobile terminal to FIJO clears its IMEI.
   */
  @atc('TER-012')
  async requireImeiForMovil(scope: TerminalScope): Promise<void> {
    const mobile = this.data.createMobileTerminalPayload(scope.branchId);
    const rows: TerminalInputRow[] = [
      { label: 'MOVIL without IMEI', payload: this.terminalFor(scope, { DeviceType: 'MOVIL' }), outcome: 'reject', message: /IMEI.*requerido/i },
      { label: 'MOVIL with empty IMEI', payload: this.terminalFor(scope, { DeviceType: 'MOVIL', Imei: '' }), outcome: 'reject', message: /IMEI.*requerido/i },
      { label: 'FIJO without IMEI', payload: this.terminalFor(scope, { DeviceType: 'FIJO' }), outcome: 'accept', message: /IMEI/i },
      { label: 'MOVIL with IMEI', payload: mobile, outcome: 'accept', message: /IMEI/i },
    ];
    await this.runTerminalInput({
      scope,
      rows,
      what: 'terminal IMEI requirement',
      control: this.terminalFor(scope),
      extra: async (createdIds, failures) => {
        const mobileId = createdIds.at(-1);
        if (mobileId === undefined || createdIds.length < 3) {
          return;
        }
        const [updateResponse, updated] = await this.attemptUpdateTerminal(scope.tenantId, mobileId, { DeviceType: 'FIJO' });
        verify(failures, updateResponse.status() === 200 && updated.Ok === true, `change MOVIL to FIJO: HTTP ${updateResponse.status()} ${updated.CodeError ?? 'no error code'}`);
        const [readResponse, read] = await this.getTerminal(scope.tenantId, mobileId);
        verify(failures, readResponse.status() === 200 && read.Data?.DeviceType === 'FIJO' && (read.Data.Imei === null || read.Data.Imei === undefined), 'after changing to FIJO, the IMEI is not cleared');
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): catalog (TER-001, 002, 013)
  // ============================================

  /** Common frame of the catalog ATCs: one Administrator session, collected failures, cleanup of what the body created, one thrown error. */
  private async runCatalogCase(args: { what: string, tenantId: number, body: (createdIds: number[], failures: string[]) => Promise<void> }): Promise<void> {
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
      failures.push(...await this.cleanupCreated(args.tenantId, createdIds));
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
    }
  }

  /** Create a terminal for a catalog case and record its id for cleanup BEFORE judging the answer. */
  private async createTracked(tenantId: number, payload: object, createdIds: number[]): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const answer = await this.attemptCreateTerminal(tenantId, payload);
    const id = this.createdId(answer[1]);
    if (id > 0) {
      createdIds.push(id);
    }
    return answer;
  }

  /**
   * TER-001: list terminals with their branch and `DevicesCount`. Two generated terminals in two branches share a
   * token; the list shows each branch name, pages of 1 give 2 pages, the search finds exactly the expected terminal
   * by name, by MAC (in the other separator) and by branch code, the branch filter returns only its branch, and
   * `DevicesCount` is 1 on the terminal that has a device and 0 on the other. The terminals are handed to `track`
   * (their owner removes device, terminals and branches in order).
   */
  @atc('TER-001')
  async listTerminalsWithBranchAndDevicesCount(args: { tenantId: number, branches: [GeneratedBranchRef, GeneratedBranchRef], track: (terminalId: number) => void, addDevice: (terminalId: number) => Promise<void> }): Promise<void> {
    const { tenantId, branches } = args;
    const token = this.data.createBranchCodeOfLength(9).slice(3);
    const specs = branches.map((branch, index) => ({
      branch,
      name: `QAX${token} ${index === 0 ? 'Alfa' : 'Beta'}`,
      mac: this.data.createMac(':', 'upper'),
      id: 0,
    }));
    const failures: string[] = [];

    await this.openAdministratorSession();
    try {
      for (const spec of specs) {
        const [response, body] = await this.attemptCreateTerminal(tenantId, this.data.createTerminalPayload(spec.branch.id, { TerminalName: spec.name, Mac: spec.mac }));
        spec.id = this.createdId(body);
        if (spec.id > 0) {
          args.track(spec.id);
        }
        verify(failures, response.status() === 200 && spec.id > 0, `create ${spec.name}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
      }
      const [alfa, beta] = specs;
      if (specs.every(spec => spec.id > 0)) {
        await args.addDevice(alfa.id);

        const [firstResponse, first] = await this.listTerminals(tenantId, { searchTerm: token, page: 1, pageSize: 1 });
        const [secondResponse, second] = await this.listTerminals(tenantId, { searchTerm: token, page: 2, pageSize: 1 });
        const pagedIds = [...(first.Data?.Data ?? []), ...(second.Data?.Data ?? [])].map(row => row.Id).sort((a, b) => a - b);
        verify(failures, firstResponse.status() === 200 && secondResponse.status() === 200 && first.Data?.Data.length === 1 && second.Data?.Data.length === 1 && first.Data.TotalRecords === 2 && pagedIds.join() === [alfa.id, beta.id].sort((a, b) => a - b).join(), `pages of 1: HTTP ${firstResponse.status()}/${secondResponse.status()}, ${String(first.Data?.Data.length)}+${String(second.Data?.Data.length)} rows, total ${String(first.Data?.TotalRecords)} (expected 1+1 rows covering both terminals, total 2)`);

        const searches: Array<{ label: string, query: { searchTerm: string, branchId?: number }, expected: number[] }> = [
          { label: 'by name (lower case)', query: { searchTerm: alfa.name.toLowerCase() }, expected: [alfa.id] },
          { label: 'by MAC with hyphens', query: { searchTerm: alfa.mac.replace(/:/g, '-') }, expected: [alfa.id] },
          { label: 'by branch code', query: { searchTerm: beta.branch.code }, expected: [beta.id] },
          { label: 'with the branch filter', query: { searchTerm: token, branchId: alfa.branch.id }, expected: [alfa.id] },
          { label: 'without a match', query: { searchTerm: `zz${token}` }, expected: [] },
        ];
        for (const search of searches) {
          const [response, body] = await this.listTerminals(tenantId, { ...search.query, pageSize: 10 });
          const ids = body.Data?.Data.map(row => row.Id) ?? [];
          verify(failures, response.status() === 200 && ids.join() === search.expected.join() && body.Data?.TotalRecords === search.expected.length, `search ${search.label}: HTTP ${response.status()}, rows [${ids.join()}] total ${String(body.Data?.TotalRecords)} (expected [${search.expected.join()}])`);
        }

        const [allResponse, all] = await this.listTerminals(tenantId, { searchTerm: token, pageSize: 10 });
        const rows = new Map(all.Data?.Data.map(row => [row.Id, row]));
        verify(failures, allResponse.status() === 200 && rows.get(alfa.id)?.DevicesCount === 1 && rows.get(beta.id)?.DevicesCount === 0, `DevicesCount: Alfa ${String(rows.get(alfa.id)?.DevicesCount)}, Beta ${String(rows.get(beta.id)?.DevicesCount)} (expected 1, 0)`);
        verify(failures, rows.get(alfa.id)?.BranchName === alfa.branch.name && rows.get(beta.id)?.BranchName === beta.branch.name, 'a row does not show the name of its branch');
      }
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} terminal list checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * TER-002: create a terminal with branch, name, host, description, MAC, IP and type FIJO. The answer is 200,
   * `Ok`, an id; the terminal is active, belongs to the tenant and the branch (name shown), keeps every field as
   * sent and has `CreatedBy`. It is found by `GET {id}` and by the name search (exactly 1 match).
   */
  @atc('TER-002')
  async createTerminalWithBranchNameMacAndType(scope: TerminalScope & { branchName: string }): Promise<void> {
    const sent = this.data.createTerminalPayload(scope.branchId, { HostName: this.data.createHostName(), Description: 'QAX terminal de prueba', IpAddress: '10.20.30.40' });
    await this.runCatalogCase({
      what: 'terminal create',
      tenantId: scope.tenantId,
      body: async (ids, failures) => {
        const [response, body] = await this.createTracked(scope.tenantId, sent, ids);
        verify(failures, response.status() === 200 && body.Ok === true && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        if (ids.length !== 1) {
          return;
        }
        const [readResponse, read] = await this.getTerminal(scope.tenantId, ids[0]);
        const terminal = read.Data;
        verify(failures, readResponse.status() === 200 && terminal !== undefined, `read by id: HTTP ${readResponse.status()}`);
        if (terminal) {
          verify(failures, terminal.IsActive === true, 'read: the terminal is not active');
          verify(failures, terminal.TenantId === scope.tenantId && terminal.BranchId === scope.branchId && terminal.BranchName === scope.branchName, 'read: tenant, branch or branch name differ');
          verify(failures, terminal.TerminalName === sent.TerminalName && terminal.HostName === sent.HostName && terminal.Description === sent.Description, 'read: name, host or description differ from what was sent');
          verify(failures, terminal.Mac === sent.Mac && terminal.IpAddress === sent.IpAddress && terminal.DeviceType === 'FIJO', 'read: MAC, IP or type differ from what was sent');
          verify(failures, typeof terminal.CreatedBy === 'string' && terminal.CreatedBy !== '', 'read: CreatedBy is not set');
        }
        const [listResponse, list] = await this.listTerminals(scope.tenantId, { searchTerm: sent.TerminalName, pageSize: 10 });
        verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 1 && list.Data.Data[0]?.Id === ids[0], `search by name: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 1 and the created terminal)`);
      },
    });
  }

  /**
   * TER-013: edit a terminal and move it to another branch. The PUT of name, host, IP, description and the other
   * branch answers 200 and the read-back shows the new values and branch, the MAC unchanged, the terminal still
   * active, `UpdatedAt` later than `CreatedAt` and `UpdatedBy` set. Renaming it to the name of another terminal of
   * the same branch answers 400 `TERMINAL_NAME_DUPLICATE` and leaves the name as it was.
   */
  @atc('TER-013')
  async editTerminalAndChangeBranch(args: { tenantId: number, branchId: number, secondBranchId: number }): Promise<void> {
    const { tenantId } = args;
    const original = this.data.createTerminalPayload(args.branchId);
    const neighbour = this.data.createTerminalPayload(args.secondBranchId);
    const edit: UpdateTerminalPayload = {
      BranchId: args.secondBranchId,
      TerminalName: this.data.createTerminalNameOfLength(30),
      HostName: this.data.createHostName(),
      IpAddress: '172.16.0.9',
      Description: 'QAX editada',
    };
    await this.runCatalogCase({
      what: 'terminal edit',
      tenantId,
      body: async (ids, failures) => {
        const [response, body] = await this.createTracked(tenantId, original, ids);
        await this.createTracked(tenantId, neighbour, ids);
        verify(failures, response.status() === 200 && ids.length === 2, `setup: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}, ${ids.length} of 2 terminals created`);
        if (ids.length !== 2) {
          return;
        }
        const [editResponse, edited] = await this.attemptUpdateTerminal(tenantId, ids[0], edit);
        verify(failures, editResponse.status() === 200 && edited.Ok === true, `edit: HTTP ${editResponse.status()} ${edited.CodeError ?? 'no error code'}`);
        const [readResponse, read] = await this.getTerminal(tenantId, ids[0]);
        const terminal = read.Data;
        verify(failures, readResponse.status() === 200 && terminal !== undefined, `read after edit: HTTP ${readResponse.status()}`);
        if (terminal) {
          verify(failures, terminal.TerminalName === edit.TerminalName && terminal.HostName === edit.HostName && terminal.IpAddress === edit.IpAddress && terminal.Description === edit.Description, 'read after edit: name, host, IP or description are not the new values');
          verify(failures, terminal.BranchId === args.secondBranchId, 'read after edit: the terminal is not in the other branch');
          verify(failures, terminal.Mac === original.Mac, 'read after edit: the MAC changed');
          verify(failures, terminal.IsActive === true, 'read after edit: the terminal is no longer active');
          verify(failures, terminal.UpdatedAt != null && Date.parse(terminal.UpdatedAt) > Date.parse(terminal.CreatedAt), 'read after edit: UpdatedAt is not later than CreatedAt');
          verify(failures, typeof terminal.UpdatedBy === 'string' && terminal.UpdatedBy !== '', 'read after edit: UpdatedBy is not set');
        }
        const [clashResponse, clash] = await this.attemptUpdateTerminal(tenantId, ids[0], { TerminalName: neighbour.TerminalName });
        verify(failures, clashResponse.status() === 400 && clash.CodeError === 'TERMINAL_NAME_DUPLICATE', `rename to a neighbour's name: HTTP ${clashResponse.status()} CodeError=${String(clash.CodeError)} (expected 400, TERMINAL_NAME_DUPLICATE)`);
        const [afterResponse, after] = await this.getTerminal(tenantId, ids[0]);
        verify(failures, afterResponse.status() === 200 && after.Data?.TerminalName === edit.TerminalName, 'after the refused rename, the name changed');
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): dependencies (TER-014, 015)
  // ============================================

  /**
   * TER-014: a terminal with an active device cannot be deactivated. The PUT answers 400
   * `TERMINAL_HAS_ACTIVE_DEVICES`, the terminal and the device stay active. Once the device is inactive the terminal
   * deactivates (200). The terminal is handed to `track` (its owner removes device, terminal and branch in order).
   */
  @atc('TER-014')
  async refuseDeactivatingTerminalWithActiveDevice(args: TerminalDeviceArgs): Promise<void> {
    const { tenantId } = args;
    await this.runCatalogCase({
      what: 'terminal deactivation',
      tenantId,
      body: async (_ids, failures) => {
        const [createResponse, created] = await this.attemptCreateTerminal(tenantId, this.data.createTerminalPayload(args.branchId));
        const terminalId = this.createdId(created);
        if (terminalId > 0) {
          args.track(terminalId);
        }
        verify(failures, createResponse.status() === 200 && terminalId > 0, `create: HTTP ${createResponse.status()} ${created.CodeError ?? 'no error code'}`);
        if (terminalId <= 0) {
          return;
        }
        const deviceId = await args.addDevice(terminalId);

        const [refusedResponse, refused] = await this.attemptUpdateTerminal(tenantId, terminalId, { IsActive: false });
        verify(failures, refusedResponse.status() === 400 && refused.Ok === false && refused.CodeError === 'TERMINAL_HAS_ACTIVE_DEVICES', `deactivate with an active device: HTTP ${refusedResponse.status()} Ok=${String(refused.Ok)} CodeError=${String(refused.CodeError)} (expected 400, false, TERMINAL_HAS_ACTIVE_DEVICES)`);
        const [stillResponse, still] = await this.getTerminal(tenantId, terminalId);
        verify(failures, stillResponse.status() === 200 && still.Data?.IsActive === true, 'after the refusal, the terminal is no longer active');
        const device = await args.readDevice(deviceId);
        verify(failures, device.status === 200 && device.isActive === true, `after the refusal, the device: HTTP ${device.status}, active=${String(device.isActive)} (expected 200, true)`);

        await args.deactivateDevice(deviceId);
        const [offResponse, off] = await this.attemptUpdateTerminal(tenantId, terminalId, { IsActive: false });
        verify(failures, offResponse.status() === 200 && off.Ok === true, `deactivate with an inactive device: HTTP ${offResponse.status()} ${off.CodeError ?? 'no error code'}`);
        const [offReadResponse, offRead] = await this.getTerminal(tenantId, terminalId);
        verify(failures, offReadResponse.status() === 200 && offRead.Data?.IsActive === false, 'after the deactivation, the terminal is still active');
      },
    });
  }

  /**
   * TER-015: delete is soft. With an active device the DELETE answers 400 `TERMINAL_HAS_ACTIVE_DEVICES` and the
   * terminal stays. With the device inactive the DELETE answers 200, the terminal is absent from the list and
   * `GET {id}` answers 404 `TERMINAL_NOT_FOUND`. Second row (finding of SUC-010): a terminal whose branch was
   * already deleted is deleted with 200 (the product answers 500 today although the terminal is removed).
   */
  @atc('TER-015')
  async deleteTerminalSoftly(args: TerminalDeviceArgs & { newBranch: () => Promise<number>, deleteBranch: (branchId: number) => Promise<void> }): Promise<void> {
    const { tenantId } = args;
    const payload = this.data.createTerminalPayload(args.branchId);
    await this.runCatalogCase({
      what: 'terminal delete',
      tenantId,
      body: async (_ids, failures) => {
        const [createResponse, created] = await this.attemptCreateTerminal(tenantId, payload);
        const terminalId = this.createdId(created);
        if (terminalId > 0) {
          args.track(terminalId);
        }
        verify(failures, createResponse.status() === 200 && terminalId > 0, `create: HTTP ${createResponse.status()} ${created.CodeError ?? 'no error code'}`);
        if (terminalId <= 0) {
          return;
        }
        const deviceId = await args.addDevice(terminalId);

        const [refusedResponse, refused] = await this.attemptDeleteTerminal(tenantId, terminalId);
        verify(failures, refusedResponse.status() === 400 && refused.Ok === false && refused.CodeError === 'TERMINAL_HAS_ACTIVE_DEVICES', `delete with an active device: HTTP ${refusedResponse.status()} Ok=${String(refused.Ok)} CodeError=${String(refused.CodeError)} (expected 400, false, TERMINAL_HAS_ACTIVE_DEVICES)`);
        const [stillResponse, still] = await this.getTerminal(tenantId, terminalId);
        verify(failures, stillResponse.status() === 200 && still.Data?.IsActive === true, `after the refusal, the terminal: HTTP ${stillResponse.status()} (expected it to remain, active)`);

        await args.deactivateDevice(deviceId);
        const [deleteResponse, deleted] = await this.attemptDeleteTerminal(tenantId, terminalId);
        verify(failures, deleteResponse.status() === 200 && deleted.Ok === true, `delete with an inactive device: HTTP ${deleteResponse.status()} ${deleted.CodeError ?? 'no error code'}`);
        const [listResponse, list] = await this.listTerminals(tenantId, { searchTerm: payload.TerminalName, pageSize: 10 });
        verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 0, `after the delete, the name search: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 0)`);
        const [goneResponse, gone] = await this.getTerminal(tenantId, terminalId);
        verify(failures, goneResponse.status() === 404 && gone.CodeError === 'TERMINAL_NOT_FOUND', `read after the delete: HTTP ${goneResponse.status()} CodeError=${String(gone.CodeError)} (expected 404, TERMINAL_NOT_FOUND)`);

        // Row 2: a terminal whose branch is already deleted (the branch needs its terminal inactive first)
        const orphanBranchId = await args.newBranch();
        const [orphanResponse, orphan] = await this.attemptCreateTerminal(tenantId, this.data.createTerminalPayload(orphanBranchId));
        const orphanId = this.createdId(orphan);
        if (orphanId > 0) {
          args.track(orphanId);
        }
        verify(failures, orphanResponse.status() === 200 && orphanId > 0, `orphan row, create: HTTP ${orphanResponse.status()} ${orphan.CodeError ?? 'no error code'}`);
        if (orphanId > 0) {
          const [offResponse, off] = await this.attemptUpdateTerminal(tenantId, orphanId, { IsActive: false });
          verify(failures, offResponse.status() === 200 && off.Ok === true, `orphan row, deactivate: HTTP ${offResponse.status()} ${off.CodeError ?? 'no error code'}`);
          await args.deleteBranch(orphanBranchId);
          const [orphanDeleteResponse, orphanDelete] = await this.attemptDeleteTerminal(tenantId, orphanId);
          verify(failures, orphanDeleteResponse.status() === 200 && orphanDelete.Ok === true, `orphan row, delete a terminal whose branch was deleted: HTTP ${orphanDeleteResponse.status()} ${orphanDelete.CodeError ?? 'no error code'} (expected 200)`);
        }
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): CSV import (TER-016)
  // ============================================

  /**
   * TER-016: CSV import, as SUC-011 plus the terminal rules. A valid file reports Total, Exitosos and no errors. A
   * mixed file (missing branch code, unknown branch, malformed MAC `ZZ:22`, duplicate name, mobile without IMEI)
   * reports one `Errores` entry per bad row with its `Fila` and imports the good rows. A file whose second row
   * repeats an existing MAC reports THAT row and imports the other (today the whole batch fails with a concurrency
   * error and no row detail). An empty file answers 400 `CSV_FILE_REQUIRED`, a `.txt` file 400
   * `CSV_INVALID_EXTENSION`, a file without the required headers 400 `CSV_INVALID_FORMAT`, and none creates a terminal.
   * Every imported terminal is deleted at the end.
   */
  @atc('TER-016')
  async importTerminalsFromCsv(scope: TerminalScope & { branchCode: string }): Promise<void> {
    const { tenantId, branchCode } = scope;
    const token = this.data.createBranchCodeOfLength(9).slice(3);
    const row = (n: number, overrides: { name?: string, branchCode?: string, mac?: string, imei?: string, type?: string } = {}) => ({
      name: overrides.name ?? `QAX${token} T${n}`,
      branchCode: overrides.branchCode ?? branchCode,
      mac: overrides.mac ?? this.data.createMac(':', 'upper'),
      imei: overrides.imei,
      type: overrides.type ?? 'FIJO',
    });
    const valid = [row(1), row(2), row(3, { type: 'MOVIL', imei: this.data.createImei() })];
    const mixed = [
      row(4),
      row(5, { branchCode: '' }),
      row(6, { branchCode: `NOEXISTE${token}` }),
      row(7, { mac: 'ZZ:22' }),
      row(8, { name: valid[0].name }),
      row(9, { type: 'MOVIL' }),
      row(10),
    ];
    const expectedErrors = [
      { Fila: 3, Campo: 'BranchCode' },
      { Fila: 4, Campo: 'BranchCode' },
      { Fila: 5, Campo: 'UserMac' },
      { Fila: 6, Campo: 'TerminalName' },
      { Fila: 7, Campo: 'IMEI' },
    ];
    const repeatedMac = [row(11), row(12, { mac: valid[0].mac })];
    await this.runCatalogCase({
      what: 'terminal CSV import',
      tenantId,
      body: async (ids, failures) => {
        try {
          const [validResponse, validBody] = await this.importCsv(tenantId, { name: 'terminales.csv', content: this.data.createTerminalCsv(valid) });
          const validResult = validBody.Data;
          verify(failures, validResponse.status() === 200 && validResult?.Total === 3 && validResult.Exitosos === 3 && validResult.Fallidos === 0 && validResult.Errores.length === 0, `valid file: HTTP ${validResponse.status()}, ${JSON.stringify(validResult)} (expected 3 total, 3 imported, 0 failed, no errors)`);

          const [mixedResponse, mixedBody] = await this.importCsv(tenantId, { name: 'terminales-mixto.csv', content: this.data.createTerminalCsv(mixed) });
          const mixedResult = mixedBody.Data;
          verify(failures, mixedResponse.status() === 200 && mixedResult?.Total === 7 && mixedResult.Exitosos === 2 && mixedResult.Fallidos === 5, `mixed file: HTTP ${mixedResponse.status()}, total ${String(mixedResult?.Total)} imported ${String(mixedResult?.Exitosos)} failed ${String(mixedResult?.Fallidos)} (expected 7, 2, 5)`);
          for (const expected of expectedErrors) {
            const found = mixedResult?.Errores.find(error => error.Fila === expected.Fila);
            verify(failures, found !== undefined && found.Campo === expected.Campo && found.Mensaje !== '', `mixed file: no error on row ${expected.Fila} for ${expected.Campo} (got ${found ? found.Campo : 'none'})`);
          }
          verify(failures, mixedResult?.Errores.length === expectedErrors.length, `mixed file: ${String(mixedResult?.Errores.length)} error entries (expected ${expectedErrors.length}, one per bad row)`);

          const [macResponse, macBody] = await this.importCsv(tenantId, { name: 'terminales-mac.csv', content: this.data.createTerminalCsv(repeatedMac) });
          const macResult = macBody.Data;
          verify(failures, macResponse.status() === 200 && macResult?.Total === 2 && macResult.Exitosos === 1 && macResult.Fallidos === 1 && macResult.Errores.length === 1 && macResult.Errores[0]?.Fila === 3 && macResult.Errores[0].Campo === 'UserMac', `repeated MAC file: HTTP ${macResponse.status()}, ${JSON.stringify(macResult)} (expected 2 total, 1 imported, 1 failed, one error on row 3 for UserMac)`);

          const [beforeResponse, before] = await this.listTerminals(tenantId, { searchTerm: token, pageSize: 50 });
          const refusals = [
            { label: 'empty file', file: { name: 'vacio.csv', content: '' }, code: 'CSV_FILE_REQUIRED' },
            { label: 'non-CSV extension', file: { name: 'terminales.txt', content: this.data.createTerminalCsv([row(13)]) }, code: 'CSV_INVALID_EXTENSION' },
            { label: 'missing headers', file: { name: 'sin-encabezados.csv', content: `Nombre,Sede\nQAX${token} T14,${branchCode}` }, code: 'CSV_INVALID_FORMAT' },
          ];
          for (const refusal of refusals) {
            const [response, body] = await this.importCsv(tenantId, refusal.file);
            verify(failures, response.status() === 400 && body.CodeError === refusal.code, `${refusal.label}: HTTP ${response.status()} CodeError=${String(body.CodeError)} (expected 400, ${refusal.code})`);
          }
          const [afterResponse, after] = await this.listTerminals(tenantId, { searchTerm: token, pageSize: 50 });
          verify(failures, beforeResponse.status() === 200 && afterResponse.status() === 200 && after.Data?.TotalRecords === before.Data?.TotalRecords, `after the refused files, the token search total went from ${String(before.Data?.TotalRecords)} to ${String(after.Data?.TotalRecords)} (expected no change)`);
        }
        finally {
          const [, all] = await this.listTerminals(tenantId, { searchTerm: token, pageSize: 50 });
          ids.push(...(all.Data?.Data.map(terminal => terminal.Id) ?? []));
        }
      },
    });
  }
}
