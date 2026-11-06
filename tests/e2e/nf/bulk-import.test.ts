/**
 * NF-02: a CSV import of more than one batch (1,001 rows = batches of 500, 500 and 1) from the tenant detail modal.
 *
 * A GENERATED tenant is prepared in `beforeAll`. The file holds three bad rows on purpose: an empty code in batch 1, a duplicate of a
 * batch-1 code inside batch 2 and an invalid department in the last, single-row batch. The `Fila` values are computed from the data
 * (header = row 1). `afterAll` deletes the imported branches (100 at a time) and then the tenant. The spec keeps the saved
 * Administrator session. File-level trace off.
 */

import type { UiTenant } from '@steps/UiTenantSteps';

import { DataFactory } from '@DataFactory';
import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

const ROWS = 1001;
const MAX_SECONDS = 60;

test.describe('Non-functional: large CSV import', () => {
  const tenants = new UiTenantSteps();
  const token = DataFactory.createBranchCodeOfLength(9).slice(3);
  const term = `QAX${token}`;
  let tenant: UiTenant;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      tenant = await tenants.prepareTenant();
    }
    catch (error) {
      await tenants.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    test.setTimeout(900000);
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

  test('NF-02: should import a large CSV in batches with the errors per row', async ({ ui }) => {
    test.setTimeout(240000);
    const row = (n: number, overrides: { code?: string, department?: string } = {}) => ({
      code: overrides.code ?? `${term}${n}`,
      name: `${term} Sede ${n}`,
      address: `Calle ${n}`,
      department: overrides.department ?? DataFactory.validDepartment,
    });
    const rows = Array.from({ length: ROWS }, (_, index) => row(index + 1));
    rows[5] = row(6, { code: '' });
    rows[519] = row(520, { code: `${term}10` });
    rows[ROWS - 1] = row(ROWS, { department: 'Narnia' });

    await ui.bulkImport.importLargeBranchFileWithRowErrors({
      tenantId: tenant.id,
      file: { name: 'sedes-grande.csv', content: DataFactory.createBranchCsv(rows) },
      expected: { total: ROWS, imported: ROWS - 3, errorRows: [7, 521, ROWS + 1] },
      maxSeconds: MAX_SECONDS,
      countImported: async () => tenants.totalOf(`/tenants/${tenant.id}/branches?SearchTerm=${term}&PageSize=1`),
    });
  });
});
