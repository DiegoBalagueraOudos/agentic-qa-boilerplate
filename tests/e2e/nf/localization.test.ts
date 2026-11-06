/**
 * NF-08: accents and `ñ` through the Sedes tab, the exported CSV and a UTF-8 import, plus the creation date in two browser zones.
 *
 * A GENERATED tenant with four accented branches (created through the API) is prepared in `beforeAll`; the branches the import adds
 * and the tenant are removed in `afterAll`. The spec keeps the saved Administrator session. File-level trace off.
 */

import type { UiTenant } from '@steps/UiTenantSteps';

import type { AccentBranch } from '@ui/LocalePage';

import { DataFactory } from '@DataFactory';
import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Non-functional: localization', () => {
  const tenants = new UiTenantSteps();
  const token = DataFactory.createBranchCodeOfLength(9).slice(3);
  const term = `QAX${token}`;
  const branches: AccentBranch[] = [
    { name: `${term} Sede Peñón`, address: 'Calle 5 Nº 12-34 Apartadó', department: 'Atlántico' },
    { name: `${term} Sede Ñandú Bogotá`, address: 'Carrera 7 Nº 45-10 Chía', department: 'Bogotá D.C.' },
    { name: `${term} Sede Café Cúcuta`, address: 'Avenida 3 Nº 8-21 Pamplona', department: 'Nariño' },
    { name: `${term} Sede Üxmal Ibagué`, address: 'Diagonal 12 Nº 1-05 Armenia', department: 'Quindío' },
  ];
  let tenant: UiTenant;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      tenant = await tenants.prepareTenant();
      for (const [index, branch] of branches.entries()) {
        await tenants.addBranch(tenant.id, { BranchCode: `${term}${index + 1}`, BranchName: branch.name, Address: branch.address, Department: branch.department });
      }
    }
    catch (error) {
      await tenants.removeBranches(tenant?.id ?? 0, term).catch(() => undefined);
      await tenants.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    const failures: string[] = [];
    try {
      await tenants.removeBranches(tenant.id, term);
    }
    catch (error) {
      failures.push(String((error as Error).message).split('\n')[0]);
    }
    try {
      await tenants.cleanup();
    }
    catch (error) {
      failures.push(String((error as Error).message).split('\n')[0]);
    }
    if (failures.length > 0) {
      throw new Error(`cleanup incomplete: ${failures.join('; ')}`);
    }
  });

  test('NF-08: should keep accents and dates right', async ({ ui }) => {
    test.setTimeout(180000);
    const imported = [
      { code: `${term}I1`, name: `${term} Importada Cañón Ñoño`, address: 'Calle 9 Nº 3-3 Sogamoso', department: 'Boyacá' },
      { code: `${term}I2`, name: `${term} Importada Córdoba Montería`, address: 'Carrera 2 Nº 6-7 Lorica', department: 'Córdoba' },
    ];
    await ui.locale.showAccentsAndDatesCorrectly({
      tenant,
      branches,
      importFile: { name: 'sedes-tildes.csv', content: DataFactory.createBranchCsv(imported), names: imported.map(item => item.name) },
      readNames: async search => (await tenants.branchRows(tenant.id, search)).map(branch => branch.BranchName),
      createdAt: await tenants.createdAtOf(tenant.id),
      zones: ['America/Bogota', 'Pacific/Auckland'],
    });
  });
});
