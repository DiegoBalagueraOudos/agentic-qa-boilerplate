/**
 * KATA Architecture - Layer 3: Branches API Component (SUC cases)
 *
 * Branches ("sedes") of a tenant. This step-0 version holds the data helpers only; the SUC ATCs
 * are added in their own steps. Helpers named `attempt*` assert nothing and return the raw
 * answer (the rejected-input cases read the status and the error code themselves).
 *
 * Endpoints (relative to config.apiUrl, encrypted JSON bodies; import-csv is multipart and NOT encrypted):
 * - GET    /tenants/{tenantId}/branches                 - list (Page, PageSize, SearchTerm, IsActive)
 * - GET    /tenants/{tenantId}/branches/{id}            - read one
 * - POST   /tenants/{tenantId}/branches                 - create
 * - PUT    /tenants/{tenantId}/branches/{id}            - update (the code never changes)
 * - DELETE /tenants/{tenantId}/branches/{id}            - soft delete (blocked by active children)
 * - POST   /tenants/{tenantId}/branches/import-csv      - CSV import (headers CodSede, NombreSede)
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, CreatedEntityData } from '@schemas/auth.types';
import type { BranchData, BulkImportResultData, CreateBranchPayload, UpdateBranchPayload } from '@schemas/resources.types';
import type { PagedData } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { expect, test } from '@playwright/test';
import { atc, step } from '@utils/decorators';

/** List query: names follow the backend's `PaginationParams`. */
export interface BranchListQuery {
  page?: number
  pageSize?: number
  searchTerm?: string
  isActive?: boolean
}

/**
 * One row of a branch input case. `reject` rows must answer 400 `VALIDATION_ERROR` naming the field and create nothing;
 * `accept` rows (the documented boundaries) must answer 200 and are deleted afterwards.
 */
interface BranchInputRow {
  label: string
  payload: CreateBranchPayload
  outcome: 'reject' | 'accept'
  /** Validation message (a fragment) the refusal must carry; the backend does not name the field in its length messages. */
  message: RegExp
}

/** The backend's length refusal ("Maximo N caracteres"). */
const LENGTH_MESSAGE = /M.ximo \d+ caracteres/i;

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

/** One CSV file to upload. */
export interface CsvFile {
  name: string
  content: string
}

export class BranchesApi extends SecureApi {
  // ============================================
  // Helpers (no ATC)
  // ============================================

  private listEndpoint(tenantId: number, query: BranchListQuery = {}): string {
    const params = new URLSearchParams();
    if (query.page !== undefined) { params.set('Page', String(query.page)); }
    if (query.pageSize !== undefined) { params.set('PageSize', String(query.pageSize)); }
    if (query.searchTerm !== undefined) { params.set('SearchTerm', query.searchTerm); }
    if (query.isActive !== undefined) { params.set('IsActive', String(query.isActive)); }
    const text = params.toString();
    return `/tenants/${tenantId}/branches${text === '' ? '' : `?${text}`}`;
  }

  /** Create a valid branch. Fixed assertions: 200, `Ok`, an id in `Data`. */
  @step
  async createBranch(tenantId: number, payload: CreateBranchPayload): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const [response, body] = await this.securePOST<CreatedEntityData, CreateBranchPayload>(`/tenants/${tenantId}/branches`, payload);

    expect(response.status(), `create branch: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  /** Create a branch; asserts nothing (the rejected-input cases read the status and the code). */
  async attemptCreateBranch(tenantId: number, payload: CreateBranchPayload): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    return this.securePOST<CreatedEntityData, CreateBranchPayload>(`/tenants/${tenantId}/branches`, payload);
  }

  /** List a tenant's branches; asserts nothing. */
  async listBranches(tenantId: number, query: BranchListQuery = {}): Promise<[APIResponse, ApiEnvelope<PagedData<BranchData>>]> {
    return this.secureGET<PagedData<BranchData>>(this.listEndpoint(tenantId, query));
  }

  /** Read one branch; asserts nothing. */
  async getBranch(tenantId: number, branchId: number): Promise<[APIResponse, ApiEnvelope<BranchData>]> {
    return this.secureGET<BranchData>(`/tenants/${tenantId}/branches/${branchId}`);
  }

  /** Update a branch; asserts nothing. */
  async attemptUpdateBranch(tenantId: number, branchId: number, payload: UpdateBranchPayload): Promise<[APIResponse, ApiEnvelope<BranchData>]> {
    return this.securePUT<BranchData, UpdateBranchPayload>(`/tenants/${tenantId}/branches/${branchId}`, payload);
  }

  /** Soft-delete a branch; asserts nothing (cleanup tolerates a branch that is already gone). */
  async attemptDeleteBranch(tenantId: number, branchId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/tenants/${tenantId}/branches/${branchId}`);
  }

  /** Upload one CSV file (multipart, not encrypted); asserts nothing. */
  async importCsv(tenantId: number, file: CsvFile): Promise<[APIResponse, ApiEnvelope<BulkImportResultData>]> {
    return this.secureMultipartPOST<BulkImportResultData>(`/tenants/${tenantId}/branches/import-csv`, {
      name: file.name,
      mimeType: 'text/csv',
      buffer: Buffer.from(file.content, 'utf8'),
    });
  }

  // ============================================
  // Test Cases (ATCs)
  // ============================================

  /** First line of an error, for a failure list (no stack, no call log). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** Delete generated branches, tolerating the ones already gone (404). Returns one line per failure. */
  private async cleanupCreated(tenantId: number, branchIds: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of branchIds) {
      try {
        const [response] = await this.attemptDeleteBranch(tenantId, id);
        if (response.status() !== 200 && response.status() !== 404) {
          failures.push(`delete branch #${id}: HTTP ${response.status()}`);
        }
      }
      catch (error) {
        failures.push(`delete branch #${id}: ${this.firstLine(error)}`);
      }
    }
    return failures;
  }

  /**
   * Shared body of SUC-003, 004 and 005. Own crypto session, ONE positive Administrator login.
   * The positive control first (a valid branch), then the rows in order. A reject row the product
   * wrongly accepts is tracked, reported and ends the loop (no more creates once it accepts one);
   * an accept row it refuses is reported and the loop goes on. Everything created is deleted before
   * the session closes; every failure is thrown once, naming the row and the status only.
   */
  private async runBranchInput(args: { tenantId: number, rows: BranchInputRow[], what: string }): Promise<void> {
    const { tenantId } = args;
    const createdIds: number[] = [];
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      const [response, body] = await this.attemptCreateBranch(tenantId, this.data.createBranchPayload());
      if (typeof body.Data?.Id === 'number') {
        createdIds.push(body.Data.Id);
      }
      expect(response.status(), `control (valid branch): ${body.CodeError ?? 'no error code'}`).toBe(200);
      expect(body.Ok).toBe(true);

      for (const [index, row] of args.rows.entries()) {
        try {
          const [rowResponse, rowBody] = await this.attemptCreateBranch(tenantId, row.payload);
          const status = rowResponse.status();
          const createdId = rowBody.Data?.Id;
          const created = typeof createdId === 'number' && createdId > 0;
          if (created) {
            createdIds.push(createdId);
          }
          if (row.outcome === 'accept') {
            if (status !== 200 || rowBody.Ok !== true || !created) {
              failures.push(`${row.label}: expected ACCEPTED (200), got HTTP ${status} ${rowBody.CodeError ?? 'no error code'}`);
            }
            continue;
          }
          if (created) {
            failures.push(`${row.label}: the product ACCEPTED the create (HTTP ${status}, ${rowBody.CodeError ?? 'no error code'}); stopped after row ${index + 1} of ${args.rows.length}`);
            break;
          }
          const text = `${rowBody.Error ?? ''} ${JSON.stringify(rowBody.ValidationErrors ?? [])}`;
          if (status !== 400 || rowBody.Ok !== false || rowBody.CodeError !== 'VALIDATION_ERROR') {
            failures.push(`${row.label}: HTTP ${status} Ok=${String(rowBody.Ok)} CodeError=${String(rowBody.CodeError)} (expected 400, false, VALIDATION_ERROR)`);
          }
          else if (!row.message.test(text)) {
            failures.push(`${row.label}: HTTP ${status} VALIDATION_ERROR, the validation message ${row.message} is missing`);
          }
          const code = row.payload.BranchCode.trim();
          if (code !== '') {
            const [, list] = await this.listBranches(tenantId, { searchTerm: code, pageSize: 1 });
            if ((list.Data?.TotalRecords ?? 0) > 0) {
              failures.push(`${row.label}: a branch with that code exists after the rejected create`);
            }
          }
        }
        catch (error) {
          failures.push(`row ${row.label}: ${this.firstLine(error)}`);
        }
      }
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

  /**
   * SUC-003: invalid branch codes are refused. Positive control first, then empty, whitespace only and
   * 51 characters (each 400 `VALIDATION_ERROR` naming the code, nothing created) and, LAST, the documented
   * boundary: a 50-character code must be ACCEPTED (owner decision; the backend limit is 40, so this row fails today).
   */
  @atc('SUC-003')
  async rejectInvalidBranchCodes(tenantId: number): Promise<void> {
    const rows: BranchInputRow[] = this.data.createInvalidBranchCodes().map(row => ({
      label: `code (${row.label})`,
      payload: this.data.createBranchPayload({ BranchCode: row.value }),
      outcome: 'reject',
      message: row.label.includes('characters') ? LENGTH_MESSAGE : /c.digo.*requerido/i,
    }));
    rows.push({
      label: 'code (50 characters, documented limit)',
      payload: this.data.createBranchPayload({ BranchCode: this.data.createBranchCodeOfLength(50) }),
      outcome: 'accept',
      message: LENGTH_MESSAGE,
    });
    await this.runBranchInput({ tenantId, rows, what: 'branch code' });
  }

  /**
   * SUC-004: invalid branch names are refused. Positive control first, then empty, whitespace only and
   * 101 characters (each 400 `VALIDATION_ERROR` naming the name, nothing created) and, LAST, a name of exactly 100 accepted.
   */
  @atc('SUC-004')
  async rejectInvalidBranchNames(tenantId: number): Promise<void> {
    const rows: BranchInputRow[] = this.data.createInvalidBranchNames().map(row => ({
      label: `name (${row.label})`,
      payload: this.data.createBranchPayload({ BranchName: row.value }),
      outcome: 'reject',
      message: row.label.includes('characters') ? LENGTH_MESSAGE : /nombre.*requerido/i,
    }));
    rows.push({
      label: 'name (100 characters, limit)',
      payload: this.data.createBranchPayload({ BranchName: this.data.createBranchNameOfLength(100) }),
      outcome: 'accept',
      message: LENGTH_MESSAGE,
    });
    await this.runBranchInput({ tenantId, rows, what: 'branch name' });
  }

  /**
   * SUC-005: an oversized address or department is refused. Positive control first, then an address of 256
   * characters, a department of 101 characters and a department outside the closed list (each 400
   * `VALIDATION_ERROR` naming the field, nothing created) and, LAST, the documented boundary: a 255-character
   * address must be ACCEPTED (owner decision; the backend limit is 100, so this row fails today).
   */
  @atc('SUC-005')
  async rejectOversizedAddressAndDepartment(tenantId: number): Promise<void> {
    const rows: BranchInputRow[] = [
      {
        label: 'address (256 characters)',
        payload: this.data.createBranchPayload({ Address: this.data.createAddressOfLength(256) }),
        outcome: 'reject',
        message: LENGTH_MESSAGE,
      },
      {
        label: 'department (101 characters)',
        payload: this.data.createBranchPayload({ Department: this.data.createAddressOfLength(101) }),
        outcome: 'reject',
        message: LENGTH_MESSAGE,
      },
      {
        label: 'department (not in the list)',
        payload: this.data.createBranchPayload({ Department: 'Narnia' }),
        outcome: 'reject',
        message: /departamento.*v.lido/i,
      },
      {
        label: 'address (255 characters, documented limit)',
        payload: this.data.createBranchPayload({ Address: this.data.createAddressOfLength(255) }),
        outcome: 'accept',
        message: LENGTH_MESSAGE,
      },
    ];
    await this.runBranchInput({ tenantId, rows, what: 'branch address and department' });
  }

  /** Create a branch for a catalog case: records the id for cleanup BEFORE judging the answer. Returns the answer. */
  private async createTracked(tenantId: number, payload: CreateBranchPayload, createdIds: number[]): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const answer = await this.attemptCreateBranch(tenantId, payload);
    const id = answer[1].Data?.Id;
    if (typeof id === 'number' && id > 0) {
      createdIds.push(id);
    }
    return answer;
  }

  /** Common frame of the catalog ATCs: one Administrator session, collected failures, cleanup, one thrown error. */
  private async runCatalogCase(args: { what: string, tenantIds: number[], body: (createdIds: Map<number, number[]>, failures: string[]) => Promise<void> }): Promise<void> {
    const createdByTenant = new Map<number, number[]>(args.tenantIds.map(id => [id, []]));
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      await args.body(createdByTenant, failures);
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      for (const [tenantId, ids] of createdByTenant) {
        failures.push(...await this.cleanupCreated(tenantId, ids));
      }
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * SUC-001: list branches with search and paging. Three generated branches share one token (distinct names,
   * departments); `addTerminal` gives the first one a terminal. Page size 2 gives 2 pages (2 + 1 rows, total 3,
   * ordered by name); the search finds exactly the expected branch by code, by name (lower case) and by
   * department; a search with no match is empty; `TerminalsCount` is 1 on the branch with the terminal and 0 elsewhere.
   * The branches are handed to `track` (the owner of the terminal removes terminal and branches in order).
   */
  @atc('SUC-001')
  async listBranchesWithSearchAndPaging(args: { tenantId: number, track: (branchId: number) => void, addTerminal: (branchId: number) => Promise<void> }): Promise<void> {
    const { tenantId } = args;
    const token = this.data.createBranchCodeOfLength(9).slice(3);
    const specs = [
      { suffix: 'Alfa', letter: 'A', department: 'Vichada' },
      { suffix: 'Beta', letter: 'B', department: 'Amazonas' },
      { suffix: 'Gamma', letter: 'C', department: this.data.validDepartment },
    ].map(spec => ({
      ...spec,
      payload: this.data.createBranchPayload({ BranchCode: `QAX${token}${spec.letter}`, BranchName: `QAX${token} ${spec.suffix}`, Department: spec.department }),
      id: 0,
    }));
    const failures: string[] = [];

    await this.openAdministratorSession();
    try {
      for (const spec of specs) {
        const [response, body] = await this.attemptCreateBranch(tenantId, spec.payload);
        spec.id = body.Data?.Id ?? 0;
        if (spec.id > 0) {
          args.track(spec.id);
        }
        verify(failures, response.status() === 200 && spec.id > 0, `create ${spec.suffix}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
      }
      const [alfa, beta, gamma] = specs;
      if (specs.every(spec => spec.id > 0)) {
        await args.addTerminal(alfa.id);

        const [firstResponse, first] = await this.listBranches(tenantId, { searchTerm: token, page: 1, pageSize: 2 });
        verify(failures, firstResponse.status() === 200 && first.Data?.Data.length === 2 && first.Data.TotalRecords === 3, `page 1 (size 2): HTTP ${firstResponse.status()}, ${String(first.Data?.Data.length)} rows, total ${String(first.Data?.TotalRecords)} (expected 2 rows, total 3)`);
        verify(failures, first.Data?.Data.map(row => row.Id).join() === `${alfa.id},${beta.id}`, 'page 1: the rows are not Alfa then Beta (order by name)');
        const [secondResponse, second] = await this.listBranches(tenantId, { searchTerm: token, page: 2, pageSize: 2 });
        verify(failures, secondResponse.status() === 200 && second.Data?.Data.length === 1 && second.Data.Data[0].Id === gamma.id && second.Data.TotalRecords === 3, `page 2 (size 2): HTTP ${secondResponse.status()}, ${String(second.Data?.Data.length)} rows (expected only Gamma, total 3)`);

        const searches: Array<{ label: string, term: string, expected: number[] }> = [
          { label: 'by code', term: alfa.payload.BranchCode.toLowerCase(), expected: [alfa.id] },
          { label: 'by name (lower case)', term: beta.payload.BranchName.toLowerCase(), expected: [beta.id] },
          { label: 'by department', term: 'vichada', expected: [alfa.id] },
          { label: 'without a match', term: `zz${token}`, expected: [] },
        ];
        for (const search of searches) {
          const [response, body] = await this.listBranches(tenantId, { searchTerm: search.term, pageSize: 10 });
          const ids = body.Data?.Data.map(row => row.Id) ?? [];
          verify(failures, response.status() === 200 && ids.join() === search.expected.join() && body.Data?.TotalRecords === search.expected.length, `search ${search.label}: HTTP ${response.status()}, rows [${ids.join()}] total ${String(body.Data?.TotalRecords)} (expected [${search.expected.join()}])`);
        }

        const [allResponse, all] = await this.listBranches(tenantId, { searchTerm: token, pageSize: 10 });
        const counts = new Map(all.Data?.Data.map(row => [row.Id, row.TerminalsCount]));
        verify(failures, allResponse.status() === 200 && counts.get(alfa.id) === 1 && counts.get(beta.id) === 0 && counts.get(gamma.id) === 0, `TerminalsCount: Alfa ${String(counts.get(alfa.id))}, Beta ${String(counts.get(beta.id))}, Gamma ${String(counts.get(gamma.id))} (expected 1, 0, 0)`);
      }
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} branch list checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * SUC-002: create a branch with a valid code and name. The answer is 200, `Ok`, an id; the branch is active,
   * belongs to the tenant, keeps code, name, address and department as sent and has `CreatedBy`. It is found by
   * `GET {id}` and by the code search (exactly 1 match). Deleted at the end.
   */
  @atc('SUC-002')
  async createBranchWithValidCodeAndName(tenantId: number): Promise<void> {
    const sent = this.data.createBranchPayload();
    await this.runCatalogCase({
      what: 'branch create',
      tenantIds: [tenantId],
      body: async (created, failures) => {
        const ids = created.get(tenantId)!;
        const [response, body] = await this.createTracked(tenantId, sent, ids);
        verify(failures, response.status() === 200 && body.Ok === true && ids.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        if (ids.length !== 1) {
          return;
        }
        const [readResponse, read] = await this.getBranch(tenantId, ids[0]);
        const branch = read.Data;
        verify(failures, readResponse.status() === 200 && branch !== undefined, `read by id: HTTP ${readResponse.status()}`);
        if (branch) {
          verify(failures, branch.IsActive === true, 'read: the branch is not active');
          verify(failures, branch.TenantId === tenantId, 'read: the branch belongs to another tenant');
          verify(failures, branch.BranchCode === sent.BranchCode && branch.BranchName === sent.BranchName, 'read: code or name differ from what was sent');
          verify(failures, branch.Address === sent.Address && branch.Department === sent.Department, 'read: address or department differ from what was sent');
          verify(failures, typeof branch.CreatedBy === 'string' && branch.CreatedBy !== '', 'read: CreatedBy is not set');
        }
        const [listResponse, list] = await this.listBranches(tenantId, { searchTerm: sent.BranchCode, pageSize: 10 });
        verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 1 && list.Data.Data[0]?.Id === ids[0], `search by code: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 1 and the created branch)`);
      },
    });
  }

  /**
   * SUC-006: a second branch with the same code (different name) answers 400 `BRANCH_CODE_DUPLICATE`; one with
   * the same name and a different code answers 400 `BRANCH_NAME_DUPLICATE`. Neither is created: the code search
   * finds only the first branch and the other code finds nothing.
   */
  @atc('SUC-006')
  async rejectDuplicateBranchCode(tenantId: number): Promise<void> {
    const first = this.data.createBranchPayload();
    const sameCode = this.data.createBranchPayload({ BranchCode: first.BranchCode });
    const sameName = this.data.createBranchPayload({ BranchName: first.BranchName });
    await this.runCatalogCase({
      what: 'duplicate branch',
      tenantIds: [tenantId],
      body: async (created, failures) => {
        const ids = created.get(tenantId)!;
        const [firstResponse, firstBody] = await this.createTracked(tenantId, first, ids);
        verify(failures, firstResponse.status() === 200 && ids.length === 1, `first create: HTTP ${firstResponse.status()} ${firstBody.CodeError ?? 'no error code'}`);
        if (ids.length !== 1) {
          return;
        }
        const rows = [
          { label: 'same code', payload: sameCode, code: 'BRANCH_CODE_DUPLICATE' },
          { label: 'same name', payload: sameName, code: 'BRANCH_NAME_DUPLICATE' },
        ];
        for (const row of rows) {
          const [response, body] = await this.createTracked(tenantId, row.payload, ids);
          verify(failures, response.status() === 400 && body.Ok === false && body.CodeError === row.code, `${row.label}: HTTP ${response.status()} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 400, false, ${row.code})`);
        }
        const [codeResponse, byCode] = await this.listBranches(tenantId, { searchTerm: first.BranchCode, pageSize: 10 });
        verify(failures, codeResponse.status() === 200 && byCode.Data?.TotalRecords === 1 && byCode.Data.Data[0]?.Id === ids[0], `after the refusals, the code search: HTTP ${codeResponse.status()}, total ${String(byCode.Data?.TotalRecords)} (expected only the first branch)`);
        const [otherResponse, byOther] = await this.listBranches(tenantId, { searchTerm: sameName.BranchCode, pageSize: 10 });
        verify(failures, otherResponse.status() === 200 && byOther.Data?.TotalRecords === 0, `after the refusals, the other code search: HTTP ${otherResponse.status()}, total ${String(byOther.Data?.TotalRecords)} (expected 0)`);
      },
    });
  }

  /**
   * SUC-007: the same branch code in two different tenants is allowed. Both creates answer 200; each branch is
   * read under its own tenant, appears only in its own tenant's list, and is not found (404) under the other tenant.
   */
  @atc('SUC-007')
  async allowSameCodeInDifferentTenants(args: { tenantId: number, secondTenantId: number }): Promise<void> {
    const { tenantId, secondTenantId } = args;
    const code = this.data.createBranchCodeOfLength(10);
    const firstPayload = this.data.createBranchPayload({ BranchCode: code });
    const secondPayload = this.data.createBranchPayload({ BranchCode: code });
    await this.runCatalogCase({
      what: 'same code in two tenants',
      tenantIds: [tenantId, secondTenantId],
      body: async (created, failures) => {
        const firstIds = created.get(tenantId)!;
        const secondIds = created.get(secondTenantId)!;
        const [firstResponse, firstBody] = await this.createTracked(tenantId, firstPayload, firstIds);
        const [secondResponse, secondBody] = await this.createTracked(secondTenantId, secondPayload, secondIds);
        verify(failures, firstResponse.status() === 200 && firstIds.length === 1, `create in the first tenant: HTTP ${firstResponse.status()} ${firstBody.CodeError ?? 'no error code'}`);
        verify(failures, secondResponse.status() === 200 && secondIds.length === 1, `create in the second tenant: HTTP ${secondResponse.status()} ${secondBody.CodeError ?? 'no error code'}`);
        if (firstIds.length !== 1 || secondIds.length !== 1) {
          return;
        }
        for (const [label, own, ownId, other, otherId] of [
          ['first', tenantId, firstIds[0], secondTenantId, secondIds[0]],
          ['second', secondTenantId, secondIds[0], tenantId, firstIds[0]],
        ] as const) {
          const [readResponse, read] = await this.getBranch(own, ownId);
          verify(failures, readResponse.status() === 200 && read.Data?.TenantId === own && read.Data.BranchCode === code, `${label} branch under its own tenant: HTTP ${readResponse.status()} or wrong tenant or code`);
          const [listResponse, list] = await this.listBranches(own, { searchTerm: code, pageSize: 10 });
          verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 1 && list.Data.Data[0]?.Id === ownId, `${label} tenant list by code: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected only its own branch)`);
          const [crossResponse] = await this.getBranch(other, ownId);
          verify(failures, crossResponse.status() === 404, `${label} branch under the other tenant: HTTP ${crossResponse.status()} (expected 404)`);
          verify(failures, otherId !== ownId, 'both branches have the same id');
        }
      },
    });
  }

  /**
   * SUC-008: edit name, address and department. The PUT answers 200 and the read-back shows the new values, the
   * code unchanged, the branch still active, `UpdatedAt` later than `CreatedAt` and `UpdatedBy` set. Renaming it
   * to another branch's name answers 400 `BRANCH_NAME_DUPLICATE` and leaves the name as it was.
   */
  @atc('SUC-008')
  async editNameAddressAndDepartment(tenantId: number): Promise<void> {
    const original = this.data.createBranchPayload();
    const other = this.data.createBranchPayload();
    const edit: UpdateBranchPayload = {
      BranchName: this.data.createBranchNameOfLength(30),
      Address: `Carrera ${this.data.createAddressOfLength(8)}`,
      Department: 'Antioquia',
    };
    await this.runCatalogCase({
      what: 'branch edit',
      tenantIds: [tenantId],
      body: async (created, failures) => {
        const ids = created.get(tenantId)!;
        const [response, body] = await this.createTracked(tenantId, original, ids);
        await this.createTracked(tenantId, other, ids);
        verify(failures, response.status() === 200 && ids.length === 2, `setup: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}, ${ids.length} of 2 branches created`);
        if (ids.length !== 2) {
          return;
        }
        const [editResponse, edited] = await this.attemptUpdateBranch(tenantId, ids[0], edit);
        verify(failures, editResponse.status() === 200 && edited.Ok === true, `edit: HTTP ${editResponse.status()} ${edited.CodeError ?? 'no error code'}`);
        const [readResponse, read] = await this.getBranch(tenantId, ids[0]);
        const branch = read.Data;
        verify(failures, readResponse.status() === 200 && branch !== undefined, `read after edit: HTTP ${readResponse.status()}`);
        if (branch) {
          verify(failures, branch.BranchName === edit.BranchName && branch.Address === edit.Address && branch.Department === edit.Department, 'read after edit: name, address or department are not the new values');
          verify(failures, branch.BranchCode === original.BranchCode, 'read after edit: the code changed');
          verify(failures, branch.IsActive === true, 'read after edit: the branch is no longer active');
          verify(failures, branch.UpdatedAt != null && Date.parse(branch.UpdatedAt) > Date.parse(branch.CreatedAt), 'read after edit: UpdatedAt is not later than CreatedAt');
          verify(failures, typeof branch.UpdatedBy === 'string' && branch.UpdatedBy !== '', 'read after edit: UpdatedBy is not set');
        }
        const [clashResponse, clash] = await this.attemptUpdateBranch(tenantId, ids[0], { BranchName: other.BranchName });
        verify(failures, clashResponse.status() === 400 && clash.CodeError === 'BRANCH_NAME_DUPLICATE', `rename to another branch's name: HTTP ${clashResponse.status()} CodeError=${String(clash.CodeError)} (expected 400, BRANCH_NAME_DUPLICATE)`);
        const [afterResponse, after] = await this.getBranch(tenantId, ids[0]);
        verify(failures, afterResponse.status() === 200 && after.Data?.BranchName === edit.BranchName, 'after the refused rename, the name changed');
      },
    });
  }

  /**
   * SUC-009: a branch with an active terminal cannot be deactivated. The PUT answers 400
   * `BRANCH_HAS_ACTIVE_DEPENDENCIES`, the branch stays active and the terminal is untouched. Once the terminal is
   * inactive the branch deactivates (200) and reactivates (200). The branch is handed to `track` (its owner removes
   * terminal and branch in order).
   */
  @atc('SUC-009')
  async refuseDeactivatingBranchWithActiveTerminals(args: { tenantId: number, track: (branchId: number) => void, addTerminal: (branchId: number) => Promise<number>, deactivateTerminal: (terminalId: number) => Promise<void>, readTerminal: (terminalId: number) => Promise<{ status: number, isActive: boolean | null }> }): Promise<void> {
    const { tenantId } = args;
    await this.runCatalogCase({
      what: 'branch deactivation',
      tenantIds: [tenantId],
      body: async (_created, failures) => {
        const [createResponse, created] = await this.attemptCreateBranch(tenantId, this.data.createBranchPayload());
        const branchId = created.Data?.Id ?? 0;
        if (branchId > 0) {
          args.track(branchId);
        }
        verify(failures, createResponse.status() === 200 && branchId > 0, `create: HTTP ${createResponse.status()} ${created.CodeError ?? 'no error code'}`);
        if (branchId <= 0) {
          return;
        }
        const terminalId = await args.addTerminal(branchId);

        const [refusedResponse, refused] = await this.attemptUpdateBranch(tenantId, branchId, { IsActive: false });
        verify(failures, refusedResponse.status() === 400 && refused.Ok === false && refused.CodeError === 'BRANCH_HAS_ACTIVE_DEPENDENCIES', `deactivate with an active terminal: HTTP ${refusedResponse.status()} Ok=${String(refused.Ok)} CodeError=${String(refused.CodeError)} (expected 400, false, BRANCH_HAS_ACTIVE_DEPENDENCIES)`);
        const [stillResponse, still] = await this.getBranch(tenantId, branchId);
        verify(failures, stillResponse.status() === 200 && still.Data?.IsActive === true, 'after the refusal, the branch is no longer active');
        const terminal = await args.readTerminal(terminalId);
        verify(failures, terminal.status === 200 && terminal.isActive === true, `after the refusal, the terminal: HTTP ${terminal.status}, active=${String(terminal.isActive)} (expected 200, true)`);

        await args.deactivateTerminal(terminalId);
        const [offResponse, off] = await this.attemptUpdateBranch(tenantId, branchId, { IsActive: false });
        verify(failures, offResponse.status() === 200 && off.Ok === true, `deactivate with an inactive terminal: HTTP ${offResponse.status()} ${off.CodeError ?? 'no error code'}`);
        const [offReadResponse, offRead] = await this.getBranch(tenantId, branchId);
        verify(failures, offReadResponse.status() === 200 && offRead.Data?.IsActive === false, 'after the deactivation, the branch is still active');
        const [onResponse, on] = await this.attemptUpdateBranch(tenantId, branchId, { IsActive: true });
        verify(failures, onResponse.status() === 200 && on.Ok === true, `reactivate: HTTP ${onResponse.status()} ${on.CodeError ?? 'no error code'}`);
        const [onReadResponse, onRead] = await this.getBranch(tenantId, branchId);
        verify(failures, onReadResponse.status() === 200 && onRead.Data?.IsActive === true, 'after the reactivation, the branch is not active');
      },
    });
  }

  /**
   * SUC-010: delete is soft and leaves no orphans. With an active terminal the DELETE answers 400
   * `BRANCH_HAS_ACTIVE_DEPENDENCIES` and the branch stays. With the terminal inactive the DELETE answers 200, the
   * branch is absent from the list and `GET {id}` answers 404 `BRANCH_NOT_FOUND`, and the terminal is still readable.
   * The branch is handed to `track` (tolerant cleanup: it is already gone when the case passes).
   */
  @atc('SUC-010')
  async deleteBranchSoftlyWithoutOrphans(args: { tenantId: number, track: (branchId: number) => void, addTerminal: (branchId: number) => Promise<number>, deactivateTerminal: (terminalId: number) => Promise<void>, readTerminal: (terminalId: number) => Promise<{ status: number, isActive: boolean | null, branchId: number | null }> }): Promise<void> {
    const { tenantId } = args;
    const payload = this.data.createBranchPayload();
    await this.runCatalogCase({
      what: 'branch delete',
      tenantIds: [tenantId],
      body: async (_created, failures) => {
        const [createResponse, created] = await this.attemptCreateBranch(tenantId, payload);
        const branchId = created.Data?.Id ?? 0;
        if (branchId > 0) {
          args.track(branchId);
        }
        verify(failures, createResponse.status() === 200 && branchId > 0, `create: HTTP ${createResponse.status()} ${created.CodeError ?? 'no error code'}`);
        if (branchId <= 0) {
          return;
        }
        const terminalId = await args.addTerminal(branchId);

        const [refusedResponse, refused] = await this.attemptDeleteBranch(tenantId, branchId);
        verify(failures, refusedResponse.status() === 400 && refused.Ok === false && refused.CodeError === 'BRANCH_HAS_ACTIVE_DEPENDENCIES', `delete with an active terminal: HTTP ${refusedResponse.status()} Ok=${String(refused.Ok)} CodeError=${String(refused.CodeError)} (expected 400, false, BRANCH_HAS_ACTIVE_DEPENDENCIES)`);
        const [stillResponse, still] = await this.getBranch(tenantId, branchId);
        verify(failures, stillResponse.status() === 200 && still.Data?.IsActive === true, `after the refusal, the branch: HTTP ${stillResponse.status()} (expected it to remain, active)`);

        await args.deactivateTerminal(terminalId);
        const [deleteResponse, deleted] = await this.attemptDeleteBranch(tenantId, branchId);
        verify(failures, deleteResponse.status() === 200 && deleted.Ok === true, `delete with an inactive terminal: HTTP ${deleteResponse.status()} ${deleted.CodeError ?? 'no error code'}`);
        const [listResponse, list] = await this.listBranches(tenantId, { searchTerm: payload.BranchCode, pageSize: 10 });
        verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 0, `after the delete, the code search: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 0)`);
        const [goneResponse, gone] = await this.getBranch(tenantId, branchId);
        verify(failures, goneResponse.status() === 404 && gone.CodeError === 'BRANCH_NOT_FOUND', `read after the delete: HTTP ${goneResponse.status()} CodeError=${String(gone.CodeError)} (expected 404, BRANCH_NOT_FOUND)`);
        const terminal = await args.readTerminal(terminalId);
        verify(failures, terminal.status === 200 && terminal.branchId === branchId, `the terminal after the delete: HTTP ${terminal.status}, branch ${String(terminal.branchId)} (expected it readable and unchanged)`);
      },
    });
  }

  /**
   * SUC-011: CSV import. A valid file reports Total, Exitosos and no errors, and the branches are listed. A mixed
   * file (empty code, duplicate code, duplicate name, invalid department among good rows) reports one `Errores`
   * entry per bad row with its `Fila` (the header is row 1) and imports the good rows. An empty file answers 400
   * `CSV_FILE_REQUIRED`, a `.txt` file 400 `CSV_INVALID_EXTENSION`, a file without the required headers 400
   * `CSV_INVALID_FORMAT`, and none of them creates a branch. Every imported branch is deleted at the end.
   */
  @atc('SUC-011')
  async importBranchesFromCsv(tenantId: number): Promise<void> {
    const token = this.data.createBranchCodeOfLength(9).slice(3);
    const row = (n: number, overrides: { code?: string, name?: string, department?: string } = {}) => ({
      code: overrides.code ?? `QAX${token}${n}`,
      name: overrides.name ?? `QAX${token} Sede ${n}`,
      address: `Calle ${n}`,
      department: overrides.department ?? this.data.validDepartment,
    });
    const valid = [row(1), row(2), row(3)];
    const mixed = [
      row(4),
      row(5, { code: '' }),
      row(6, { code: valid[0].code }),
      row(7, { name: valid[0].name }),
      row(8, { department: 'Narnia' }),
      row(9),
    ];
    const expectedErrors = [
      { Fila: 3, Campo: 'BranchCode' },
      { Fila: 4, Campo: 'BranchCode' },
      { Fila: 5, Campo: 'BranchName' },
      { Fila: 6, Campo: 'Departamento' },
    ];
    await this.runCatalogCase({
      what: 'branch CSV import',
      tenantIds: [tenantId],
      body: async (created, failures) => {
        const ids = created.get(tenantId)!;
        try {
          const [validResponse, validBody] = await this.importCsv(tenantId, { name: 'sedes.csv', content: this.data.createBranchCsv(valid) });
          const validResult = validBody.Data;
          verify(failures, validResponse.status() === 200 && validResult?.Total === 3 && validResult.Exitosos === 3 && validResult.Fallidos === 0 && validResult.Errores.length === 0, `valid file: HTTP ${validResponse.status()}, ${JSON.stringify(validResult)} (expected 3 total, 3 imported, 0 failed, no errors)`);

          const [mixedResponse, mixedBody] = await this.importCsv(tenantId, { name: 'sedes-mixto.csv', content: this.data.createBranchCsv(mixed) });
          const mixedResult = mixedBody.Data;
          verify(failures, mixedResponse.status() === 200 && mixedResult?.Total === 6 && mixedResult.Exitosos === 2 && mixedResult.Fallidos === 4, `mixed file: HTTP ${mixedResponse.status()}, total ${String(mixedResult?.Total)} imported ${String(mixedResult?.Exitosos)} failed ${String(mixedResult?.Fallidos)} (expected 6, 2, 4)`);
          for (const expected of expectedErrors) {
            const found = mixedResult?.Errores.find(error => error.Fila === expected.Fila);
            verify(failures, found !== undefined && found.Campo === expected.Campo && found.Mensaje !== '', `mixed file: no error on row ${expected.Fila} for ${expected.Campo} (got ${found ? `${found.Campo}` : 'none'})`);
          }
          verify(failures, mixedResult?.Errores.length === expectedErrors.length, `mixed file: ${String(mixedResult?.Errores.length)} error entries (expected ${expectedErrors.length}, one per bad row)`);

          const [listResponse, list] = await this.listBranches(tenantId, { searchTerm: token, pageSize: 50 });
          verify(failures, listResponse.status() === 200 && list.Data?.TotalRecords === 5, `after both imports, the token search: HTTP ${listResponse.status()}, total ${String(list.Data?.TotalRecords)} (expected 5: 3 valid + 2 good rows)`);

          const refusals = [
            { label: 'empty file', file: { name: 'vacio.csv', content: '' }, code: 'CSV_FILE_REQUIRED' },
            { label: 'non-CSV extension', file: { name: 'sedes.txt', content: this.data.createBranchCsv([row(10)]) }, code: 'CSV_INVALID_EXTENSION' },
            { label: 'missing headers', file: { name: 'sin-encabezados.csv', content: `Codigo,Nombre\nQAX${token}11,QAX${token} Sede 11` }, code: 'CSV_INVALID_FORMAT' },
          ];
          for (const refusal of refusals) {
            const [response, body] = await this.importCsv(tenantId, refusal.file);
            verify(failures, response.status() === 400 && body.CodeError === refusal.code, `${refusal.label}: HTTP ${response.status()} CodeError=${String(body.CodeError)} (expected 400, ${refusal.code})`);
          }
          const [afterResponse, after] = await this.listBranches(tenantId, { searchTerm: token, pageSize: 50 });
          verify(failures, afterResponse.status() === 200 && after.Data?.TotalRecords === 5, `after the refused files, the token search: HTTP ${afterResponse.status()}, total ${String(after.Data?.TotalRecords)} (expected 5, nothing created)`);
        }
        finally {
          const [, all] = await this.listBranches(tenantId, { searchTerm: token, pageSize: 50 });
          ids.push(...(all.Data?.Data.map(branch => branch.Id) ?? []));
        }
      },
    });
  }

  /**
   * Closes the server session of the REAL account. The logout must answer 200. When the body passed, a failed
   * logout fails the ATC; otherwise it only leaves an annotation so the original error is not masked.
   * Undecorated: no secret in a title.
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
   * SUC-012: a TenantAdmin of another tenant is refused on every branch route of a tenant that is not its own.
   * ONE positive login of the real TenantAdmin (`config.tenantAdminUser`), on its own session, signed out at the
   * end. Positive control: the list of its OWN tenant answers 200. Then GET list, GET by id, POST, PUT, DELETE and
   * import-csv against the generated tenant must answer 403 `TENANT_ACCESS_FORBIDDEN` (a CSRF 403 is inconclusive
   * and fails) and the generated branch stays unchanged. Anything wrongly created is handed to `trackCreated`.
   */
  @atc('SUC-012')
  async refuseBranchAccessToOtherTenantAdmin(args: { foreignTenantId: number, target: { id: number }, readTarget: () => Promise<BranchData | null>, trackCreated: (branchId: number) => void }): Promise<void> {
    const { foreignTenantId, target } = args;
    await this.openCryptoSession();
    let bodyPassed = false;
    try {
      const [, loginBody] = await this.signInTenantUser({ UserName: this.config.tenantAdminUser.email, Password: this.config.tenantAdminUser.password });
      const ownTenantId = loginBody.Data?.TenantId ?? 0;
      expect(ownTenantId, 'control: the TenantAdmin login names its tenant').toBeGreaterThan(0);
      expect(ownTenantId, 'the generated tenant must not be the TenantAdmin\'s own').not.toBe(foreignTenantId);
      const [controlResponse, controlBody] = await this.listBranches(ownTenantId, { pageSize: 1 });
      expect(controlResponse.status(), 'control: own tenant branch list').toBe(200);
      expect(controlBody.Ok).toBe(true);

      const before = await args.readTarget();
      expect(before, 'the target branch exists before the probe').not.toBeNull();

      const forged = this.data.createBranchPayload();
      const routes: Array<{ name: string, run: () => Promise<[APIResponse, ApiEnvelope<unknown>]> }> = [
        { name: 'GET list', run: async () => this.listBranches(foreignTenantId, { pageSize: 1 }) },
        { name: 'GET by id', run: async () => this.getBranch(foreignTenantId, target.id) },
        { name: 'POST', run: async () => this.attemptCreateBranch(foreignTenantId, forged) },
        { name: 'PUT', run: async () => this.attemptUpdateBranch(foreignTenantId, target.id, { BranchName: `QAX forged ${forged.BranchCode}` }) },
        { name: 'DELETE', run: async () => this.attemptDeleteBranch(foreignTenantId, target.id) },
        { name: 'import-csv', run: async () => this.importCsv(foreignTenantId, { name: 'sedes.csv', content: this.data.createBranchCsv([{ code: forged.BranchCode, name: forged.BranchName }]) }) },
      ];

      const failures: string[] = [];
      for (const route of routes) {
        const [response, body] = await route.run();
        const created = (body.Data as { Id?: unknown } | null)?.Id;
        if (route.name === 'POST' && typeof created === 'number' && created > 0) {
          args.trackCreated(created);
        }
        const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
        if (response.status() === 403 && /csrf/i.test(text)) {
          failures.push(`${route.name}: inconclusive, the 403 carries the CSRF message, not the tenant one`);
        }
        else if (response.status() !== 403 || body.Ok !== false || body.CodeError !== 'TENANT_ACCESS_FORBIDDEN') {
          failures.push(`${route.name}: status=${response.status()} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 403, false, TENANT_ACCESS_FORBIDDEN)`);
        }
      }

      const after = await args.readTarget();
      if (after === null) {
        failures.push('the target branch no longer exists after the probe');
      }
      else if (before !== null && (after.BranchName !== before.BranchName || after.Address !== before.Address || after.IsActive !== before.IsActive || after.BranchCode !== before.BranchCode)) {
        failures.push('the target branch changed after the probe');
      }
      bodyPassed = failures.length === 0;
      if (failures.length > 0) {
        throw new Error(`${failures.length} of ${routes.length} branch calls were not refused. ${failures.join('; ')}`);
      }
    }
    finally {
      await this.signOutAfterBody(bodyPassed);
    }
  }
}
