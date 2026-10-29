/**
 * KATA Architecture - Layer 3: Operators API Component
 *
 * Test-data helpers for generated operators (SEC and OPE cases): the only free-text
 * entity the backend does not whitelist, so it carries the hostile payloads that
 * the UI and search cases need, and the OPE api ATCs (catalog create and edit, input
 * validation, role access). Deletion is soft.
 * Requires the SuperAdminSistema role (the Administrator session).
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - GET    /operators        - list and search (Page, PageSize, SearchTerm)
 * - GET    /operators/{id}   - read one
 * - POST   /operators        - create
 * - PUT    /operators/{id}   - update (`UpdatedBy` is set from the session, never from the body)
 * - DELETE /operators/{id}   - soft delete
 */

import type { OperatorLimitField } from '@data/types';
import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, LoginPayload } from '@schemas/auth.types';
import type { CreateOperatorPayload, OperatorData, PagedData, UpdateOperatorPayload } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { expect, test } from '@playwright/test';
import { atc } from '@utils/decorators';

/** The one read a UserApp is allowed (policy TenantUserLogs): the OPE-011 positive control. */
const OWN_LOG_READ = '/logs/mis-consultas-nr?Page=1&PageSize=1';

/** One rejected create: what was sent and the validation message (a fragment) the answer must carry. */
interface RejectedOperatorRow {
  label: string
  payload: CreateOperatorPayload
  message: RegExp
}

/** One principal of the OPE-011 matrix. The credentials are a thunk: they are read only when the probe signs in. */
interface OperatorRoleProbe {
  label: 'UserApp' | 'TenantAdmin'
  credentials: () => LoginPayload
  requiresOwnTenant: boolean
  controlPath: (ownTenantId: number) => string
}

/** OPE-011: the generated operator to attack, how to read it as the Administrator, and who tracks what a probe wrongly created. */
export interface OperatorAccessArgs {
  /** The generated UserApp's sign-in as a thunk (a plain field would print its password in the step title). */
  userApp: () => LoginPayload
  target: { id: number }
  readTarget: () => Promise<OperatorData | null>
  trackCreated: (operatorId: number) => void
}

/** What a read of the tenant answered: its CURRENT main operator id, or UNKNOWN when `GET /Tenant/{id}` was not 200. */
export type TenantMainOperatorRead = { known: true, operatorId: number | null } | { known: false, status: number };

/** OPE-009 and OPE-008: the generated operator in use, and a thunk that reads the tenant's CURRENT main operator id. */
export interface OperatorInUseArgs {
  operator: { id: number, code: string }
  readTenantMainOperatorId: () => Promise<TenantMainOperatorRead>
}

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class OperatorsApi extends SecureApi {
  /**
   * Create an operator. Fixed assertions: 200, `Ok`, an id in `Data`.
   * Deliberately NOT a `@step`: the payload may carry hostile text that must not
   * be printed in a step title.
   */
  async createOperator(payload: CreateOperatorPayload): Promise<[APIResponse, ApiEnvelope<OperatorData>]> {
    const [response, body] = await this.securePOST<OperatorData, CreateOperatorPayload>('/operators', payload);

    expect(response.status(), `create operator: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  /** Update an operator. Fixed assertions: 200, `Ok`. NOT a `@step` (payload may be hostile or forged). */
  async updateOperator(
    operatorId: number,
    payload: UpdateOperatorPayload,
  ): Promise<[APIResponse, ApiEnvelope<OperatorData>]> {
    const [response, body] = await this.securePUT<OperatorData, UpdateOperatorPayload>(`/operators/${operatorId}`, payload);

    expect(response.status(), `update operator: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  // ============================================
  // Non-asserting helpers (OPE cases): they return the answer, the ATC judges it
  // ============================================

  /** List or search operators (`GET /operators`). Asserts nothing. The search is a case-insensitive contains on code or name. */
  async listOperators(args: { searchTerm?: string, page?: number, pageSize?: number } = {}): Promise<[APIResponse, ApiEnvelope<PagedData<OperatorData>>]> {
    const query = new URLSearchParams({ Page: String(args.page ?? 1), PageSize: String(args.pageSize ?? 10) });
    if (args.searchTerm !== undefined) {
      query.set('SearchTerm', args.searchTerm);
    }
    return this.secureGET<PagedData<OperatorData>>(`/operators?${query.toString()}`);
  }

  /** Read one operator (`GET /operators/{id}`). Asserts nothing. */
  async getOperator(operatorId: number): Promise<[APIResponse, ApiEnvelope<OperatorData>]> {
    return this.secureGET<OperatorData>(`/operators/${operatorId}`);
  }

  /** Find an operator by its code through the search (codes are unique among live operators). Null when none matches. */
  async findOperatorByCode(code: string): Promise<OperatorData | null> {
    const [, body] = await this.listOperators({ searchTerm: code, pageSize: 100 });
    const wanted = code.trim().toUpperCase();
    return body.Data?.Data.find(operator => operator.OperatorCode.toUpperCase() === wanted) ?? null;
  }

  /** Try to create an operator; asserts nothing (a rejected row answers 400 with a code). NOT a `@step`: the payload may be hostile. */
  async attemptCreate(payload: CreateOperatorPayload): Promise<[APIResponse, ApiEnvelope<OperatorData>]> {
    return this.securePOST<OperatorData, CreateOperatorPayload>('/operators', payload);
  }

  /** Try to update an operator with ANY body (it may carry fields the contract lacks); asserts nothing. */
  async attemptUpdate(operatorId: number, body: object): Promise<[APIResponse, ApiEnvelope<OperatorData>]> {
    return this.securePUT<OperatorData, object>(`/operators/${operatorId}`, body);
  }

  /** Try to delete an operator; asserts nothing. */
  async attemptDelete(operatorId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/operators/${operatorId}`);
  }

  /**
   * Delete generated operators, tolerating the ones already gone (404). Every id is attempted;
   * returns one line per failure (id and status only), empty when all are removed.
   */
  async cleanupCreated(operatorIds: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const id of operatorIds) {
      try {
        const [response] = await this.attemptDelete(id);
        if (response.status() !== 200 && response.status() !== 404) {
          failures.push(`delete operator #${id}: HTTP ${response.status()}`);
        }
      }
      catch (error) {
        failures.push(`delete operator #${id}: ${(error as Error).message.split('\n')[0]}`);
      }
    }
    return failures;
  }

  // ============================================
  // Test Cases (ATCs)
  // ============================================

  /** First line of an error, for a failure list (no stack, no call log). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** The text a refusal carries: the error message plus the validation messages. */
  private answerText(body: ApiEnvelope<unknown>): string {
    return `${body.Error ?? ''} ${JSON.stringify(body.ValidationErrors ?? [])}`;
  }

  /** Remember the id of an operator an answer created (so it is always deleted). Returns whether one was created. */
  private trackIfCreated(body: ApiEnvelope<OperatorData>, createdIds: number[]): boolean {
    const id = body.Data?.Id;
    if (typeof id === 'number' && id > 0) {
      createdIds.push(id);
      return true;
    }
    return false;
  }

  /**
   * Send the rows of a rejected-input case on the CURRENT Administrator session. Each row must answer
   * 400, `Ok` false, `VALIDATION_ERROR` and the row's message, and create nothing. Stops at the first
   * row the product wrongly accepts (tracked in `createdIds`, reported). An exception on one row is
   * recorded for that row and the loop goes on. Returns the failure lines.
   */
  private async rejectedRowFailures(rows: RejectedOperatorRow[], createdIds: number[]): Promise<string[]> {
    const failures: string[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        const [response, body] = await this.attemptCreate(row.payload);
        const status = response.status();
        if (this.trackIfCreated(body, createdIds)) {
          failures.push(`${row.label}: the product ACCEPTED the create (HTTP ${status}, ${body.CodeError ?? 'no error code'}); stopped after row ${index + 1} of ${rows.length}, no more creates are sent once the product accepts one`);
          return failures;
        }
        if (status !== 400 || body.Ok !== false || body.CodeError !== 'VALIDATION_ERROR') {
          failures.push(`${row.label}: HTTP ${status} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 400, false, VALIDATION_ERROR)`);
        }
        else if (!row.message.test(this.answerText(body))) {
          failures.push(`${row.label}: HTTP ${status} VALIDATION_ERROR, the validation message ${row.message} is missing`);
        }

        const code = row.payload.OperatorCode ?? '';
        if (code.trim() !== '') {
          const found = await this.findOperatorByCode(code);
          if (found !== null) {
            createdIds.push(found.Id);
            failures.push(`${row.label}: an operator with that code exists after the rejected create`);
          }
        }
      }
      catch (error) {
        failures.push(`row ${row.label}: ${this.firstLine(error)}`);
      }
    }
    return failures;
  }

  /**
   * Shared body of OPE-003, 005 and 006. Own crypto session, ONE positive Administrator login.
   * The positive control first (a value exactly at its limit is accepted), then the rejected rows.
   * Everything created (control, wrongly accepted rows) is deleted before the session closes; every
   * failure is thrown once, naming the row and the status only.
   */
  private async runRejectedInput(args: { control: OperatorLimitField, rows: RejectedOperatorRow[], what: string }): Promise<void> {
    const createdIds: number[] = [];
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      const [response, body] = await this.attemptCreate(this.data.createMaxLengthOperatorPayload(args.control));
      this.trackIfCreated(body, createdIds);
      expect(response.status(), `control (${args.control} at its limit): ${body.CodeError ?? 'no error code'}`).toBe(200);
      expect(body.Ok).toBe(true);
      failures.push(...await this.rejectedRowFailures(args.rows, createdIds));
    }
    catch (error) {
      failures.push(`control: ${this.firstLine(error)}`);
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
   * OPE-002: create an operator with a mixed-case code, a name and an https URL.
   *
   * Own crypto session, ONE positive Administrator login. The create answers 200, `Ok`, an id; the
   * code is stored UPPER CASE, name and URL as sent, `IsActive` true, `CreatedBy` set. The operator
   * is found by the code search (exactly 1 match) and by `GET /operators/{id}`. Deleted at the end.
   */
  @atc('OPE-002')
  async createOperatorWithCodeNameAndUrl(): Promise<void> {
    const base = this.data.createPlainOperatorPayload();
    const stored = base.OperatorCode!;
    const sent: CreateOperatorPayload = { ...base, OperatorCode: `${stored.slice(0, 4).toLowerCase()}${stored.slice(4)}` };
    const createdIds: number[] = [];
    const failures: string[] = [];

    await this.openAdministratorSession();
    try {
      const [response, body] = await this.attemptCreate(sent);
      this.trackIfCreated(body, createdIds);
      verify(failures, response.status() === 200 && body.Ok === true && createdIds.length === 1, `create: HTTP ${response.status()} ${body.CodeError ?? 'no error code'}`);
      const created = body.Data;
      if (created) {
        verify(failures, created.OperatorCode === stored, 'create: the code is not stored upper case');
        verify(failures, created.OperatorName === sent.OperatorName && created.ServiceUrl === sent.ServiceUrl, 'create: name or URL differ from what was sent');
        verify(failures, created.IsActive === true, 'create: IsActive is not true');
        verify(failures, typeof created.CreatedBy === 'string' && created.CreatedBy !== '', 'create: CreatedBy is not set');

        const [listResponse, list] = await this.listOperators({ searchTerm: sent.OperatorCode!, pageSize: 100 });
        const matches = list.Data?.Data.filter(operator => operator.Id === created.Id) ?? [];
        verify(failures, listResponse.status() === 200 && matches.length === 1 && list.Data?.TotalRecords === 1, `search by code: HTTP ${listResponse.status()}, ${matches.length} matches, total ${String(list.Data?.TotalRecords)} (expected 1 and 1)`);

        const [readResponse, read] = await this.getOperator(created.Id);
        verify(failures, readResponse.status() === 200 && read.Data?.OperatorCode === stored && read.Data.OperatorName === sent.OperatorName, `read by id: HTTP ${readResponse.status()} or the stored values differ`);
      }
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      failures.push(...await this.cleanupCreated(createdIds));
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} create checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * OPE-003: invalid operator codes are refused. Positive control first (10 characters accepted),
   * then empty, whitespace only, 11 characters, symbols (space, hyphen, underscore, dot, at sign,
   * accented letter) and, LAST, a valid code with a trailing line break. Each answers 400,
   * `VALIDATION_ERROR` and a message naming the code, and creates nothing.
   */
  @atc('OPE-003')
  async rejectInvalidOperatorCodes(): Promise<void> {
    const rows = this.data.createInvalidOperatorCodes().map(row => ({
      label: `code (${row.label})`,
      payload: this.data.createPlainOperatorPayload({ OperatorCode: row.value }),
      message: /c.digo/i,
    }));
    await this.runRejectedInput({ control: 'code', rows, what: 'operator code' });
  }

  /**
   * OPE-004: a second create with the same code, and with the same code in lower case, answers
   * 400 `OPERATOR_CODE_DUPLICATE`. Afterwards the code search returns exactly 1 operator and its
   * name is still the first one's.
   */
  @atc('OPE-004')
  async rejectDuplicateOperatorCode(): Promise<void> {
    const original = this.data.createPlainOperatorPayload();
    const code = original.OperatorCode!;
    const duplicates: Array<{ label: string, payload: CreateOperatorPayload }> = [
      { label: 'same code', payload: { ...original, OperatorName: `QAX${code} same` } },
      { label: 'same code in lower case', payload: { ...original, OperatorCode: code.toLowerCase(), OperatorName: `QAX${code} lower` } },
    ];
    const createdIds: number[] = [];
    const failures: string[] = [];

    await this.openAdministratorSession();
    try {
      const [response, body] = await this.attemptCreate(original);
      this.trackIfCreated(body, createdIds);
      expect(response.status(), `first create: ${body.CodeError ?? 'no error code'}`).toBe(200);
      expect(body.Ok).toBe(true);

      for (const row of duplicates) {
        const [dupResponse, dup] = await this.attemptCreate(row.payload);
        if (this.trackIfCreated(dup, createdIds)) {
          failures.push(`${row.label}: the product ACCEPTED the duplicate (HTTP ${dupResponse.status()})`);
        }
        else if (dupResponse.status() !== 400 || dup.Ok !== false || dup.CodeError !== 'OPERATOR_CODE_DUPLICATE') {
          failures.push(`${row.label}: HTTP ${dupResponse.status()} Ok=${String(dup.Ok)} CodeError=${String(dup.CodeError)} (expected 400, false, OPERATOR_CODE_DUPLICATE)`);
        }
      }

      const [, list] = await this.listOperators({ searchTerm: code, pageSize: 100 });
      const same = list.Data?.Data.filter(operator => operator.OperatorCode.toUpperCase() === code) ?? [];
      if (same.length !== 1) {
        failures.push(`after the duplicates the code search returns ${same.length} operators (expected 1)`);
      }
      else if (same[0].OperatorName !== original.OperatorName) {
        failures.push('after the duplicates the stored name is no longer the first one');
      }
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      failures.push(...await this.cleanupCreated(createdIds));
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} duplicate-code checks failed. ${failures.join('; ')}`);
    }
  }

  /**
   * OPE-005: invalid operator names are refused. Positive control first (150 characters accepted),
   * then empty, whitespace only and 151 characters: 400 `VALIDATION_ERROR` with the name message,
   * and nothing created.
   */
  @atc('OPE-005')
  async rejectInvalidOperatorNames(): Promise<void> {
    const rows = this.data.createOperatorNameRows().map(row => ({
      label: `name (${row.label})`,
      payload: this.data.createPlainOperatorPayload({ OperatorName: row.value }),
      message: row.label === '151 characters' ? /M.ximo 150 caracteres/ : /nombre del operador es requerido/i,
    }));
    await this.runRejectedInput({ control: 'name', rows, what: 'operator name' });
  }

  /**
   * OPE-006: invalid service URLs are refused. Positive control first (an https URL of exactly 500
   * characters accepted), then empty, 501 characters, free text, no scheme, `ftp://`, `http://` with
   * no host and, LAST, the malformed-but-prefixed `https:// ` and `http://a b c` (the product only
   * checks the `^https?://.+` prefix): 400 `VALIDATION_ERROR` with the URL message, nothing created.
   */
  @atc('OPE-006')
  async rejectInvalidServiceUrls(): Promise<void> {
    const rows = this.data.createInvalidServiceUrls().map(row => ({
      label: `URL (${row.label})`,
      payload: this.data.createPlainOperatorPayload({ ServiceUrl: row.value }),
      message: row.label === 'empty'
        ? /URL del servicio es requerida/i
        : row.label === '501 characters' ? /M.ximo 500 caracteres/ : /URL v.lida/i,
    }));
    await this.runRejectedInput({ control: 'url', rows, what: 'service URL' });
  }

  /**
   * OPE-007: edit name and URL while the code stays. PUT of a new name and URL answers 200, is
   * persisted (read back), sets `UpdatedBy` and leaves `IsActive` and the code. A second PUT whose
   * body ALSO carries another `OperatorCode` leaves the stored code unchanged (ignored with 200 or
   * refused with 4xx, never a 5xx) and no operator with that other code appears.
   */
  @atc('OPE-007')
  async editNameAndUrlKeepingCode(): Promise<void> {
    const original = this.data.createPlainOperatorPayload();
    const code = original.OperatorCode!;
    const otherCode = this.data.createOperatorCodeOfLength(9);
    const createdIds: number[] = [];
    const failures: string[] = [];

    await this.openAdministratorSession();
    try {
      const [response, body] = await this.attemptCreate(original);
      this.trackIfCreated(body, createdIds);
      expect(response.status(), `create: ${body.CodeError ?? 'no error code'}`).toBe(200);
      expect(body.Ok).toBe(true);
      const id = body.Data!.Id;

      const edit = { OperatorName: `QAX${code} edited`, ServiceUrl: `https://qa-ope.invalid/${code.toLowerCase()}/edited` };
      const [putResponse, put] = await this.attemptUpdate(id, edit);
      verify(failures, putResponse.status() === 200 && put.Ok === true, `edit: HTTP ${putResponse.status()} ${put.CodeError ?? 'no error code'}`);
      const [, read] = await this.getOperator(id);
      const stored = read.Data;
      verify(failures, stored?.OperatorName === edit.OperatorName && stored.ServiceUrl === edit.ServiceUrl, 'edit: the new name or URL was not persisted');
      verify(failures, typeof stored?.UpdatedBy === 'string' && stored.UpdatedBy !== '', 'edit: UpdatedBy is not set');
      verify(failures, stored?.IsActive === true && stored.OperatorCode === code, 'edit: IsActive or the code changed');

      const [forgedResponse] = await this.attemptUpdate(id, { ...edit, OperatorName: `QAX${code} forged`, OperatorCode: otherCode });
      verify(failures, forgedResponse.status() < 500, `PUT carrying another code: HTTP ${forgedResponse.status()} (expected 200 or a 4xx, never a 5xx)`);
      const [, after] = await this.getOperator(id);
      verify(failures, after.Data?.OperatorCode === code, 'PUT carrying another code: the stored code changed');
      const stray = await this.findOperatorByCode(otherCode);
      if (stray !== null) {
        createdIds.push(stray.Id);
        failures.push('PUT carrying another code: an operator with that other code exists');
      }
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      failures.push(...await this.cleanupCreated(createdIds));
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} edit checks failed. ${failures.join('; ')}`);
    }
  }

  /** HTTP statuses that say nothing about the rule (auth, permission, missing route, rate limit): the call is inconclusive. */
  private isInconclusive(status: number): boolean {
    return [401, 403, 404, 429].includes(status);
  }

  /**
   * The facts both in-use cases print after a refused-or-not call: whether the operator is still in
   * the catalog (`listed`, by code search), whether it is still active, and whether the tenant still
   * points at the operator id (`orphan` when it does and the operator is gone or inactive).
   */
  private async operatorInUseFacts(args: OperatorInUseArgs): Promise<{ listed: boolean, active: boolean | null, tenantPoints: boolean | null, tenantText: string }> {
    const found = await this.findOperatorByCode(args.operator.code);
    const [, read] = await this.getOperator(args.operator.id);
    const tenant = await args.readTenantMainOperatorId();
    const points = tenant.known && tenant.operatorId === args.operator.id;
    return {
      listed: found !== null,
      active: read.Data?.IsActive ?? null,
      // null = UNKNOWN (the tenant read was not 200): never read as "the tenant no longer points at it"
      tenantPoints: tenant.known ? points : null,
      tenantText: tenant.known ? (points ? 'yes' : 'no') : `unknown (GET tenant answered HTTP ${tenant.status})`,
    };
  }

  /**
   * OPE-009: an operator used as MAIN operator by a tenant cannot be deleted silently. The DELETE
   * must be BLOCKED by the backend (400 or 409, `Ok` false, operator still in the catalog, tenant
   * still intact) OR answer 200 with a non-empty `Warning`. A UI-only warning does not count.
   * A 401, 403, 404 or 429 is inconclusive and fails. The failure states facts only: HTTP status,
   * `Warning` present yes/no, operator still listed yes/no, tenant still pointing at the id yes/no. An unreadable
   * tenant (`GET /Tenant/{id}` not 200) is inconclusive and fails with that status.
   * Own crypto session, ONE positive Administrator login. The spec prepares the operator and tenant.
   */
  @atc('OPE-009')
  async refuseDeletingOperatorInUse(args: OperatorInUseArgs): Promise<void> {
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      const [response, body] = await this.attemptDelete(args.operator.id);
      const status = response.status();
      const warning = typeof body.Warning === 'string' && body.Warning.trim() !== '';
      const facts = await this.operatorInUseFacts(args);
      const text = `HTTP ${status}, Warning present: ${warning ? 'yes' : 'no'}, operator still listed: ${facts.listed ? 'yes' : 'no'}, tenant still points at the operator id (orphan): ${facts.tenantText}`;

      if (this.isInconclusive(status) || facts.tenantPoints === null) {
        failures.push(`inconclusive, the call says nothing about the rule: ${text}`);
      }
      else if ((status === 400 || status === 409) && body.Ok === false) {
        if (!facts.listed || !facts.tenantPoints) {
          failures.push(`blocked but the data changed: ${text}`);
        }
      }
      else if (!(status === 200 && warning)) {
        failures.push(`an operator in use was deleted with no block and no warning: ${text}`);
      }
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`delete of an operator in use: ${failures.join('; ')}`);
    }
  }

  /**
   * OPE-008: an operator with assigned tenants cannot be deactivated. The attempt must be REFUSED
   * (400 or 409, `Ok` false) and the operator stays ACTIVE (read back). Deactivation is the update
   * endpoint with `IsActive` false: `PUT /operators/{id}` (OperatorsAdminController.cs:38-44),
   * `UpdateOperatorDto.IsActive` (OperatorDto.cs:31), applied with no usage check (OperatorService.cs:73).
   * A 401, 403, 404 or 429 is inconclusive and fails. Facts only: HTTP status, operator still active
   * yes/no, tenant still pointing at the operator id yes/no. Own session, ONE positive Administrator login.
   */
  @atc('OPE-008')
  async refuseDeactivatingOperatorInUse(args: OperatorInUseArgs): Promise<void> {
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      const [response, body] = await this.attemptUpdate(args.operator.id, { IsActive: false });
      const status = response.status();
      const facts = await this.operatorInUseFacts(args);
      const text = `HTTP ${status}, operator still active: ${facts.active === null ? 'unknown (not readable)' : facts.active ? 'yes' : 'no'}, tenant still points at the operator id: ${facts.tenantText}`;

      if (this.isInconclusive(status) || facts.tenantPoints === null) {
        failures.push(`inconclusive, the call says nothing about the rule: ${text}`);
      }
      else if ((status !== 400 && status !== 409) || body.Ok !== false) {
        failures.push(`an operator with assigned tenants was not refused deactivation: ${text}`);
      }
      else if (facts.active !== true || !facts.tenantPoints) {
        failures.push(`refused but the data changed: ${text}`);
      }
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`deactivation of an operator in use: ${failures.join('; ')}`);
    }
  }

  /**
   * Closes the server session of a REAL account. The logout must answer 200. When the body passed,
   * a failed logout fails the ATC; otherwise it only leaves an annotation so the original error is
   * not masked. Undecorated: no secret in a title.
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
   * Signs ONE principal in on its own crypto session (empty cookie jar), proves the positive control,
   * calls the five operator routes and signs out. Returns the failures (empty = every route answered
   * 403 FORBIDDEN with the permission message and the target operator is unchanged). Undecorated and
   * private: the credentials are read here, from a thunk, and never reach a title or an error.
   */
  private async probeOperatorRoutes(probe: OperatorRoleProbe, args: OperatorAccessArgs): Promise<string[]> {
    await this.openCryptoSession();
    let bodyPassed = false;
    try {
      const [, loginBody] = await this.signInTenantUser(probe.credentials());
      const ownTenantId = loginBody.Data?.TenantId ?? 0;
      if (probe.requiresOwnTenant) {
        expect(ownTenantId, 'control: the TenantAdmin login names its tenant').toBeGreaterThan(0);
      }
      const [controlResponse, controlBody] = await this.secureGET<unknown>(probe.controlPath(ownTenantId));
      expect(controlResponse.status(), `control (${probe.label}): own read`).toBe(200);
      expect(controlBody.Ok).toBe(true);

      const before = await args.readTarget();
      expect(before, 'the target operator exists before the probe').not.toBeNull();

      const targetId = args.target.id;
      const forged = this.data.createPlainOperatorPayload();
      const routes: Array<{ name: string, run: () => Promise<[APIResponse, ApiEnvelope<unknown>]> }> = [
        { name: 'GET list', run: async () => this.listOperators({ pageSize: 1 }) },
        { name: 'GET by id', run: async () => this.getOperator(targetId) },
        { name: 'POST', run: async () => this.attemptCreate(forged) },
        { name: 'PUT', run: async () => this.attemptUpdate(targetId, { OperatorName: `QAX forged by ${probe.label}` }) },
        { name: 'DELETE', run: async () => this.attemptDelete(targetId) },
      ];

      const failures: string[] = [];
      for (const route of routes) {
        const [response, body] = await route.run();
        const created = (body.Data as { Id?: unknown } | null)?.Id;
        if (route.name === 'POST' && typeof created === 'number' && created > 0) {
          args.trackCreated(created);
        }
        const text = this.answerText(body);
        if (response.status() === 403 && body.CodeError === 'FORBIDDEN' && /csrf/i.test(text)) {
          failures.push(`${probe.label} ${route.name}: inconclusive, the 403 carries the CSRF message, not the permission one`);
        }
        else if (response.status() !== 403 || body.Ok !== false || body.CodeError !== 'FORBIDDEN') {
          failures.push(`${probe.label} ${route.name}: status=${response.status()} Ok=${String(body.Ok)} CodeError=${String(body.CodeError)} (expected 403, false, FORBIDDEN)`);
        }
        else if (!/permisos suficientes/i.test(text)) {
          failures.push(`${probe.label} ${route.name}: 403 FORBIDDEN without the permission message`);
        }
      }

      const after = await args.readTarget();
      if (after === null) {
        failures.push(`${probe.label}: the target operator no longer exists after the probe`);
      }
      else if (before !== null && (after.OperatorName !== before.OperatorName || after.ServiceUrl !== before.ServiceUrl || after.IsActive !== before.IsActive || after.OperatorCode !== before.OperatorCode)) {
        failures.push(`${probe.label}: the target operator changed after the probe`);
      }
      bodyPassed = true;
      return failures;
    }
    finally {
      await this.signOutAfterBody(bodyPassed);
    }
  }

  /**
   * OPE-011: a signed-in principal that is not the platform Administrator is refused on every
   * operator route. Two principals, each on its OWN session and signed out at the end: a generated
   * UserApp (a thunk) and the real TenantAdmin (`config.tenantAdminUser`, positive login only).
   * Positive control per principal (own read 200). GET list, GET by id, POST, PUT and DELETE must
   * answer 403 `FORBIDDEN` with the PERMISSION message (a CSRF 403 is inconclusive and fails), and
   * the target operator stays unchanged. Anything wrongly created is handed to `trackCreated`.
   */
  @atc('OPE-011')
  async refuseOperatorsToNonAdminRoles(args: OperatorAccessArgs): Promise<void> {
    const probes: OperatorRoleProbe[] = [
      { label: 'UserApp', credentials: args.userApp, requiresOwnTenant: false, controlPath: () => OWN_LOG_READ },
      {
        label: 'TenantAdmin',
        credentials: () => ({ UserName: this.config.tenantAdminUser.email, Password: this.config.tenantAdminUser.password }),
        requiresOwnTenant: true,
        controlPath: tenantId => `/tenants/${tenantId}/appusers?Page=1&PageSize=1`,
      },
    ];

    const failures: string[] = [];
    for (const probe of probes) {
      try {
        failures.push(...await this.probeOperatorRoutes(probe, args));
      }
      catch (error) {
        // One principal that cannot even sign in must not hide what the other one showed
        failures.push(`${probe.label}: probe stopped, ${this.firstLine(error)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} of ${probes.length * 5} operator calls were not refused. ${failures.join('; ')}`);
    }
  }
}
