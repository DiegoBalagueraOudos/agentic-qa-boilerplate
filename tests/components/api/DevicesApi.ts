/**
 * KATA Architecture - Layer 3: Devices API Component (DIS cases; data helper for the TER cases)
 *
 * Devices ("captores") of a terminal: a terminal holds at most one device and the serial number is unique
 * in the whole system. Helpers named `attempt*` assert nothing and return the raw answer (the rejected-input
 * cases read the status and the error code themselves).
 *
 * Endpoints (relative to config.apiUrl, encrypted JSON bodies; import-csv is multipart and NOT encrypted):
 * - GET    /tenants/{tenantId}/devices                 - list (Page, PageSize, SearchTerm)
 * - GET    /tenants/{tenantId}/devices/{id}            - read one
 * - POST   /tenants/{tenantId}/devices                 - create
 * - PUT    /tenants/{tenantId}/devices/{id}            - update (partial)
 * - DELETE /tenants/{tenantId}/devices/{id}            - soft delete
 * - POST   /tenants/{tenantId}/devices/import-csv      - CSV import (headers DeviceCode, Serial, TerminalName)
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, CreatedEntityData } from '@schemas/auth.types';
import type { BulkImportResultData, CreateDevicePayload, DeviceData, UpdateDevicePayload } from '@schemas/resources.types';
import type { PagedData } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { expect } from '@playwright/test';
import { atc, step } from '@utils/decorators';

/** A generated terminal as the DIS cases see it: id, terminal name and its branch's code and name. */
export interface DeviceTerminalRef {
  id: number
  name: string
  branchCode: string
  branchName: string
}

/** The tenant a DIS input case works in and how it gets one fresh terminal per row (a terminal holds one device). */
export interface DeviceScope {
  tenantId: number
  newTerminal: () => Promise<number>
}

/** Data moves DIS-003 and DIS-007 need on top of the scope. */
export interface DeviceInputExtras {
  inactiveTerminal: () => Promise<number>
  /** A second generated tenant and one fresh terminal in it (DIS-007: the serial is unique across tenants). */
  other: { tenantId: number, newTerminal: () => Promise<number> }
}

/** What a DIS input row may need while it is built: the control device's terminal and payload. */
interface DeviceRowContext {
  controlTerminalId: number
  control: CreateDevicePayload
}

/**
 * One row of a DIS input case. `reject` rows must answer `status` (400), `Ok` false, `code` (`VALIDATION_ERROR`)
 * and carry `message`, and create nothing; `accept` rows must answer 200.
 */
interface DeviceInputRow {
  label: string
  build: (context: DeviceRowContext) => Promise<object>
  outcome: 'reject' | 'accept'
  status?: number
  code?: string
  message: RegExp
}

/** List query: names follow the backend's `PaginationParams`. */
interface DeviceListQuery {
  page?: number
  pageSize?: number
  searchTerm?: string
}

/** The backend's length refusal ("Maximo N caracteres"). */
const LENGTH_MESSAGE = /M.ximo \d+ caracteres/i;
const CODE_FORMAT_MESSAGE = /Solo letras, n.meros, guiones/i;

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class DevicesApi extends SecureApi {
  // ============================================
  // Helpers (no ATC)
  // ============================================

  /** Create a device. Fixed assertions: 200, `Ok`, an id in `Data`. */
  @step
  async createDevice(tenantId: number, payload: CreateDevicePayload): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const [response, body] = await this.securePOST<CreatedEntityData, CreateDevicePayload>(`/tenants/${tenantId}/devices`, payload);

    expect(response.status(), `create device: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  /** Create a device with ANY body; asserts nothing. NOT a `@step`: the payload may be hostile. */
  async attemptCreateDevice(tenantId: number, payload: object): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    return this.securePOST<CreatedEntityData, object>(`/tenants/${tenantId}/devices`, payload);
  }

  /** Update a device with ANY body; asserts nothing. */
  async attemptUpdateDevice(tenantId: number, deviceId: number, payload: object): Promise<[APIResponse, ApiEnvelope<DeviceData>]> {
    return this.securePUT<DeviceData, object>(`/tenants/${tenantId}/devices/${deviceId}`, payload);
  }

  /** List a tenant's devices; asserts nothing. */
  async listDevices(tenantId: number, query: DeviceListQuery = {}): Promise<[APIResponse, ApiEnvelope<PagedData<DeviceData>>]> {
    const params = new URLSearchParams();
    if (query.page !== undefined) { params.set('Page', String(query.page)); }
    if (query.pageSize !== undefined) { params.set('PageSize', String(query.pageSize)); }
    if (query.searchTerm !== undefined) { params.set('SearchTerm', query.searchTerm); }
    const text = params.toString();
    return this.secureGET<PagedData<DeviceData>>(`/tenants/${tenantId}/devices${text === '' ? '' : `?${text}`}`);
  }

  /** Upload one CSV file (multipart, not encrypted); asserts nothing. */
  async importCsv(tenantId: number, file: { name: string, content: string }): Promise<[APIResponse, ApiEnvelope<BulkImportResultData>]> {
    return this.secureMultipartPOST<BulkImportResultData>(`/tenants/${tenantId}/devices/import-csv`, {
      name: file.name,
      mimeType: 'text/csv',
      buffer: Buffer.from(file.content, 'utf8'),
    });
  }

  /** Read one device; asserts nothing. */
  async getDevice(tenantId: number, deviceId: number): Promise<[APIResponse, ApiEnvelope<DeviceData>]> {
    return this.secureGET<DeviceData>(`/tenants/${tenantId}/devices/${deviceId}`);
  }

  /** Activate or deactivate a device. Fixed assertions: 200, `Ok`. */
  @step
  async setDeviceActive(tenantId: number, deviceId: number, isActive: boolean): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.securePUT<unknown, UpdateDevicePayload>(`/tenants/${tenantId}/devices/${deviceId}`, { IsActive: isActive });

    expect(response.status(), `set device active=${String(isActive)}: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /** Soft-delete a device; asserts nothing (cleanup tolerates a device that is already gone). */
  async attemptDeleteDevice(tenantId: number, deviceId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/tenants/${tenantId}/devices/${deviceId}`);
  }

  // ============================================
  // Internals shared by the ATCs
  // ============================================

  /** First line of an error, for a failure list (no stack, no call log). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** The device id an answer created, or 0. */
  private createdId(body: ApiEnvelope<CreatedEntityData>): number {
    const id = body.Data?.Id;
    return typeof id === 'number' && id > 0 ? id : 0;
  }

  /** Delete generated devices, tolerating the ones already gone (404). Returns one line per failure. */
  private async cleanupCreated(tenantId: number, deviceIds: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of deviceIds) {
      try {
        const [response] = await this.attemptDeleteDevice(tenantId, id);
        if (response.status() !== 200 && response.status() !== 404) {
          failures.push(`delete device #${id}: HTTP ${response.status()}`);
        }
      }
      catch (error) {
        failures.push(`delete device #${id}: ${this.firstLine(error)}`);
      }
    }
    return failures;
  }

  /** Create a device and record its id for cleanup BEFORE judging the answer. */
  private async createTracked(tenantId: number, payload: object, createdIds: number[]): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const answer = await this.attemptCreateDevice(tenantId, payload);
    const id = this.createdId(answer[1]);
    if (id > 0) {
      createdIds.push(id);
    }
    return answer;
  }

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

  /**
   * Shared body of the DIS input cases. Own crypto session, ONE positive Administrator login. The positive
   * control first (a valid device on a fresh terminal), then every row. A `reject` row must answer its status
   * (400 unless set), `Ok` false, its code (`VALIDATION_ERROR` unless set) and carry its message, and create
   * nothing: the tenant's device total must equal the base plus what was created so far. An `accept` row must
   * answer 200. A reject row the product wrongly accepts is tracked and reported, and the loop goes on (each row
   * has its own terminal, so one accepted row hides nothing). Everything created is deleted before the session closes.
   */
  private async runDeviceInput(args: { scope: DeviceScope, rows: DeviceInputRow[], what: string, extra?: (createdIds: number[], failures: string[]) => Promise<void> }): Promise<void> {
    const { tenantId } = args.scope;
    const createdIds: number[] = [];
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      const [, base] = await this.listDevices(tenantId, { pageSize: 1 });
      const baseTotal = base.Data?.TotalRecords ?? 0;
      const controlTerminalId = await args.scope.newTerminal();
      const control = this.data.createDevicePayload(controlTerminalId);
      const [response, body] = await this.createTracked(tenantId, control, createdIds);
      expect(response.status(), `control (valid device): ${body.CodeError ?? 'no error code'} ${JSON.stringify(body.ValidationErrors ?? [])}`).toBe(200);

      for (const row of args.rows) {
        try {
          const payload = await row.build({ controlTerminalId, control });
          const [rowResponse, rowBody] = await this.createTracked(tenantId, payload, createdIds);
          const status = rowResponse.status();
          const id = this.createdId(rowBody);
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
          const [, list] = await this.listDevices(tenantId, { pageSize: 1 });
          if ((list.Data?.TotalRecords ?? 0) !== baseTotal + createdIds.length) {
            failures.push(`${row.label}: the device total changed after the rejected create`);
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

  /** A valid device payload on a fresh terminal, with overrides. */
  private async deviceOnNewTerminal(scope: DeviceScope, overrides: Partial<CreateDevicePayload> = {}): Promise<object> {
    return { ...this.data.createDevicePayload(await scope.newTerminal()), ...overrides };
  }

  // ============================================
  // Test Cases (ATCs): input validation (DIS-003 .. DIS-008)
  // ============================================

  /**
   * DIS-003: a device needs a valid terminal. Control first; then the terminal omitted and 0 (400
   * `VALIDATION_ERROR` naming the terminal), a nonexistent terminal (404 `TERMINAL_NOT_FOUND`) and an inactive
   * terminal (400 `TERMINAL_INACTIVE`). Nothing is created.
   */
  @atc('DIS-003')
  async rejectMissingTerminal(args: { scope: DeviceScope, inactiveTerminal: () => Promise<number> }): Promise<void> {
    const { scope } = args;
    const withoutTerminal = async (): Promise<object> => {
      const payload: Record<string, unknown> = { ...(await this.deviceOnNewTerminal(scope)) };
      delete payload.TerminalId;
      return payload;
    };
    const rows: DeviceInputRow[] = [
      { label: 'terminal omitted', build: withoutTerminal, outcome: 'reject', message: /terminal v.lida/i },
      { label: 'terminal 0', build: async () => this.deviceOnNewTerminal(scope, { TerminalId: 0 }), outcome: 'reject', message: /terminal v.lida/i },
      { label: 'terminal does not exist', build: async () => this.deviceOnNewTerminal(scope, { TerminalId: 999999999 }), outcome: 'reject', status: 404, code: 'TERMINAL_NOT_FOUND', message: /terminal/i },
      { label: 'terminal inactive', build: async () => this.deviceOnNewTerminal(scope, { TerminalId: await args.inactiveTerminal() }), outcome: 'reject', code: 'TERMINAL_INACTIVE', message: /inactiva/i },
    ];
    await this.runDeviceInput({ scope, rows, what: 'device terminal' });
  }

  /**
   * DIS-004: invalid device codes are refused. Control first, then empty, 51 characters and a code with a space,
   * `@`, a dot, a slash or an n with tilde (each 400 `VALIDATION_ERROR`, nothing created) and, LAST, a code of
   * exactly 50 characters accepted.
   */
  @atc('DIS-004')
  async rejectInvalidDeviceCodes(scope: DeviceScope): Promise<void> {
    const rows: DeviceInputRow[] = this.data.createInvalidDeviceCodes().map(row => ({
      label: `code (${row.label})`,
      build: async () => this.deviceOnNewTerminal(scope, { Code: row.value }),
      outcome: 'reject' as const,
      message: row.label === 'empty' ? /c.digo.*requerido/i : row.label === '51 characters' ? LENGTH_MESSAGE : CODE_FORMAT_MESSAGE,
    }));
    rows.push({ label: 'code (50 characters, limit)', build: async () => this.deviceOnNewTerminal(scope, { Code: this.data.createDeviceCodeOfLength(50) }), outcome: 'accept', message: LENGTH_MESSAGE });
    await this.runDeviceInput({ scope, rows, what: 'device code' });
  }

  /** DIS-005: a second device with the code of an existing one (on another terminal) is refused with 400 `DEVICE_CODE_DUPLICATE`. */
  @atc('DIS-005')
  async rejectDuplicateDeviceCode(scope: DeviceScope): Promise<void> {
    const rows: DeviceInputRow[] = [
      { label: 'code repeated', build: async context => this.deviceOnNewTerminal(scope, { Code: context.control.Code }), outcome: 'reject', code: 'DEVICE_CODE_DUPLICATE', message: /c.digo/i },
    ];
    await this.runDeviceInput({ scope, rows, what: 'duplicate device code' });
  }

  /**
   * DIS-006: invalid serial numbers are refused. Control first, then empty and 101 characters (each 400
   * `VALIDATION_ERROR`, nothing created) and, LAST, a serial of exactly 100 characters accepted.
   */
  @atc('DIS-006')
  async rejectInvalidSerials(scope: DeviceScope): Promise<void> {
    const rows: DeviceInputRow[] = [
      { label: 'serial (empty)', build: async () => this.deviceOnNewTerminal(scope, { SerialNumber: '' }), outcome: 'reject', message: /serie.*requerido/i },
      { label: 'serial (101 characters)', build: async () => this.deviceOnNewTerminal(scope, { SerialNumber: this.data.createSerialOfLength(101) }), outcome: 'reject', message: LENGTH_MESSAGE },
      { label: 'serial (100 characters, limit)', build: async () => this.deviceOnNewTerminal(scope, { SerialNumber: this.data.createSerialOfLength(100) }), outcome: 'accept', message: LENGTH_MESSAGE },
    ];
    await this.runDeviceInput({ scope, rows, what: 'device serial' });
  }

  /**
   * DIS-007: the serial is unique in the WHOLE system and a terminal admits one device. A second device with the
   * serial of the control (also in lower case, and the serial of a device that lives in ANOTHER tenant) is 400
   * `DEVICE_SERIAL_DUPLICATE`; a second device on the control's terminal is 400 `TERMINAL_DEVICE_DUPLICATE`.
   */
  @atc('DIS-007')
  async enforceUniqueSerialAndOneDevicePerTerminal(args: { scope: DeviceScope, other: DeviceInputExtras['other'] }): Promise<void> {
    const { scope, other } = args;
    const foreign: CreateDevicePayload = this.data.createDevicePayload(0);
    const foreignCreated: number[] = [];
    const rows: DeviceInputRow[] = [
      { label: 'serial repeated', build: async context => this.deviceOnNewTerminal(scope, { SerialNumber: context.control.SerialNumber }), outcome: 'reject', code: 'DEVICE_SERIAL_DUPLICATE', message: /serie/i },
      { label: 'serial repeated in lower case', build: async context => this.deviceOnNewTerminal(scope, { SerialNumber: context.control.SerialNumber.toLowerCase() }), outcome: 'reject', code: 'DEVICE_SERIAL_DUPLICATE', message: /serie/i },
      {
        label: 'serial of a device in another tenant',
        build: async () => {
          const otherTerminalId = await other.newTerminal();
          const [otherResponse, otherBody] = await this.createTracked(other.tenantId, { ...foreign, TerminalId: otherTerminalId }, foreignCreated);
          if (otherResponse.status() !== 200) {
            throw new Error(`could not create the device in the other tenant: HTTP ${otherResponse.status()} ${otherBody.CodeError ?? 'no error code'}`);
          }
          return this.deviceOnNewTerminal(scope, { SerialNumber: foreign.SerialNumber });
        },
        outcome: 'reject',
        code: 'DEVICE_SERIAL_DUPLICATE',
        message: /serie/i,
      },
      { label: 'second device on the same terminal', build: async context => ({ ...this.data.createDevicePayload(context.controlTerminalId) }), outcome: 'reject', code: 'TERMINAL_DEVICE_DUPLICATE', message: /terminal ya tiene/i },
    ];
    await this.runDeviceInput({
      scope,
      rows,
      what: 'device uniqueness',
      extra: async (_createdIds, failures) => {
        failures.push(...await this.cleanupCreated(other.tenantId, foreignCreated));
      },
    });
  }

  /**
   * DIS-008: the device name has a limit of 150. Control first, then a name of 151 characters (400
   * `VALIDATION_ERROR`, nothing created) and, LAST, a name of exactly 150 accepted. The backend has no validator
   * rule for the name, so the 151 row is expected to fail today.
   */
  @atc('DIS-008')
  async rejectOversizedDeviceName(scope: DeviceScope): Promise<void> {
    const rows: DeviceInputRow[] = [
      { label: 'name (151 characters)', build: async () => this.deviceOnNewTerminal(scope, { DeviceName: this.data.createDeviceNameOfLength(151) }), outcome: 'reject', message: LENGTH_MESSAGE },
      { label: 'name (150 characters, limit)', build: async () => this.deviceOnNewTerminal(scope, { DeviceName: this.data.createDeviceNameOfLength(150) }), outcome: 'accept', message: LENGTH_MESSAGE },
    ];
    await this.runDeviceInput({ scope, rows, what: 'device name' });
  }

  // ============================================
  // Test Cases (ATCs): catalog (DIS-001, 002, 009)
  // ============================================

  /**
   * DIS-001: list devices with their terminal and branch. Two generated devices on two terminals of two branches
   * share a token; each row shows its terminal name and branch name, pages of 1 give 2 pages, the search finds
   * exactly the expected device by code, by serial (lower case), by terminal name and by branch code, and a search
   * without a match is empty.
   */
  @atc('DIS-001')
  async listDevicesWithTerminalAndBranch(args: { tenantId: number, terminals: [DeviceTerminalRef, DeviceTerminalRef] }): Promise<void> {
    const { tenantId } = args;
    const token = this.data.createBranchCodeOfLength(9).slice(3);
    const specs = args.terminals.map((terminal, index) => ({
      terminal,
      payload: { ...this.data.createDevicePayload(terminal.id), Code: `QAX-${token}-${index === 0 ? 'A' : 'B'}` },
      id: 0,
    }));
    await this.runCatalogCase({
      what: 'device list',
      tenantId,
      body: async (ids, failures) => {
        for (const spec of specs) {
          const [response, body] = await this.createTracked(tenantId, spec.payload, ids);
          spec.id = this.createdId(body);
          verify(failures, response.status() === 200 && spec.id > 0, `create ${spec.payload.Code}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        }
        const [alfa, beta] = specs;
        if (specs.some(spec => spec.id === 0)) {
          return;
        }
        const [firstResponse, first] = await this.listDevices(tenantId, { searchTerm: token, page: 1, pageSize: 1 });
        const [secondResponse, second] = await this.listDevices(tenantId, { searchTerm: token, page: 2, pageSize: 1 });
        const pagedIds = [...(first.Data?.Data ?? []), ...(second.Data?.Data ?? [])].map(row => row.Id).sort((a, b) => a - b);
        verify(failures, firstResponse.status() === 200 && secondResponse.status() === 200 && first.Data?.Data.length === 1 && second.Data?.Data.length === 1 && first.Data.TotalRecords === 2 && pagedIds.join() === [alfa.id, beta.id].sort((a, b) => a - b).join(), `pages of 1: HTTP ${firstResponse.status()}/${secondResponse.status()}, ${String(first.Data?.Data.length)}+${String(second.Data?.Data.length)} rows, total ${String(first.Data?.TotalRecords)} (expected 1+1 rows covering both devices, total 2)`);

        const searches: Array<{ label: string, term: string, expected: number[] }> = [
          { label: 'by code', term: alfa.payload.Code, expected: [alfa.id] },
          { label: 'by serial (lower case)', term: beta.payload.SerialNumber.toLowerCase(), expected: [beta.id] },
          { label: 'by terminal name', term: alfa.terminal.name, expected: [alfa.id] },
          { label: 'by branch code', term: beta.terminal.branchCode, expected: [beta.id] },
          { label: 'without a match', term: `zz${token}`, expected: [] },
        ];
        for (const search of searches) {
          const [response, body] = await this.listDevices(tenantId, { searchTerm: search.term, pageSize: 10 });
          const found = body.Data?.Data.map(row => row.Id) ?? [];
          verify(failures, response.status() === 200 && found.join() === search.expected.join() && body.Data?.TotalRecords === search.expected.length, `search ${search.label}: HTTP ${response.status()}, rows [${found.join()}] total ${String(body.Data?.TotalRecords)} (expected [${search.expected.join()}])`);
        }

        const [allResponse, all] = await this.listDevices(tenantId, { searchTerm: token, pageSize: 10 });
        const rows = new Map(all.Data?.Data.map(row => [row.Id, row]));
        for (const spec of specs) {
          const row = rows.get(spec.id);
          verify(failures, allResponse.status() === 200 && row?.TerminalName === spec.terminal.name && row.BranchName === spec.terminal.branchName, `row of ${spec.payload.Code}: terminal "${String(row?.TerminalName)}" / branch "${String(row?.BranchName)}" (expected the names of its terminal and branch)`);
        }
      },
    });
  }

  /**
   * DIS-002: create a device with terminal, code and serial. The answer is 200, `Ok`, an id; the device is active,
   * belongs to the tenant and the terminal (terminal and branch names shown), keeps code and name as sent, stores the
   * serial in upper case and has `CreatedBy`. It is found by `GET {id}` and by the code search (exactly 1 match).
   */
  @atc('DIS-002')
  async createDeviceWithTerminalCodeAndSerial(args: { tenantId: number, terminal: DeviceTerminalRef }): Promise<void> {
    const { tenantId, terminal } = args;
    const sent = { ...this.data.createDevicePayload(terminal.id), SerialNumber: `QAXsn${this.data.createSerialOfLength(12).slice(5)}` };
    await this.runCatalogCase({
      what: 'device create',
      tenantId,
      body: async (ids, failures) => {
        const [response, body] = await this.createTracked(tenantId, sent, ids);
        verify(failures, response.status() === 200 && body.Ok === true && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        if (ids.length !== 1) {
          return;
        }
        const [readResponse, read] = await this.getDevice(tenantId, ids[0]);
        const device = read.Data;
        verify(failures, readResponse.status() === 200 && device !== undefined, `read by id: HTTP ${readResponse.status()}`);
        if (device) {
          verify(failures, device.IsActive === true, 'read: the device is not active');
          verify(failures, device.TenantId === tenantId && device.TerminalId === terminal.id, 'read: tenant or terminal differ');
          verify(failures, device.TerminalName === terminal.name && device.BranchName === terminal.branchName, 'read: terminal or branch name differ');
          verify(failures, device.Code === sent.Code && device.DeviceName === sent.DeviceName, 'read: code or name differ from what was sent');
          verify(failures, device.SerialNumber === sent.SerialNumber.toUpperCase(), 'read: the serial is not stored in upper case');
          verify(failures, typeof device.CreatedBy === 'string' && device.CreatedBy !== '', 'read: CreatedBy is not set');
        }
        const [listResponse, list] = await this.listDevices(tenantId, { searchTerm: sent.Code, pageSize: 10 });
        verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 1 && list.Data.Data[0]?.Id === ids[0], `search by code: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 1 and the created device)`);
      },
    });
  }

  /**
   * DIS-009: edit, deactivate, reactivate and delete. The edit of code, name and serial answers 200 and the
   * read-back shows the new values (serial in upper case), `UpdatedAt` later than `CreatedAt` and `UpdatedBy`;
   * moving it to a terminal that already has a device is 400 `TERMINAL_DEVICE_DUPLICATE`, to a free one is 200;
   * `IsActive` false then true answer 200 and read back; the delete answers 200, the device is absent from the
   * list, `GET {id}` is 404 `DEVICE_NOT_FOUND` and its terminal accepts a new device. (The rejection of device
   * queries while inactive needs the tenant API client token and is left to INT.)
   */
  @atc('DIS-009')
  async editDeactivateAndDeleteDevice(args: { tenantId: number, terminals: [DeviceTerminalRef, DeviceTerminalRef, DeviceTerminalRef] }): Promise<void> {
    const { tenantId } = args;
    const [home, free, taken] = args.terminals;
    const original = this.data.createDevicePayload(home.id);
    const blocker = this.data.createDevicePayload(taken.id);
    const edit: UpdateDevicePayload = {
      Code: this.data.createDeviceCodeOfLength(20),
      DeviceName: 'QAX captor editado',
      SerialNumber: `qaxsn${this.data.createSerialOfLength(15).slice(5).toLowerCase()}`,
    };
    await this.runCatalogCase({
      what: 'device lifecycle',
      tenantId,
      body: async (ids, failures) => {
        const [response, body] = await this.createTracked(tenantId, original, ids);
        await this.createTracked(tenantId, blocker, ids);
        verify(failures, response.status() === 200 && ids.length === 2, `setup: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}, ${ids.length} of 2 devices created`);
        if (ids.length !== 2) {
          return;
        }
        const deviceId = ids[0];

        const [editResponse, edited] = await this.attemptUpdateDevice(tenantId, deviceId, edit);
        verify(failures, editResponse.status() === 200 && edited.Ok === true, `edit: HTTP ${editResponse.status()} ${edited.CodeError ?? 'no error code'}`);
        const [readResponse, read] = await this.getDevice(tenantId, deviceId);
        const device = read.Data;
        verify(failures, readResponse.status() === 200 && device !== undefined, `read after edit: HTTP ${readResponse.status()}`);
        if (device) {
          verify(failures, device.Code === edit.Code && device.DeviceName === edit.DeviceName, 'read after edit: code or name are not the new values');
          verify(failures, device.SerialNumber === edit.SerialNumber?.toUpperCase(), 'read after edit: the serial is not the new value in upper case');
          verify(failures, device.UpdatedAt != null && Date.parse(device.UpdatedAt) > Date.parse(device.CreatedAt), 'read after edit: UpdatedAt is not later than CreatedAt');
          verify(failures, typeof device.UpdatedBy === 'string' && device.UpdatedBy !== '', 'read after edit: UpdatedBy is not set');
        }

        const [clashResponse, clash] = await this.attemptUpdateDevice(tenantId, deviceId, { TerminalId: taken.id });
        verify(failures, clashResponse.status() === 400 && clash.CodeError === 'TERMINAL_DEVICE_DUPLICATE', `move to a terminal with a device: HTTP ${clashResponse.status()} CodeError=${String(clash.CodeError)} (expected 400, TERMINAL_DEVICE_DUPLICATE)`);
        const [moveResponse, moved] = await this.attemptUpdateDevice(tenantId, deviceId, { TerminalId: free.id });
        verify(failures, moveResponse.status() === 200 && moved.Ok === true, `move to a free terminal: HTTP ${moveResponse.status()} ${moved.CodeError ?? 'no error code'}`);
        const [movedReadResponse, movedRead] = await this.getDevice(tenantId, deviceId);
        verify(failures, movedReadResponse.status() === 200 && movedRead.Data?.TerminalId === free.id && movedRead.Data.TerminalName === free.name, 'after the move, the device is not on the free terminal');

        for (const active of [false, true]) {
          const [toggleResponse, toggled] = await this.attemptUpdateDevice(tenantId, deviceId, { IsActive: active });
          verify(failures, toggleResponse.status() === 200 && toggled.Ok === true, `set active=${String(active)}: HTTP ${toggleResponse.status()} ${toggled.CodeError ?? 'no error code'}`);
          const [stateResponse, state] = await this.getDevice(tenantId, deviceId);
          verify(failures, stateResponse.status() === 200 && state.Data?.IsActive === active, `after active=${String(active)}, the device reads IsActive=${String(state.Data?.IsActive)}`);
        }

        const [deleteResponse, deleted] = await this.attemptDeleteDevice(tenantId, deviceId);
        verify(failures, deleteResponse.status() === 200 && deleted.Ok === true, `delete: HTTP ${deleteResponse.status()} ${deleted.CodeError ?? 'no error code'}`);
        const [listResponse, list] = await this.listDevices(tenantId, { searchTerm: edit.Code, pageSize: 10 });
        verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 0, `after the delete, the code search: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 0)`);
        const [goneResponse, gone] = await this.getDevice(tenantId, deviceId);
        verify(failures, goneResponse.status() === 404 && gone.CodeError === 'DEVICE_NOT_FOUND', `read after the delete: HTTP ${goneResponse.status()} CodeError=${String(gone.CodeError)} (expected 404, DEVICE_NOT_FOUND)`);
        const [againResponse, again] = await this.createTracked(tenantId, this.data.createDevicePayload(free.id), ids);
        verify(failures, againResponse.status() === 200 && again.Ok === true, `new device on the freed terminal: HTTP ${againResponse.status()} ${again.CodeError ?? 'no error code'}`);
      },
    });
  }

  // ============================================
  // Test Cases (ATCs): CSV import (DIS-010)
  // ============================================

  /**
   * DIS-010: CSV import, as SUC-011 plus the device rules. A valid file reports Total, Exitosos and no errors. A
   * mixed file (empty code, empty serial, unknown terminal, terminal that already has a device, repeated code,
   * repeated serial, and a code with a space) reports one `Errores` entry per bad row with its `Fila` and imports
   * the good rows (the code with a space must be refused like the form does: today it is imported, HAL-25). An
   * empty file answers 400 `CSV_FILE_REQUIRED`, a `.txt` file 400 `CSV_INVALID_EXTENSION`, a file without the
   * required headers 400 `CSV_INVALID_FORMAT`, and none creates a device. Every imported device is deleted at the end.
   */
  @atc('DIS-010')
  async importDevicesFromCsv(args: { tenantId: number, terminals: DeviceTerminalRef[] }): Promise<void> {
    const { tenantId } = args;
    const token = this.data.createBranchCodeOfLength(9).slice(3);
    const t = args.terminals;
    const row = (n: number, terminal: string, overrides: { code?: string, serial?: string } = {}) => ({
      code: overrides.code ?? `QAX-${token}-${n}`,
      serial: overrides.serial ?? `QAXSN${token}${n}`,
      name: `QAX captor ${n}`,
      terminalName: terminal,
    });
    const valid = [row(1, t[0].name), row(2, t[1].name), row(3, t[2].name)];
    const mixed = [
      row(4, t[3].name),
      row(5, t[4].name, { code: '' }),
      row(6, t[4].name, { serial: '' }),
      row(7, `NOEXISTE${token}`),
      row(8, t[0].name),
      row(9, t[4].name, { code: valid[0].code }),
      row(10, t[4].name, { serial: valid[0].serial }),
      row(11, t[5].name, { code: `QAX ${token} 11` }),
      row(12, t[6].name),
    ];
    const expectedErrors = [
      { Fila: 3, Campo: 'Code' },
      { Fila: 4, Campo: 'SerialNumber' },
      { Fila: 5, Campo: 'TerminalName' },
      { Fila: 6, Campo: 'TerminalName' },
      { Fila: 7, Campo: 'Code' },
      { Fila: 8, Campo: 'SerialNumber' },
      { Fila: 9, Campo: 'Code' },
    ];
    await this.runCatalogCase({
      what: 'device CSV import',
      tenantId,
      body: async (ids, failures) => {
        try {
          const [validResponse, validBody] = await this.importCsv(tenantId, { name: 'captores.csv', content: this.data.createDeviceCsv(valid) });
          const validResult = validBody.Data;
          verify(failures, validResponse.status() === 200 && validResult?.Total === 3 && validResult.Exitosos === 3 && validResult.Fallidos === 0 && validResult.Errores.length === 0, `valid file: HTTP ${validResponse.status()}, ${JSON.stringify(validResult)} (expected 3 total, 3 imported, 0 failed, no errors)`);

          const [mixedResponse, mixedBody] = await this.importCsv(tenantId, { name: 'captores-mixto.csv', content: this.data.createDeviceCsv(mixed) });
          const mixedResult = mixedBody.Data;
          verify(failures, mixedResponse.status() === 200 && mixedResult?.Total === 9 && mixedResult.Exitosos === 2 && mixedResult.Fallidos === 7, `mixed file: HTTP ${mixedResponse.status()}, total ${String(mixedResult?.Total)} imported ${String(mixedResult?.Exitosos)} failed ${String(mixedResult?.Fallidos)} (expected 9, 2, 7)`);
          for (const expected of expectedErrors) {
            const found = mixedResult?.Errores.find(error => error.Fila === expected.Fila);
            verify(failures, found !== undefined && found.Campo === expected.Campo && found.Mensaje !== '', `mixed file: no error on row ${expected.Fila} for ${expected.Campo} (got ${found ? found.Campo : 'none'})`);
          }
          verify(failures, mixedResult?.Errores.length === expectedErrors.length, `mixed file: ${String(mixedResult?.Errores.length)} error entries (expected ${expectedErrors.length}, one per bad row)`);

          const [beforeResponse, before] = await this.listDevices(tenantId, { searchTerm: token, pageSize: 50 });
          const refusals = [
            { label: 'empty file', file: { name: 'vacio.csv', content: '' }, code: 'CSV_FILE_REQUIRED' },
            { label: 'non-CSV extension', file: { name: 'captores.txt', content: this.data.createDeviceCsv([row(13, t[7].name)]) }, code: 'CSV_INVALID_EXTENSION' },
            { label: 'missing headers', file: { name: 'sin-encabezados.csv', content: `Codigo,Nombre\nQAX-${token}-14,${t[7].name}` }, code: 'CSV_INVALID_FORMAT' },
          ];
          for (const refusal of refusals) {
            const [response, body] = await this.importCsv(tenantId, refusal.file);
            verify(failures, response.status() === 400 && body.CodeError === refusal.code, `${refusal.label}: HTTP ${response.status()} CodeError=${String(body.CodeError)} (expected 400, ${refusal.code})`);
          }
          const [afterResponse, after] = await this.listDevices(tenantId, { searchTerm: token, pageSize: 50 });
          verify(failures, beforeResponse.status() === 200 && afterResponse.status() === 200 && after.Data?.TotalRecords === before.Data?.TotalRecords, `after the refused files, the token search total went from ${String(before.Data?.TotalRecords)} to ${String(after.Data?.TotalRecords)} (expected no change)`);
        }
        finally {
          for (const term of [token, `QAX ${token}`]) {
            const [, all] = await this.listDevices(tenantId, { searchTerm: term, pageSize: 50 });
            ids.push(...(all.Data?.Data.map(device => device.Id) ?? []));
          }
        }
      },
    });
  }
}
