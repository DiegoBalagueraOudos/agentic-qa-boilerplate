/**
 * Tenant detail screen: the "Exportar CSV" menu (TEN-082).
 *
 * A GENERATED tenant is prepared in `beforeAll` with 3 branches, 2 terminals, 1 device, 2 UserApps and 2 products (no mail); the
 * children and the tenant are deleted in `afterAll`. The case downloads the eight exports of the menu and reads them in memory (nothing
 * is saved). It keeps the saved Administrator session. File-level trace off.
 */

import type { ExportTenant } from '@steps/UiTenantSteps';
import type { ExportExpectation } from '@ui/TenantDetailPage';

import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Tenant detail CSV exports', () => {
  const tenants = new UiTenantSteps();
  let tenant: ExportTenant;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      tenant = await tenants.prepareExportTenant();
    }
    catch (error) {
      await tenants.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    await tenants.cleanup();
  });

  test('TEN-082: should export the tenant data to CSV', async ({ ui }) => {
    const admins = await tenants.totalOf(`/tenants/${tenant.id}/tenant-admins?PageSize=1`);
    const operators = await tenants.totalOf('/operators?PageSize=1');
    const exports: ExportExpectation[] = [
      { entry: 'Administradores', file: /administradores/i, rows: admins },
      { entry: 'Usuarios App', file: /usuarios-app/i, rows: tenant.userApps },
      { entry: 'Sedes, Terminales y Dispositivos', file: /sedes-terminales-dispositivos/i, rows: tenant.combinedRows },
      { entry: 'Solo Sedes', file: /^sedes\.csv$/i, rows: tenant.branches },
      { entry: 'Solo Terminales', file: /terminales/i, rows: tenant.terminals },
      { entry: 'Solo Dispositivos', file: /dispositivos/i, rows: tenant.devices },
      { entry: 'Operadores', file: /operadores/i, rows: operators },
      { entry: 'Productos', file: /productos/i, rows: tenant.products },
    ];
    await ui.tenantDetail.exportTenantDataToCsv({ tenantId: tenant.id, exports, secrets: [] });
  });
});
