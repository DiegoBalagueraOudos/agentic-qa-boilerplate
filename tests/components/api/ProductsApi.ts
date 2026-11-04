/**
 * KATA Architecture - Layer 3: Products API Component (PRO cases)
 *
 * Products of a tenant. Helpers named `attempt*` assert nothing and return the raw answer (the
 * rejected-input cases read the status and the error code themselves).
 *
 * Endpoints (relative to config.apiUrl, encrypted JSON bodies):
 * - GET    /tenant/{tenantId}/Product               - list (Page, PageSize, SearchTerm by code or name)
 * - POST   /tenant/{tenantId}/Product               - create (name and a 7-character alphanumeric code)
 * - PUT    /tenant/{tenantId}/Product/{id}          - update (name, IsActive; the code never changes)
 * - PATCH  /tenant/{tenantId}/Product/{id}/status   - status Active | Inactive | Disabled
 * - DELETE /tenant/{tenantId}/Product/{id}          - soft delete
 * - GET    /product                                 - every tenant's products (platform Administrator only)
 *
 * Policies: Administrator and TenantAdmin read and write; `ValidateTenantAccess` limits a TenantAdmin to its own tenant.
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope } from '@schemas/auth.types';
import type { CreateProductPayload, ProductData, UpdateProductPayload } from '@schemas/resources.types';
import type { PagedData } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { expect, test } from '@playwright/test';
import { atc, step } from '@utils/decorators';

/** List query: names follow the backend's `PaginationParams`. */
export interface ProductListQuery {
  page?: number
  pageSize?: number
  searchTerm?: string
}

/** One row of a product input case. `reject` rows must answer 400 `VALIDATION_ERROR` naming the field and create nothing; `accept` rows must answer 200. */
interface ProductInputRow {
  label: string
  payload: CreateProductPayload
  outcome: 'reject' | 'accept'
  message: RegExp
}

/** The backend's refusal messages (Spanish, accents matched loosely). */
const CODE_LENGTH_MESSAGE = /exactamente 7/i;
const CODE_PATTERN_MESSAGE = /letras y n.meros/i;
const NAME_REQUIRED_MESSAGE = /nombre del producto es requerido/i;
const LENGTH_MESSAGE = /M.ximo \d+ caracteres/i;
const STATUS_MESSAGE = /estado/i;

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

/** The flags a status must carry. */
const FLAGS_BY_STATUS: Record<string, { isActive: boolean, isDisabled: boolean }> = {
  Active: { isActive: true, isDisabled: false },
  Inactive: { isActive: false, isDisabled: false },
  Disabled: { isActive: false, isDisabled: true },
};

export class ProductsApi extends SecureApi {
  // ============================================
  // Helpers (no ATC)
  // ============================================

  private listEndpoint(base: string, query: ProductListQuery = {}): string {
    const params = new URLSearchParams();
    if (query.page !== undefined) { params.set('Page', String(query.page)); }
    if (query.pageSize !== undefined) { params.set('PageSize', String(query.pageSize)); }
    if (query.searchTerm !== undefined) { params.set('SearchTerm', query.searchTerm); }
    const text = params.toString();
    return `${base}${text === '' ? '' : `?${text}`}`;
  }

  /** Create a valid product. Fixed assertions: 200, `Ok`, an id in `Data`. */
  @step
  async createProduct(tenantId: number, payload: CreateProductPayload): Promise<[APIResponse, ApiEnvelope<ProductData>]> {
    const [response, body] = await this.securePOST<ProductData, CreateProductPayload>(`/tenant/${tenantId}/Product`, payload);

    expect(response.status(), `create product: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.IdProduct).toBeGreaterThan(0);

    return [response, body];
  }

  /** Create a product; asserts nothing. */
  async attemptCreateProduct(tenantId: number, payload: CreateProductPayload): Promise<[APIResponse, ApiEnvelope<ProductData>]> {
    return this.securePOST<ProductData, CreateProductPayload>(`/tenant/${tenantId}/Product`, payload);
  }

  /** List a tenant's products; asserts nothing. */
  async listProducts(tenantId: number, query: ProductListQuery = {}): Promise<[APIResponse, ApiEnvelope<PagedData<ProductData>>]> {
    return this.secureGET<PagedData<ProductData>>(this.listEndpoint(`/tenant/${tenantId}/Product`, query));
  }

  /** List every tenant's products (platform Administrator only); asserts nothing. */
  async listAllProducts(query: ProductListQuery = {}): Promise<[APIResponse, ApiEnvelope<PagedData<ProductData>>]> {
    return this.secureGET<PagedData<ProductData>>(this.listEndpoint('/product', query));
  }

  /** Update a product; asserts nothing. The body may carry a field the contract does not have (the code). */
  async attemptUpdateProduct(tenantId: number, productId: number, payload: UpdateProductPayload & { ProductCode?: string }): Promise<[APIResponse, ApiEnvelope<ProductData>]> {
    return this.securePUT<ProductData, UpdateProductPayload & { ProductCode?: string }>(`/tenant/${tenantId}/Product/${productId}`, payload);
  }

  /** Change a product's status; asserts nothing. `status` is sent as is (valid or not). */
  async attemptChangeStatus(tenantId: number, productId: number, status: string): Promise<[APIResponse, ApiEnvelope<ProductData>]> {
    return this.securePATCHWithBody<ProductData, { NewStatus: string }>(`/tenant/${tenantId}/Product/${productId}/status`, { NewStatus: status });
  }

  /** Soft-delete a product; asserts nothing (cleanup tolerates a product that is already gone). */
  async attemptDeleteProduct(tenantId: number, productId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/tenant/${tenantId}/Product/${productId}`);
  }

  /** The products of the tenant whose code is exactly `code` (the search is a case-insensitive "contains"). */
  private async findByCode(tenantId: number, code: string): Promise<ProductData[]> {
    const [, body] = await this.listProducts(tenantId, { searchTerm: code, pageSize: 20 });
    return (body.Data?.Data ?? []).filter(product => product.ProductCode === code);
  }

  /** First line of an error, for a failure list (no stack, no call log). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** Delete generated products, tolerating the ones already gone (404). Returns one line per failure. */
  private async cleanupCreated(tenantId: number, productIds: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of productIds) {
      try {
        const [response] = await this.attemptDeleteProduct(tenantId, id);
        if (response.status() !== 200 && response.status() !== 404) {
          failures.push(`delete product #${id}: HTTP ${response.status()}`);
        }
      }
      catch (error) {
        failures.push(`delete product #${id}: ${this.firstLine(error)}`);
      }
    }
    return failures;
  }

  /** Create a product recording its id for cleanup BEFORE judging the answer. Returns the answer. */
  private async createTracked(tenantId: number, payload: CreateProductPayload, createdIds: number[]): Promise<[APIResponse, ApiEnvelope<ProductData>]> {
    const answer = await this.attemptCreateProduct(tenantId, payload);
    const id = answer[1].Data?.IdProduct;
    if (typeof id === 'number' && id > 0) {
      createdIds.push(id);
    }
    return answer;
  }

  /** Common frame of the product ATCs: one Administrator session, collected failures, cleanup, one thrown error. */
  private async runProductCase(args: { what: string, tenantId: number, body: (createdIds: number[], failures: string[]) => Promise<void> }): Promise<void> {
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
   * Shared body of PRO-003, 004 and 006. The positive control first (a valid product), then the rows in
   * order. A reject row the product wrongly accepts is tracked and reported; an accept row it refuses is
   * reported. Everything created is deleted before the session closes.
   */
  private async runProductInput(args: { tenantId: number, rows: ProductInputRow[], what: string }): Promise<void> {
    const { tenantId } = args;
    await this.runProductCase({
      what: args.what,
      tenantId,
      body: async (createdIds, failures) => {
        const [controlResponse, controlBody] = await this.createTracked(tenantId, this.data.createProductPayload(), createdIds);
        expect(controlResponse.status(), `control (valid product): ${controlBody.CodeError ?? 'no error code'}`).toBe(200);
        expect(controlBody.Ok).toBe(true);

        for (const row of args.rows) {
          try {
            const [response, body] = await this.createTracked(tenantId, row.payload, createdIds);
            const status = response.status();
            const created = typeof body.Data?.IdProduct === 'number' && body.Data.IdProduct > 0;
            if (row.outcome === 'accept') {
              verify(failures, status === 200 && body.Ok === true && created, `${row.label}: expected ACCEPTED (200), got HTTP ${status} ${body.CodeError ?? 'no error code'}`);
              continue;
            }
            if (created) {
              failures.push(`${row.label}: the product ACCEPTED the create (HTTP ${status})`);
              continue;
            }
            const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
            if (status !== 400 || body.Ok !== false || body.CodeError !== 'VALIDATION_ERROR') {
              failures.push(`${row.label}: HTTP ${status} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 400, false, VALIDATION_ERROR)`);
            }
            else if (!row.message.test(text)) {
              failures.push(`${row.label}: HTTP ${status} VALIDATION_ERROR, the validation message ${row.message} is missing`);
            }
            const code = row.payload.ProductCode.trim();
            if (code !== '' && (await this.findByCode(tenantId, row.payload.ProductCode)).length > 0) {
              failures.push(`${row.label}: a product with that code exists after the rejected create`);
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
  // Test Cases (ATCs)
  // ============================================

  /**
   * PRO-001: list a tenant's products with search and paging. Three generated products share one token (distinct
   * names and codes). Page size 2 gives 2 pages (2 + 1 rows, total 3, ordered by name); the search finds exactly the
   * expected product by code (lower case), by name (lower case) and by the shared token; a search with no match is
   * empty; another tenant's list never shows them; the platform-wide list does.
   */
  @atc('PRO-001')
  async listProductsWithSearchAndPaging(args: { tenantId: number, otherTenantId: number }): Promise<void> {
    const { tenantId, otherTenantId } = args;
    const token = this.data.createProductCodeOfLength(8).slice(2);
    const specs = ['Alfa', 'Beta', 'Gamma'].map(suffix => ({
      suffix,
      payload: this.data.createProductPayload({ ProductName: `QAX${token} ${suffix}` }),
      id: 0,
    }));
    await this.runProductCase({
      what: 'product list',
      tenantId,
      body: async (createdIds, failures) => {
        for (const spec of specs) {
          const [response, body] = await this.createTracked(tenantId, spec.payload, createdIds);
          spec.id = body.Data?.IdProduct ?? 0;
          verify(failures, response.status() === 200 && spec.id > 0, `create ${spec.suffix}: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        }
        const [alfa, beta, gamma] = specs;
        if (!specs.every(spec => spec.id > 0)) {
          return;
        }

        const [firstResponse, first] = await this.listProducts(tenantId, { searchTerm: token, page: 1, pageSize: 2 });
        verify(failures, firstResponse.status() === 200 && first.Data?.Data.length === 2 && first.Data.TotalRecords === 3, `page 1 (size 2): HTTP ${firstResponse.status()}, ${String(first.Data?.Data.length)} rows, total ${String(first.Data?.TotalRecords)} (expected 2 rows, total 3)`);
        verify(failures, first.Data?.Data.map(row => row.IdProduct).join() === `${alfa.id},${beta.id}`, 'page 1: the rows are not Alfa then Beta (order by name)');
        const [secondResponse, second] = await this.listProducts(tenantId, { searchTerm: token, page: 2, pageSize: 2 });
        verify(failures, secondResponse.status() === 200 && second.Data?.Data.length === 1 && second.Data.Data[0].IdProduct === gamma.id && second.Data.TotalRecords === 3, `page 2 (size 2): HTTP ${secondResponse.status()}, ${String(second.Data?.Data.length)} rows (expected only Gamma, total 3)`);

        const searches: Array<{ label: string, term: string, expected: number[] }> = [
          { label: 'by code (lower case)', term: alfa.payload.ProductCode.toLowerCase(), expected: [alfa.id] },
          { label: 'by name (lower case)', term: beta.payload.ProductName.toLowerCase(), expected: [beta.id] },
          { label: 'by the shared token', term: token, expected: [alfa.id, beta.id, gamma.id] },
          { label: 'without a match', term: `zz${token}`, expected: [] },
        ];
        for (const search of searches) {
          const [response, body] = await this.listProducts(tenantId, { searchTerm: search.term, pageSize: 10 });
          const ids = body.Data?.Data.map(row => row.IdProduct) ?? [];
          verify(failures, response.status() === 200 && ids.join() === search.expected.join() && body.Data?.TotalRecords === search.expected.length, `search ${search.label}: HTTP ${response.status()}, rows [${ids.join()}] total ${String(body.Data?.TotalRecords)} (expected [${search.expected.join()}])`);
        }

        const [otherResponse, other] = await this.listProducts(otherTenantId, { searchTerm: token, pageSize: 10 });
        verify(failures, otherResponse.status() === 200 && other.Data?.TotalRecords === 0, `other tenant: HTTP ${otherResponse.status()}, total ${String(other.Data?.TotalRecords)} (expected 0: the products belong to one tenant)`);

        const [allResponse, all] = await this.listAllProducts({ searchTerm: token, pageSize: 10 });
        const allIds = new Set(all.Data?.Data.map(row => row.IdProduct));
        verify(failures, allResponse.status() === 200 && specs.every(spec => allIds.has(spec.id)), `platform-wide list: HTTP ${allResponse.status()}, it does not hold the three products`);
      },
    });
  }

  /**
   * PRO-002: create a product with a name and a 7-character code. The answer carries the same name and code, the
   * tenant, status `Active` with `IsActive` true and `IsDisabled` false, the creator and the creation date; the list
   * of the tenant returns it (found by its code) with the same values.
   */
  @atc('PRO-002')
  async createProductWithNameAndCode(tenantId: number): Promise<void> {
    const payload = this.data.createProductPayload();
    await this.runProductCase({
      what: 'product creation',
      tenantId,
      body: async (createdIds, failures) => {
        const [response, body] = await this.createTracked(tenantId, payload, createdIds);
        const product = body.Data;
        verify(failures, response.status() === 200 && body.Ok === true && product !== null && product !== undefined, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
        if (product === null || product === undefined) {
          return;
        }
        verify(failures, product.ProductName === payload.ProductName && product.ProductCode === payload.ProductCode, 'create: the answer does not carry the name and code that were sent');
        verify(failures, product.TenantId === tenantId, `create: TenantId ${product.TenantId} (expected ${tenantId})`);
        verify(failures, product.Status === 'Active' && product.IsActive && !product.IsDisabled, `create: Status=${product.Status} IsActive=${String(product.IsActive)} IsDisabled=${String(product.IsDisabled)} (expected Active, true, false)`);
        verify(failures, product.CreatedBy !== '' && product.CreatedAt !== '', 'create: CreatedBy or CreatedAt is empty');

        const found = await this.findByCode(tenantId, payload.ProductCode);
        verify(failures, found.length === 1 && found[0].ProductName === payload.ProductName && found[0].Status === 'Active', `list: ${found.length} product(s) with the code (expected exactly 1, Active, same name)`);
      },
    });
  }

  /** PRO-003: codes of 6 and 8 characters are refused (400, nothing created); the control of exactly 7 is accepted. */
  @atc('PRO-003')
  async rejectProductCodesOfWrongLength(tenantId: number): Promise<void> {
    const rows: ProductInputRow[] = this.data.createWrongLengthProductCodes().map(row => ({
      label: `code (${row.label})`,
      payload: this.data.createProductPayload({ ProductCode: row.value }),
      outcome: 'reject',
      message: CODE_LENGTH_MESSAGE,
    }));
    await this.runProductInput({ tenantId, rows, what: 'product code length' });
  }

  /** PRO-004: codes with spaces or symbols are refused (400, nothing created); a mixed-case alphanumeric code is accepted. */
  @atc('PRO-004')
  async rejectProductCodesWithSpacesOrSymbols(tenantId: number): Promise<void> {
    const rows: ProductInputRow[] = this.data.createMalformedProductCodes().map(row => ({
      label: `code (${row.label})`,
      payload: this.data.createProductPayload({ ProductCode: row.value }),
      outcome: 'reject',
      message: CODE_PATTERN_MESSAGE,
    }));
    rows.push({
      label: 'code (mixed-case letters and digits)',
      payload: this.data.createProductPayload({ ProductCode: 'aB3dE5f' }),
      outcome: 'accept',
      message: CODE_PATTERN_MESSAGE,
    });
    await this.runProductInput({ tenantId, rows, what: 'product code characters' });
  }

  /**
   * PRO-005: a second product with the code of an existing one, in the same tenant, must be refused (a 4xx with
   * `Ok` false) and only one product keeps the code. The backend validates the NAME only, so this fails today.
   */
  @atc('PRO-005')
  async rejectDuplicateProductCode(tenantId: number): Promise<void> {
    const first = this.data.createProductPayload();
    const second = this.data.createProductPayload({ ProductCode: first.ProductCode });
    await this.runProductCase({
      what: 'duplicate product code',
      tenantId,
      body: async (createdIds, failures) => {
        const [firstResponse, firstBody] = await this.createTracked(tenantId, first, createdIds);
        expect(firstResponse.status(), `control (first product): ${firstBody.CodeError ?? 'no error code'}`).toBe(200);

        const [response, body] = await this.createTracked(tenantId, second, createdIds);
        const created = typeof body.Data?.IdProduct === 'number' && body.Data.IdProduct > 0;
        if (created) {
          failures.push(`the product ACCEPTED a second product with the same code (HTTP ${response.status()})`);
        }
        else {
          verify(failures, [400, 409].includes(response.status()) && body.Ok === false, `duplicate code: HTTP ${response.status()} Ok=${String(body.Ok)} (expected 400 or 409, false)`);
        }
        const holders = await this.findByCode(tenantId, first.ProductCode);
        verify(failures, holders.length === 1, `${holders.length} products hold the code after the duplicate create (expected 1)`);
      },
    });
  }

  /**
   * PRO-006: an empty name, a whitespace-only name and a name of 151 characters are refused (400, nothing created);
   * a name of 50 characters is accepted and, LAST, so is the documented limit: a name of 150 characters (the form and
   * the matrix; the backend limit is 50, so that row fails today).
   */
  @atc('PRO-006')
  async rejectInvalidProductNames(tenantId: number): Promise<void> {
    const rows: ProductInputRow[] = [
      { label: 'name (empty)', payload: this.data.createProductPayload({ ProductName: '' }), outcome: 'reject', message: NAME_REQUIRED_MESSAGE },
      { label: 'name (whitespace only)', payload: this.data.createProductPayload({ ProductName: '   ' }), outcome: 'reject', message: NAME_REQUIRED_MESSAGE },
      { label: 'name (151 characters)', payload: this.data.createProductPayload({ ProductName: this.data.createProductNameOfLength(151) }), outcome: 'reject', message: LENGTH_MESSAGE },
      { label: 'name (50 characters)', payload: this.data.createProductPayload({ ProductName: this.data.createProductNameOfLength(50) }), outcome: 'accept', message: LENGTH_MESSAGE },
      { label: 'name (150 characters, documented limit)', payload: this.data.createProductPayload({ ProductName: this.data.createProductNameOfLength(150) }), outcome: 'accept', message: LENGTH_MESSAGE },
    ];
    await this.runProductInput({ tenantId, rows, what: 'product name' });
  }

  /**
   * PRO-007: the name can be edited and the code cannot. A PUT with a new name answers 200 with the new name and the
   * same code; a PUT that also sends another code leaves the code unchanged (read back from the list); an empty name
   * and a name of 151 characters are refused (400) and the name stays.
   */
  @atc('PRO-007')
  async editProductNameButNotCode(tenantId: number): Promise<void> {
    const payload = this.data.createProductPayload();
    await this.runProductCase({
      what: 'product edit',
      tenantId,
      body: async (createdIds, failures) => {
        const [createResponse, createBody] = await this.createTracked(tenantId, payload, createdIds);
        expect(createResponse.status(), `control (create): ${createBody.CodeError ?? 'no error code'}`).toBe(200);
        const productId = createBody.Data?.IdProduct ?? 0;

        const newName = `${payload.ProductName} editado`;
        const [renameResponse, renamed] = await this.attemptUpdateProduct(tenantId, productId, { ProductName: newName });
        verify(failures, renameResponse.status() === 200 && renamed.Ok === true && renamed.Data?.ProductName === newName && renamed.Data.ProductCode === payload.ProductCode, `rename: HTTP ${renameResponse.status()} ${renamed.CodeError ?? 'no error code'}, name/code not as expected`);

        const otherCode = this.data.createProductCodeOfLength(7);
        const [codeResponse, codeBody] = await this.attemptUpdateProduct(tenantId, productId, { ProductName: newName, ProductCode: otherCode });
        verify(failures, codeResponse.status() === 200 ? codeBody.Data?.ProductCode === payload.ProductCode : codeResponse.status() === 400, `send another code: HTTP ${codeResponse.status()}, the answer does not keep the original code`);
        const holders = await this.findByCode(tenantId, payload.ProductCode);
        verify(failures, holders.length === 1 && holders[0].IdProduct === productId, 'the original code no longer belongs to the product after a PUT that sent another code');
        verify(failures, (await this.findByCode(tenantId, otherCode)).length === 0, 'a product holds the code that was sent in the PUT');

        for (const row of [{ label: 'empty name', name: '' }, { label: '151 characters', name: this.data.createProductNameOfLength(151) }]) {
          const [response, body] = await this.attemptUpdateProduct(tenantId, productId, { ProductName: row.name });
          verify(failures, response.status() === 400 && body.Ok === false && body.CodeError === 'VALIDATION_ERROR', `rename to ${row.label}: HTTP ${response.status()} CodeError=${String(body.CodeError)} (expected 400, VALIDATION_ERROR)`);
        }
        const after = (await this.findByCode(tenantId, payload.ProductCode))[0];
        verify(failures, after?.ProductName === newName, 'the name changed after a refused rename');
      },
    });
  }

  /**
   * PRO-008: the status moves Active -> Inactive -> Disabled -> Active. After every PATCH the answer and the list agree
   * on `Status`, `IsActive` and `IsDisabled` (Active true/false, Inactive false/false, Disabled false/true). LAST, a PUT
   * that sets `IsActive` on a Disabled product must not leave it active and disabled at once (the PUT does not touch
   * `IsDisabled`, so this row fails today).
   */
  @atc('PRO-008')
  async changeProductStatusKeepingFlagsCoherent(tenantId: number): Promise<void> {
    const payload = this.data.createProductPayload();
    await this.runProductCase({
      what: 'product status',
      tenantId,
      body: async (createdIds, failures) => {
        const [createResponse, createBody] = await this.createTracked(tenantId, payload, createdIds);
        expect(createResponse.status(), `control (create): ${createBody.CodeError ?? 'no error code'}`).toBe(200);
        const productId = createBody.Data?.IdProduct ?? 0;

        for (const status of ['Inactive', 'Disabled', 'Active']) {
          const expected = FLAGS_BY_STATUS[status];
          const [response, body] = await this.attemptChangeStatus(tenantId, productId, status);
          verify(failures, response.status() === 200 && body.Ok === true && body.Data?.Status === status && body.Data.IsActive === expected.isActive && body.Data.IsDisabled === expected.isDisabled, `to ${status}: HTTP ${response.status()} Status=${String(body.Data?.Status)} IsActive=${String(body.Data?.IsActive)} IsDisabled=${String(body.Data?.IsDisabled)} (expected ${status}, ${expected.isActive}, ${expected.isDisabled})`);
          const read = (await this.findByCode(tenantId, payload.ProductCode))[0];
          verify(failures, read?.Status === status && read.IsActive === expected.isActive && read.IsDisabled === expected.isDisabled, `to ${status}: the list does not agree (Status=${String(read?.Status)} IsActive=${String(read?.IsActive)} IsDisabled=${String(read?.IsDisabled)})`);
        }

        await this.attemptChangeStatus(tenantId, productId, 'Disabled');
        const [putResponse, putBody] = await this.attemptUpdateProduct(tenantId, productId, { IsActive: true });
        const status = putResponse.status();
        if (status === 200) {
          const read = (await this.findByCode(tenantId, payload.ProductCode))[0];
          verify(failures, read !== undefined && !(read.IsActive && read.IsDisabled), `PUT IsActive=true on a Disabled product: it is now IsActive=${String(read?.IsActive)} and IsDisabled=${String(read?.IsDisabled)} (Status ${String(read?.Status)}); the two flags must never be true together`);
        }
        else {
          verify(failures, status === 400 && putBody.Ok === false, `PUT IsActive=true on a Disabled product: HTTP ${status} (expected 200 with coherent flags, or a 400 refusal)`);
        }
      },
    });
  }

  /** PRO-009: statuses outside Active, Inactive and Disabled are refused (400 `VALIDATION_ERROR`) and the product keeps its status. */
  @atc('PRO-009')
  async rejectInvalidProductStatuses(tenantId: number): Promise<void> {
    const payload = this.data.createProductPayload();
    await this.runProductCase({
      what: 'invalid product status',
      tenantId,
      body: async (createdIds, failures) => {
        const [createResponse, createBody] = await this.createTracked(tenantId, payload, createdIds);
        expect(createResponse.status(), `control (create): ${createBody.CodeError ?? 'no error code'}`).toBe(200);
        const productId = createBody.Data?.IdProduct ?? 0;

        for (const row of this.data.createInvalidProductStatuses()) {
          const [response, body] = await this.attemptChangeStatus(tenantId, productId, row.value);
          const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
          verify(failures, response.status() === 400 && body.Ok === false && body.CodeError === 'VALIDATION_ERROR' && STATUS_MESSAGE.test(text), `status (${row.label}): HTTP ${response.status()} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 400, false, VALIDATION_ERROR naming the status)`);
        }
        const read = (await this.findByCode(tenantId, payload.ProductCode))[0];
        verify(failures, read?.Status === 'Active' && read.IsActive && !read.IsDisabled, `the product changed after the refused statuses (Status=${String(read?.Status)})`);
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
   * PRO-011: a TenantAdmin sees only the products of its own tenant. ONE positive login of the real TenantAdmin
   * (`config.tenantAdminUser`) on its own session, signed out at the end. Its own tenant's list answers 200 and every
   * row belongs to that tenant; the list of another (generated) tenant and the platform-wide list are refused with
   * 403 (a CSRF 403 is inconclusive and fails). The product has no `mine` route: the tenant list is the route.
   */
  @atc('PRO-011')
  async listOnlyOwnTenantProductsAsTenantAdmin(args: { foreignTenantId: number }): Promise<void> {
    const { foreignTenantId } = args;
    await this.openCryptoSession();
    let bodyPassed = false;
    try {
      const [, loginBody] = await this.signInTenantUser({ UserName: this.config.tenantAdminUser.email, Password: this.config.tenantAdminUser.password });
      const ownTenantId = loginBody.Data?.TenantId ?? 0;
      expect(ownTenantId, 'control: the TenantAdmin login names its tenant').toBeGreaterThan(0);
      expect(ownTenantId, 'the generated tenant must not be the TenantAdmin\'s own').not.toBe(foreignTenantId);

      const failures: string[] = [];
      const [ownResponse, own] = await this.listProducts(ownTenantId, { pageSize: 50 });
      verify(failures, ownResponse.status() === 200 && own.Ok === true, `own tenant list: HTTP ${ownResponse.status()} ${own.CodeError ?? 'no error code'} (expected 200)`);
      const foreign = (own.Data?.Data ?? []).filter(product => product.TenantId !== ownTenantId);
      verify(failures, foreign.length === 0, `own tenant list: ${foreign.length} row(s) of another tenant`);

      const refused: Array<{ name: string, run: () => Promise<[APIResponse, ApiEnvelope<PagedData<ProductData>>]> }> = [
        { name: 'list of another tenant', run: async () => this.listProducts(foreignTenantId, { pageSize: 10 }) },
        { name: 'platform-wide list', run: async () => this.listAllProducts({ pageSize: 10 }) },
      ];
      for (const route of refused) {
        const [response, body] = await route.run();
        const text = `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
        if (response.status() === 403 && /csrf/i.test(text)) {
          failures.push(`${route.name}: inconclusive, the 403 carries the CSRF message`);
        }
        else if (response.status() !== 403 || body.Ok !== false || (body.Data?.Data.length ?? 0) > 0) {
          failures.push(`${route.name}: status=${response.status()} Ok=${String(body.Ok)} rows=${String(body.Data?.Data.length ?? 0)} (expected 403, false, no rows)`);
        }
      }

      bodyPassed = failures.length === 0;
      if (failures.length > 0) {
        throw new Error(`${failures.length} product access checks failed. ${failures.join('; ')}`);
      }
    }
    finally {
      await this.signOutAfterBody(bodyPassed);
    }
  }
}
