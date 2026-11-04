/**
 * KATA Architecture - Layer 3: Data Integrity API Component (DAT cases)
 *
 * What the API lets a test observe about how the platform keeps its data: soft delete (DAT-001), operator references
 * (DAT-002), the password and secret history (DAT-004) and the seeded base data (DAT-005). DAT-003 (how secrets are stored
 * in the database) cannot be seen through the API and is a manual case.
 *
 * Endpoints (relative to config.apiUrl, encrypted JSON bodies):
 * - POST/DELETE /Tenant, GET /Tenant?IncludeDeleted=true      - tenants and their soft-deleted rows
 * - POST/DELETE /User, GET /User?includeDeleted=true           - platform Administrators and their soft-deleted rows
 * - POST/DELETE /operators                                    - operators
 * - PATCH /Tenant/{id}/operator                               - assign the main and contingency operators
 * - PATCH /Tenant/{id}/api-credentials                        - set or change the tenant API user and password
 * - POST  /Tenant/{id}/secret                                 - generate a tenant secret (asks the Administrator's own password)
 * - GET   /Role                                               - roles
 *
 * Secret handling: the API passwords, the tenant secrets and the Administrator password never appear in a step title or
 * a failure message (only statuses and error codes). Every helper that carries one is undecorated.
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, CreatedEntityData } from '@schemas/auth.types';
import type { AdminData, RoleData } from '@schemas/resources.types';
import type { OperatorData, PagedData } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { expect } from '@playwright/test';
import { atc } from '@utils/decorators';

/** The columns of a tenant row the DAT cases read. */
interface TenantRow {
  Id: number
  Rnec: string
  BusinessName: string
  IsDeleted: boolean
  DeletedAt?: string | null
  DeletedBy?: string | null
  MainOperatorId?: number | null
  ContingencyOperatorId?: number | null
}

/** An id no operator can have. */
const MISSING_OPERATOR_ID = 2147480000;

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class DataIntegrityApi extends SecureApi {
  // ============================================
  // Helpers (no ATC): they assert nothing and return the raw answer
  // ============================================

  private async createTenantRow(): Promise<{ id: number, rnec: string, name: string }> {
    const payload = this.data.createTenantPayload();
    const [response, body] = await this.securePOST<CreatedEntityData, typeof payload>('/Tenant', payload);
    expect(response.status(), `create tenant: ${body.CodeError ?? 'no error code'}`).toBe(200);
    return { id: body.Data?.Id ?? 0, rnec: payload.Rnec ?? '', name: payload.BusinessName ?? '' };
  }

  private async deleteTenantRow(tenantId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/Tenant/${tenantId}`);
  }

  private async listTenants(searchTerm: string, includeDeleted: boolean): Promise<TenantRow[]> {
    const params = new URLSearchParams({ SearchTerm: searchTerm, PageSize: '10', IncludeDeleted: String(includeDeleted) });
    const [, body] = await this.secureGET<PagedData<TenantRow>>(`/Tenant?${params.toString()}`);
    return body.Data?.Data ?? [];
  }

  private async getTenantRow(tenantId: number): Promise<TenantRow | null> {
    const [, body] = await this.secureGET<TenantRow>(`/Tenant/${tenantId}`);
    return body.Data ?? null;
  }

  private async listAdmins(searchTerm: string, includeDeleted: boolean): Promise<AdminData[]> {
    const params = new URLSearchParams({ SearchTerm: searchTerm, PageSize: '10', includeDeleted: String(includeDeleted) });
    const [, body] = await this.secureGET<PagedData<AdminData>>(`/User?${params.toString()}`);
    return body.Data?.Data ?? [];
  }

  /** Create an operator that lives only in this test. */
  private async createOperatorRow(): Promise<number> {
    const payload = this.data.createPlainOperatorPayload();
    const [response, body] = await this.securePOST<OperatorData, typeof payload>('/operators', payload);
    expect(response.status(), `create operator: ${body.CodeError ?? 'no error code'}`).toBe(200);
    return body.Data?.Id ?? 0;
  }

  private async deleteOperatorRow(operatorId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/operators/${operatorId}`);
  }

  private async assignOperators(tenantId: number, body: { MainOperatorId: number, ContingencyOperatorId?: number }): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.securePATCHWithBody<unknown, typeof body>(`/Tenant/${tenantId}/operator`, body);
  }

  /** Set or change the tenant API credentials. Undecorated: it carries a password. */
  private async setApiCredentials(tenantId: number, credentials: { ApiUsername: string, ApiPassword: string }): Promise<{ status: number, code: string | null }> {
    await this.awaitSensitiveSlot();
    const [response, body] = await this.securePATCHWithBody<unknown, typeof credentials>(`/Tenant/${tenantId}/api-credentials`, credentials);
    return { status: response.status(), code: body.CodeError ?? null };
  }

  /** Generate a tenant secret from `customSecret`. Undecorated: it carries the secret and the Administrator's own password. */
  private async generateSecret(tenantId: number, customSecret: string): Promise<{ status: number, code: string | null }> {
    await this.awaitSensitiveSlot();
    const [response, body] = await this.securePOST<unknown, { AdminPassword: string, CustomSecret: string }>(
      `/Tenant/${tenantId}/secret`,
      { AdminPassword: this.config.testUser.password, CustomSecret: customSecret },
    );
    return { status: response.status(), code: body.CodeError ?? null };
  }

  /** First line of an error, for a failure list (no stack, no call log, never a credential). */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /** Common frame: one Administrator session, collected failures, tolerant cleanup, one thrown error. */
  private async runDataCase(args: { what: string, body: (failures: string[], cleanup: Array<() => Promise<unknown>>) => Promise<void> }): Promise<void> {
    const failures: string[] = [];
    const cleanup: Array<() => Promise<unknown>> = [];
    await this.openAdministratorSession();
    try {
      await args.body(failures, cleanup);
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      for (const undo of cleanup.reverse()) {
        try {
          await undo();
        }
        catch (error) {
          failures.push(`cleanup: ${this.firstLine(error)}`);
        }
      }
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} ${args.what} checks failed. ${failures.join('; ')}`);
    }
  }

  /** Delete through `remove`, accepting 200 and 404 (already gone). */
  private tolerantDelete(label: string, remove: () => Promise<[APIResponse, ApiEnvelope<unknown>]>): () => Promise<void> {
    return async () => {
      const [response] = await remove();
      if (response.status() !== 200 && response.status() !== 404) {
        throw new Error(`${label}: HTTP ${response.status()}`);
      }
    };
  }

  // ============================================
  // Test Cases (ATCs)
  // ============================================

  /**
   * DAT-001: soft delete keeps the history of tenants and platform Administrators (the two entities the API shows deleted).
   * A generated tenant and a generated Administrator are deleted: neither shows in the normal list; both show with
   * `includeDeleted` marked `IsDeleted`, with `DeletedAt` and `DeletedBy` filled and their own data (name, user name) intact.
   */
  @atc('DAT-001')
  async keepSoftDeletedTenantsAndAdministrators(): Promise<void> {
    await this.runDataCase({
      what: 'soft delete',
      body: async (failures, cleanup) => {
        // The ATC deletes both on purpose; a second DELETE would answer 400, so the cleanup only acts when the first one did not happen.
        const deleted = { tenant: false, admin: false };
        const tenant = await this.createTenantRow();
        const removeTenant = this.tolerantDelete(`tenant #${tenant.id}`, async () => this.deleteTenantRow(tenant.id));
        cleanup.push(async () => {
          if (!deleted.tenant) { await removeTenant(); }
        });
        const admin = this.data.createAdminPayload();
        const adminUser = admin.UserName ?? '';
        const [adminResponse, adminBody] = await this.securePOST<CreatedEntityData, typeof admin>('/User', admin);
        const adminId = adminBody.Data?.Id ?? 0;
        if (adminId > 0) {
          const removeAdmin = this.tolerantDelete(`admin #${adminId}`, async () => this.secureDELETE<unknown>(`/User/${adminId}`));
          cleanup.push(async () => {
            if (!deleted.admin) { await removeAdmin(); }
          });
        }
        verify(failures, adminResponse.status() === 200 && adminId > 0, `create admin: HTTP ${adminResponse.status()} ${adminBody.CodeError ?? 'no error code'}`);

        const [liveBefore] = [await this.listTenants(tenant.rnec, false)];
        verify(failures, liveBefore.some(row => row.Id === tenant.id), 'control: the new tenant is not in the normal list');

        const [tenantDelete] = await this.deleteTenantRow(tenant.id);
        verify(failures, tenantDelete.status() === 200, `delete tenant: HTTP ${tenantDelete.status()}`);
        deleted.tenant = tenantDelete.status() === 200;
        if (adminId > 0) {
          const [adminDelete] = await this.secureDELETE<unknown>(`/User/${adminId}`);
          verify(failures, adminDelete.status() === 200, `delete admin: HTTP ${adminDelete.status()}`);
          deleted.admin = adminDelete.status() === 200;
        }

        verify(failures, !(await this.listTenants(tenant.rnec, false)).some(row => row.Id === tenant.id), 'the deleted tenant still shows in the normal list');
        const history = (await this.listTenants(tenant.rnec, true)).find(row => row.Id === tenant.id);
        verify(failures, history !== undefined, 'the deleted tenant does not show with IncludeDeleted');
        if (history !== undefined) {
          verify(failures, history.IsDeleted === true && (history.DeletedAt ?? '') !== '' && (history.DeletedBy ?? '') !== '', `deleted tenant: IsDeleted=${String(history.IsDeleted)} DeletedAt=${String(history.DeletedAt)} DeletedBy=${String(history.DeletedBy)} (expected true and both filled)`);
          verify(failures, history.BusinessName === tenant.name, 'the deleted tenant lost its business name');
        }

        if (adminId > 0) {
          verify(failures, !(await this.listAdmins(adminUser, false)).some(row => row.Id === adminId), 'the deleted Administrator still shows in the normal list');
          const adminHistory = (await this.listAdmins(adminUser, true)).find(row => row.Id === adminId);
          verify(failures, adminHistory !== undefined, 'the deleted Administrator does not show with includeDeleted');
          if (adminHistory !== undefined) {
            verify(failures, adminHistory.IsDeleted === true && (adminHistory.DeletedAt ?? '') !== '' && (adminHistory.DeletedBy ?? '') !== '', `deleted Administrator: IsDeleted=${String(adminHistory.IsDeleted)} DeletedAt=${String(adminHistory.DeletedAt)} DeletedBy=${String(adminHistory.DeletedBy)} (expected true and both filled)`);
            verify(failures, adminHistory.UserName === adminUser, 'the deleted Administrator lost its user name');
          }
        }
      },
    });
  }

  /**
   * DAT-002: a tenant cannot point at an operator that does not exist or was deleted (no orphan references). Control: an active
   * operator is accepted. Then a missing id and a deleted operator as MAIN operator, and a missing id as CONTINGENCY operator,
   * must each be refused (a 4xx) and the tenant keeps its reference. The backend checks neither (HAL-32, HAL-44).
   */
  @atc('DAT-002')
  async refuseOperatorReferencesThatDoNotExist(): Promise<void> {
    await this.runDataCase({
      what: 'operator references',
      body: async (failures, cleanup) => {
        const tenant = await this.createTenantRow();
        cleanup.push(this.tolerantDelete(`tenant #${tenant.id}`, async () => this.deleteTenantRow(tenant.id)));
        const live = await this.createOperatorRow();
        cleanup.push(this.tolerantDelete(`operator #${live}`, async () => this.deleteOperatorRow(live)));
        const gone = await this.createOperatorRow();
        const [goneDelete] = await this.deleteOperatorRow(gone);
        expect(goneDelete.status(), 'control: the operator to be deleted is deleted').toBe(200);

        const [control] = await this.assignOperators(tenant.id, { MainOperatorId: live });
        expect(control.status(), 'control: an active operator is accepted as main operator').toBe(200);

        const rows: Array<{ label: string, body: { MainOperatorId: number, ContingencyOperatorId?: number }, field: 'MainOperatorId' | 'ContingencyOperatorId', value: number }> = [
          { label: 'main operator that does not exist', body: { MainOperatorId: MISSING_OPERATOR_ID }, field: 'MainOperatorId', value: MISSING_OPERATOR_ID },
          { label: 'main operator that was deleted', body: { MainOperatorId: gone }, field: 'MainOperatorId', value: gone },
          { label: 'contingency operator that does not exist', body: { MainOperatorId: live, ContingencyOperatorId: MISSING_OPERATOR_ID }, field: 'ContingencyOperatorId', value: MISSING_OPERATOR_ID },
        ];
        for (const row of rows) {
          const [response, body] = await this.assignOperators(tenant.id, row.body);
          const refused = response.status() >= 400 && response.status() < 500 && body.Ok !== true;
          verify(failures, refused, `${row.label}: HTTP ${response.status()} Ok=${String(body.Ok)} (expected a 4xx refusal)`);
          const read = await this.getTenantRow(tenant.id);
          verify(failures, read?.[row.field] !== row.value, `${row.label}: the tenant now points at the orphan operator #${row.value}`);
        }
      },
    });
  }

  /**
   * DAT-004: the history of API passwords and secrets is recorded, seen through the refusal to reuse a value. API password: set P1,
   * change to P2, then P1 again must answer 400 `PASSWORD_REUSE_HISTORY`; a new P3 is accepted. Secret: generate S1, repeating S1
   * answers `SECRET_REUSE_CURRENT`; generate S2, then S1 again answers `SECRET_REUSE_HISTORY`. No value is ever printed.
   */
  @atc('DAT-004')
  async recordApiPasswordAndSecretHistory(): Promise<void> {
    await this.runDataCase({
      what: 'credential history',
      body: async (failures, cleanup) => {
        const tenant = await this.createTenantRow();
        cleanup.push(this.tolerantDelete(`tenant #${tenant.id}`, async () => this.deleteTenantRow(tenant.id)));
        const user = this.data.createApiUsername();
        const [first, second, third] = [this.data.createApiPassword(), this.data.createApiPassword(), this.data.createApiPassword()];
        const steps: Array<{ label: string, run: () => Promise<{ status: number, code: string | null }>, status: number, code: string | null }> = [
          { label: 'set the API password (P1)', run: async () => this.setApiCredentials(tenant.id, { ApiUsername: user, ApiPassword: first }), status: 200, code: null },
          { label: 'change the API password (P2)', run: async () => this.setApiCredentials(tenant.id, { ApiUsername: user, ApiPassword: second }), status: 200, code: null },
          { label: 'reuse the first API password (P1)', run: async () => this.setApiCredentials(tenant.id, { ApiUsername: user, ApiPassword: first }), status: 400, code: 'PASSWORD_REUSE_HISTORY' },
          { label: 'a new API password (P3)', run: async () => this.setApiCredentials(tenant.id, { ApiUsername: user, ApiPassword: third }), status: 200, code: null },
        ];
        for (const step of steps) {
          const answer = await step.run();
          verify(failures, answer.status === step.status && (step.code === null || answer.code === step.code), `${step.label}: HTTP ${answer.status} ${answer.code ?? 'no error code'} (expected ${step.status}${step.code === null ? '' : ` ${step.code}`})`);
        }

        const [firstSecret, secondSecret] = [this.data.createTenantSecret(), this.data.createTenantSecret()];
        const secretSteps: Array<{ label: string, secret: string, status: number, code: string | null }> = [
          { label: 'generate the first secret (S1)', secret: firstSecret, status: 200, code: null },
          { label: 'repeat the current secret (S1)', secret: firstSecret, status: 400, code: 'SECRET_REUSE_CURRENT' },
          { label: 'generate a second secret (S2)', secret: secondSecret, status: 200, code: null },
          { label: 'reuse the first secret (S1)', secret: firstSecret, status: 400, code: 'SECRET_REUSE_HISTORY' },
        ];
        for (const step of secretSteps) {
          const answer = await this.generateSecret(tenant.id, step.secret);
          verify(failures, answer.status === step.status && (step.code === null || answer.code === step.code), `${step.label}: HTTP ${answer.status} ${answer.code ?? 'no error code'} (expected ${step.status}${step.code === null ? '' : ` ${step.code}`})`);
        }
      },
    });
  }

  /**
   * DAT-005: the base data is present after the seeder. The root Administrator exists, is active and not deleted (read as the
   * suite's own Administrator), and at least one role is seeded. The seeder creates only the root user (HAL-39), so the role check fails today.
   */
  @atc('DAT-005')
  async haveSeededRootUserAndRoles(): Promise<void> {
    await this.runDataCase({
      what: 'seeded base data',
      body: async (failures) => {
        const [meResponse, me] = await this.secureGET<AdminData>(`/User/email/${encodeURIComponent(this.config.testUser.email)}`);
        verify(failures, meResponse.status() === 200 && me.Data !== null && me.Data !== undefined, `read the Administrator of the suite: HTTP ${meResponse.status()} ${me.CodeError ?? 'no error code'}`);
        verify(failures, me.Data?.IsRoot === true && me.Data.IsActive === true && me.Data.IsDeleted === false, `root user: IsRoot=${String(me.Data?.IsRoot)} IsActive=${String(me.Data?.IsActive)} IsDeleted=${String(me.Data?.IsDeleted)} (expected true, true, false)`);

        const [rolesResponse, roles] = await this.secureGET<PagedData<RoleData>>('/Role?PageSize=10');
        verify(failures, rolesResponse.status() === 200 && (roles.Data?.TotalRecords ?? 0) >= 1, `roles: HTTP ${rolesResponse.status()}, total ${String(roles.Data?.TotalRecords)} (expected at least 1 seeded role)`);
      },
    });
  }
}
