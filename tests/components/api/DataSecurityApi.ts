/**
 * KATA Architecture - Layer 3: Data Security API Component
 *
 * Data-level security ATCs of the Validate API (SEC cases): SEC-004 (injection text
 * in filters and forms is neither executed nor allowed to alter the answer) and
 * SEC-011 (critical changes record the acting user and the date, and the actor
 * cannot be forged). Each ATC opens its OWN crypto session on an empty cookie jar.
 *
 * The component is READ-ONLY on generated data: the spec prepares it through
 * `SecurityDataSteps` (QAX-prefixed operators, a soft-deleted tenant) and cleans it
 * afterwards. The only write inside this component is the failed logins of SEC-004,
 * made against a generated username that does not exist (never a real account), and
 * the wait that releases the shared address limiter (4 failures / 30 s).
 *
 * Failure messages name the check, the endpoint and the HTTP status; never a
 * submitted term, a cookie, a token or a password.
 *
 * Scope of SEC-011: acting user and date in the audit fields of the DTOs, and the
 * non-forgeable `UpdatedBy`. The backend application log is NOT covered (owner
 * decision Q3, 2026-10-28), and the action itself is not stored in any field.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - POST /Auth/login/admin       - one positive login per ATC; hostile failed logins (SEC-004)
 * - POST /Auth/logout            - end of the session
 * - GET  /Tenant, /Tenant/{id}   - search and read of the generated tenant
 * - GET  /operators, /operators/{id}
 * - GET  /logs/consultas-nr      - list route searched with injection text (status only)
 */

import type { AuthData, LoginPayload } from '@schemas/auth.types';
import type { OperatorData, PagedData, TenantAuditData } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { test } from '@playwright/test';
import { atc } from '@utils/decorators';

/** The generated operator SEC-004 uses as search control and round-trip subject. */
export interface InjectionControl {
  id: number
  code: string
  name: string
}

/** The generated entities SEC-011 reads (prepared by `SecurityDataSteps`). */
export interface AuditSubjects {
  /** Created and then updated by the Administrator. */
  operatorId: number
  /** Updated through a PUT whose body also carried a forged `UpdatedBy`. */
  forgedOperatorId: number
  /** Created, updated and soft-deleted by the Administrator. */
  tenant: { id: number, rnec: string }
}

/** The label and the creation/update dates of one audited row (SEC-011). */
interface AuditDates {
  label: string
  createdAt: string | null | undefined
  updatedAt: string | null | undefined
}

/** A list route and whether its answer is a strong oracle (generated rows) or status only. */
interface ListRoute {
  endpoint: string
  strong: boolean
}

const LIST_ROUTES: readonly ListRoute[] = [
  { endpoint: '/Tenant', strong: true },
  { endpoint: '/operators', strong: true },
  { endpoint: '/logs/consultas-nr', strong: false },
];

/** How far from "now" a creation date may be (clock skew between the suite and the server). */
const DATE_TOLERANCE_MS = 10 * 60 * 1000;

export class DataSecurityApi extends SecureApi {
  // ============================================
  // Helpers (undecorated: they touch credentials and session headers)
  // ============================================

  /** One failed admin login with a hostile body; returns status and error code only. */
  private async hostileLogin(payload: object): Promise<{ status: number, code: string | null }> {
    const [response, body] = await this.securePOST<AuthData, object>(this.config.auth.adminLoginEndpoint, payload as LoginPayload);
    return { status: response.status(), code: body.CodeError };
  }

  /** Search one list route with a term. Never throws: a transport failure reads as status 0. */
  private async searchRoute(route: ListRoute, term: string): Promise<{ status: number, ok: boolean, total: number | null, ids: number[] }> {
    const query = new URLSearchParams({ Page: '1', PageSize: '50', SearchTerm: term });
    try {
      const [response, body] = await this.secureGET<PagedData<{ Id?: number }>>(`${route.endpoint}?${query.toString()}`);
      return {
        status: response.status(),
        ok: body.Ok,
        total: body.Data?.TotalRecords ?? null,
        ids: (body.Data?.Data ?? []).map(row => row.Id ?? 0),
      };
    }
    catch {
      return { status: 0, ok: false, total: null, ids: [] };
    }
  }

  /** The operator as stored (null when the read does not answer 200). */
  private async readOperator(operatorId: number): Promise<OperatorData | null> {
    const [response, body] = await this.secureGET<OperatorData>(`/operators/${operatorId}`);
    return response.status() === 200 && body.Ok ? body.Data : null;
  }

  /**
   * The soft-deleted tenant: by id first, then in the list with deleted rows included.
   * Null when neither read returns the row.
   */
  private async readDeletedTenant(tenant: { id: number, rnec: string }): Promise<TenantAuditData | null> {
    const [byId, byIdBody] = await this.secureGET<TenantAuditData>(`/Tenant/${tenant.id}`);
    if (byId.status() === 200 && byIdBody.Ok && byIdBody.Data !== null) {
      return byIdBody.Data;
    }
    const query = new URLSearchParams({ Page: '1', PageSize: '50', SearchTerm: tenant.rnec, IncludeDeleted: 'true' });
    const [, listBody] = await this.secureGET<PagedData<TenantAuditData>>(`/Tenant?${query.toString()}`);
    return listBody.Data?.Data?.find(row => row.Id === tenant.id) ?? null;
  }

  /** Whether an audit actor equals the Administrator who made the change (compared in memory). */
  private isAdministrator(actor: string | null | undefined): boolean {
    return typeof actor === 'string' && actor.toLowerCase() === this.config.testUser.email.toLowerCase();
  }

  /** Failures of a creation/update date pair: set, recent and ordered. Field names only. */
  private dateFailures({ label, createdAt, updatedAt }: AuditDates): string[] {
    const failures: string[] = [];
    const parse = (value: string | null | undefined): number => {
      if (typeof value !== 'string' || value === '') {
        return Number.NaN;
      }
      return Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`);
    };
    const created = parse(createdAt);
    const updated = parse(updatedAt);
    if (Number.isNaN(created)) {
      failures.push(`${label}.CreatedAt: not set`);
    }
    else if (Math.abs(Date.now() - created) > DATE_TOLERANCE_MS) {
      failures.push(`${label}.CreatedAt: not within ${DATE_TOLERANCE_MS / 60000} minutes of now`);
    }
    if (Number.isNaN(updated)) {
      failures.push(`${label}.UpdatedAt: not set`);
    }
    else if (!Number.isNaN(created) && updated < created) {
      failures.push(`${label}.UpdatedAt: earlier than CreatedAt`);
    }
    return failures;
  }

  /** Actor and date failures of an operator row. */
  private operatorAuditFailures(label: string, operator: OperatorData | null): string[] {
    if (operator === null) {
      return [`${label}: read did not answer 200`];
    }
    const failures: string[] = [];
    if (!this.isAdministrator(operator.CreatedBy)) {
      failures.push(`${label}.CreatedBy: is not the acting Administrator`);
    }
    if (!this.isAdministrator(operator.UpdatedBy)) {
      failures.push(`${label}.UpdatedBy: is not the acting Administrator`);
    }
    failures.push(...this.dateFailures({ label, createdAt: operator.CreatedAt, updatedAt: operator.UpdatedAt }));
    return failures;
  }

  /** Actor and date failures of the soft-deleted tenant. */
  private tenantAuditFailures(tenant: TenantAuditData): string[] {
    const failures: string[] = [];
    if (!this.isAdministrator(tenant.CreatedBy)) {
      failures.push('tenant.CreatedBy: is not the acting Administrator');
    }
    if (!this.isAdministrator(tenant.UpdatedBy)) {
      failures.push('tenant.UpdatedBy: is not the acting Administrator');
    }
    if (!this.isAdministrator(tenant.DeletedBy)) {
      failures.push('tenant.DeletedBy: is not the acting Administrator');
    }
    failures.push(...this.dateFailures({ label: 'tenant', createdAt: tenant.CreatedAt, updatedAt: tenant.UpdatedAt }));
    const deletedAt = typeof tenant.DeletedAt === 'string' ? Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(tenant.DeletedAt) ? tenant.DeletedAt : `${tenant.DeletedAt}Z`) : Number.NaN;
    if (Number.isNaN(deletedAt)) {
      failures.push('tenant.DeletedAt: not set');
    }
    else if (Math.abs(Date.now() - deletedAt) > DATE_TOLERANCE_MS) {
      failures.push(`tenant.DeletedAt: not within ${DATE_TOLERANCE_MS / 60000} minutes of now`);
    }
    return failures;
  }

  // ============================================
  // ATCs
  // ============================================

  /**
   * SEC-004: injection text in filters and forms is rejected or treated as plain text.
   *
   * Own crypto session. Forms first (before the positive login, so the failed
   * attempts never touch an authenticated session): an admin login with a
   * SQL-looking username and a generated wrong password answers 401
   * INVALID_CREDENTIALS, and a login with object-valued fields answers 400. That is
   * 3 failed requests, below the address limiter; the wait that releases it runs
   * in `finally`. Then ONE positive Administrator login and the filters: each of
   * the 8 injection terms on `/Tenant`, `/operators` (200, `Ok`, 0 rows: strong
   * oracle, and the control row never among them) and `/logs/consultas-nr` (200,
   * `Ok`, never a 5xx: those collections are empty on the target, so the oracle is
   * weak). Positive control: the generated operator's code finds exactly that row.
   * Round trip: its name, with quote and SQL characters, reads back as literal text.
   * Failures are thrown once, naming the check, route and status only.
   */
  @atc('SEC-004')
  async rejectInjectionInFiltersAndForms(control: InjectionControl): Promise<void> {
    const failures: string[] = [];
    let lastFailureAt: number | undefined;
    let bodyPassed = false;
    let releaseError: unknown;

    try {
      await this.openCryptoSession();

      const sqlLogin = await this.hostileLogin({
        UserName: '\' OR 1=1 --',
        Password: this.data.createWrongPassword(),
      });
      lastFailureAt = Date.now();
      if (sqlLogin.status !== 401 || sqlLogin.code !== 'INVALID_CREDENTIALS') {
        failures.push(`form login with SQL-looking username: HTTP ${sqlLogin.status}, expected 401 INVALID_CREDENTIALS`);
      }

      const objectLogin = await this.hostileLogin({ UserName: { $ne: null }, Password: { $ne: null } });
      lastFailureAt = Date.now();
      if (objectLogin.status !== 400) {
        failures.push(`form login with object-valued fields: HTTP ${objectLogin.status}, expected 400`);
      }

      await this.signInAdministrator({
        UserName: this.config.testUser.email,
        Password: this.config.testUser.password,
      });

      const found = await this.searchRoute(LIST_ROUTES[1], control.code);
      if (found.status !== 200 || found.total !== 1 || found.ids[0] !== control.id) {
        failures.push(`positive control /operators: HTTP ${found.status}, the generated operator was not found exactly once`);
      }

      const terms = this.data.createInjectionTerms();
      for (const [index, term] of terms.entries()) {
        for (const route of LIST_ROUTES) {
          const result = await this.searchRoute(route, term);
          const where = `${route.endpoint} term #${index + 1}`;
          if (result.status !== 200 || !result.ok) {
            failures.push(`${where}: HTTP ${result.status}, expected 200 with Ok`);
          }
          else if (route.strong && result.total !== 0) {
            failures.push(`${where}: matched ${result.total ?? 'unknown'} rows, expected 0`);
          }
        }
      }

      const stored = await this.readOperator(control.id);
      if (stored === null) {
        failures.push('round trip /operators/{id}: read did not answer 200');
      }
      else if (stored.OperatorName !== control.name) {
        failures.push('round trip /operators/{id}: stored name differs from the text sent');
      }

      if (failures.length > 0) {
        throw new Error(`${failures.length} injection checks failed. ${failures.join('; ')}`);
      }
      bodyPassed = true;
    }
    finally {
      releaseError = await this.signOutAndReleaseLimiter(lastFailureAt, bodyPassed);
    }
    if (releaseError !== undefined) {
      throw releaseError;
    }
  }

  /**
   * SEC-011: critical changes record the acting user and the date.
   *
   * Own crypto session, ONE positive Administrator login, read-only. The generated
   * entities were created and changed by that same Administrator through
   * `SecurityDataSteps`. Checks: the operator's `CreatedBy` and `UpdatedBy` are the
   * Administrator (compared in memory, never printed), `CreatedAt` is recent and
   * `UpdatedAt` is set and not earlier; the operator whose PUT also carried a
   * forged `UpdatedBy` still records the Administrator; the soft-deleted tenant
   * keeps `CreatedBy`, `UpdatedBy`, `DeletedBy` and the dates (when a read returns
   * it, otherwise the row is dropped and an annotation notes it). Not covered: the
   * backend log (Q3) and the action itself, which no field stores. Failures are
   * thrown once, naming the field only.
   */
  @atc('SEC-011')
  async recordActorAndDateOnCriticalChanges(subjects: AuditSubjects): Promise<void> {
    const failures: string[] = [];
    await this.openAdministratorSession();
    try {
      failures.push(...this.operatorAuditFailures('operator', await this.readOperator(subjects.operatorId)));

      const forged = await this.readOperator(subjects.forgedOperatorId);
      if (forged === null) {
        failures.push('forged operator: read did not answer 200');
      }
      else if (!this.isAdministrator(forged.UpdatedBy)) {
        failures.push('forged operator.UpdatedBy: a value sent in the body replaced the acting Administrator');
      }

      const tenant = await this.readDeletedTenant(subjects.tenant);
      if (tenant === null) {
        test.info().annotations.push({ type: 'tenant-audit-dropped', description: 'soft-deleted tenant is not readable by id or in the list; its audit row was not checked' });
      }
      else {
        failures.push(...this.tenantAuditFailures(tenant));
      }
    }
    finally {
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} audit checks failed. ${failures.join('; ')}`);
    }
  }
}
