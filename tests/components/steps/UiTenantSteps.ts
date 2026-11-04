/**
 * KATA Architecture - Layer 3: Steps - generated tenants for the tenant screen cases (TEN-026, TEN-037)
 *
 * Owns a tenant created through the API and the checks the screen cases cannot do from the browser: how many tenants exist for an RNEC
 * and whether a tenant is still active. Undecorated and instantiated directly (`new UiTenantSteps()`), not a fixture: it owns its OWN
 * request context and Administrator login (one positive login), so it works in `beforeAll` of an `e2e` spec.
 *
 * Cleanup deletes the tenant it prepared and every tenant it found under an RNEC it was asked to count (the one a case creates through
 * the screen), tolerating the ones already gone. No mail is involved.
 */

import type { APIRequestContext } from '@playwright/test';

import { AuthApi } from '@api/AuthApi';
import { TenantManagementApi } from '@api/TenantManagementApi';
import { request as playwrightRequest } from '@playwright/test';
import { TestContext } from '@TestContext';

/** A generated tenant: id, business name and RNEC. */
export interface UiTenant {
  id: number
  name: string
  rnec: string
}

/** The figures of the Dashboard cards, computed from every tenant (deleted ones included). */
export interface TenantStats {
  total: number
  active: number
  inactive: number
  deleted: number
  withApiCredentials: number
  withActiveSecret: number
}

/** What a tenant prepared for the export case holds. */
export interface ExportTenant extends UiTenant {
  branches: number
  terminals: number
  devices: number
  userApps: number
  products: number
  /** Rows the "Sedes, Terminales y Dispositivos" export must hold: one per device, or per terminal without devices, or per branch without terminals. */
  combinedRows: number
}

export class UiTenantSteps extends TestContext {
  private context: APIRequestContext | null = null;
  private auth: AuthApi | null = null;
  private management: TenantManagementApi | null = null;
  private readonly tenantIds = new Set<number>();

  /** Open the own context and the own Administrator session once (a positive login). */
  private async ensureSession(): Promise<TenantManagementApi> {
    if (this.management) {
      return this.management;
    }
    const context = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    this.context = context;
    this.auth = new AuthApi({ request: context });
    const management = new TenantManagementApi({ request: context });
    const [, , session] = await this.auth.startAdminSession({ UserName: this.config.testUser.email, Password: this.config.testUser.password });
    management.setCryptoSession(session);
    this.management = management;
    return management;
  }

  /** Create a generated tenant through the API; its id is recorded for `cleanup`. */
  async prepareTenant(): Promise<UiTenant> {
    const management = await this.ensureSession();
    const payload = this.data.createTenantPayload();
    const [, body] = await management.attemptCreateTenant(payload);
    const id = body.Data!.Id;
    this.tenantIds.add(id);
    return { id, name: String(payload.BusinessName), rnec: String(payload.Rnec) };
  }

  /** How many tenants (deleted ones included) hold this RNEC. Their ids are recorded so `cleanup` removes them. */
  async countByRnec(rnec: string): Promise<number> {
    const management = await this.ensureSession();
    const [, body] = await management.listTenants({ searchTerm: rnec, includeDeleted: true, pageSize: 20 });
    const rows = (body.Data?.Data ?? []).filter(row => row.Rnec === rnec);
    for (const row of rows) {
      this.tenantIds.add(row.Id);
    }
    return rows.length;
  }

  /** Create a tenant with branches, terminals, a device, UserApps and products for the export case. Children are removed by `cleanup`. */
  async prepareExportTenant(): Promise<ExportTenant> {
    const management = await this.ensureSession();
    const tenant = await this.prepareTenant();
    const { id } = tenant;
    const branchIds: number[] = [];
    for (let index = 0; index < 3; index++) {
      branchIds.push(await management.createChild(`/tenants/${id}/branches`, this.data.createBranchPayload()));
    }
    const terminalIds: number[] = [];
    for (const branchId of branchIds.slice(0, 2)) {
      terminalIds.push(await management.createChild(`/tenants/${id}/terminals`, this.data.createTerminalPayload(branchId)));
    }
    await management.createChild(`/tenants/${id}/devices`, this.data.createDevicePayload(terminalIds[0]));
    for (let index = 0; index < 2; index++) {
      await management.createChild(`/tenants/${id}/appusers`, this.data.createUserAppPayload());
      await management.createChild(`/tenant/${id}/Product`, this.data.createProductPayload());
    }
    // branch 1 -> terminal 1 -> device 1; branch 2 -> terminal 2 (no device); branch 3 (no terminals)
    return { ...tenant, branches: 3, terminals: 2, devices: 1, userApps: 2, products: 2, combinedRows: 3 };
  }

  /** Create a UserApp in a tenant (the screen case then adds one more through the form). */
  async prepareUserApp(tenantId: number): Promise<void> {
    const management = await this.ensureSession();
    await management.createChild(`/tenants/${tenantId}/appusers`, this.data.createUserAppPayload());
  }

  /** Total records of a list route of the tenant, through the API (the expected counts of the screen cases). */
  async totalOf(route: string): Promise<number> {
    const management = await this.ensureSession();
    return management.totalOf(route);
  }

  /** The Dashboard figures computed from EVERY tenant, reading all the pages (deleted ones included). */
  async tenantStats(): Promise<TenantStats> {
    const management = await this.ensureSession();
    const rows = [];
    for (let page = 1; page <= 200; page++) {
      const [, body] = await management.listTenants({ includeDeleted: true, pageSize: 100, page });
      const batch = body.Data?.Data ?? [];
      rows.push(...batch);
      if (batch.length < 100) {
        break;
      }
    }
    return {
      total: rows.length,
      active: rows.filter(row => row.IsActive && !row.IsDeleted).length,
      inactive: rows.filter(row => !row.IsActive && !row.IsDeleted).length,
      deleted: rows.filter(row => row.IsDeleted).length,
      withApiCredentials: rows.filter(row => row.HasApiCredentials).length,
      withActiveSecret: rows.filter(row => row.TenantSecretIsActive === true).length,
    };
  }

  /** Create a generated tenant and return its id (tracked for `cleanup`). */
  async createTenantId(): Promise<number> {
    return (await this.prepareTenant()).id;
  }

  /** Disable a tenant through the API. */
  async disableTenant(tenantId: number): Promise<void> {
    const management = await this.ensureSession();
    await management.attemptUpdateTenant(tenantId, { IsActive: false });
  }

  /** Delete a tenant through the API. */
  async removeTenant(tenantId: number): Promise<void> {
    const management = await this.ensureSession();
    await management.attemptDeleteTenant(tenantId);
  }

  /** Whether the tenant is active right now (read through the API). */
  async isActive(tenantId: number): Promise<boolean> {
    const management = await this.ensureSession();
    const [, body] = await management.getTenant(tenantId);
    return body.Data?.IsActive === true && body.Data.IsDeleted === false;
  }

  /** Delete the tenants this instance prepared or found, sign out and close the context. Failures are reported together. */
  async cleanup(): Promise<void> {
    const failures: string[] = [];
    const management = this.management;
    if (management) {
      for (const id of this.tenantIds) {
        for (const [route, child] of [[`/tenants/${id}/devices`, 'devices'], [`/tenants/${id}/terminals`, 'terminals'], [`/tenants/${id}/branches`, 'branches'], [`/tenants/${id}/appusers`, 'appusers'], [`/tenant/${id}/Product`, 'products']] as const) {
          try {
            for (const childId of await management.listChildIds(`${route}?PageSize=100`)) {
              const status = await management.deleteChild(`${route}/${childId}`);
              if (![200, 400, 404].includes(status)) {
                failures.push(`delete ${child} #${childId} of tenant #${id}: HTTP ${status}`);
              }
            }
          }
          catch (error) {
            failures.push(`list ${child} of tenant #${id}: ${String((error as Error).message).split('\n')[0]}`);
          }
        }
        try {
          const [response] = await management.attemptDeleteTenant(id);
          if (![200, 400, 404].includes(response.status())) {
            failures.push(`delete tenant #${id}: HTTP ${response.status()}`);
          }
        }
        catch (error) {
          failures.push(`delete tenant #${id}: ${String((error as Error).message).split('\n')[0]}`);
        }
      }
    }
    await this.auth?.logout().catch(() => undefined);
    await this.context?.dispose().catch(() => undefined);
    this.context = null;
    this.auth = null;
    this.management = null;
    this.tenantIds.clear();
    if (failures.length > 0) {
      throw new Error(`UI tenant cleanup incomplete: ${failures.join('; ')}`);
    }
  }
}
