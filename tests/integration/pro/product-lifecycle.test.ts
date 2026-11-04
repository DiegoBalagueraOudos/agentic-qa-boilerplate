/**
 * PRO products: catalog and lifecycle (PRO-001 list and search, PRO-007 edit, PRO-008 status).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login; two generated tenants are prepared in `beforeAll` (the second one proves a tenant's
 * products do not show in another's list) and deleted in `afterAll`. trace is off because those logins
 * carry live tokens. Every product an ATC creates is deleted before it ends.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('PRO: product lifecycle', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;
  let otherTenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
    otherTenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('PRO-001: should list the products of a tenant with search and paging', async ({ api }) => {
    await api.products.listProductsWithSearchAndPaging({ tenantId, otherTenantId });
  });

  test('PRO-007: should edit the name but never the code', async ({ api }) => {
    await api.products.editProductNameButNotCode(tenantId);
  });

  test('PRO-008: should change the status keeping the flags coherent', async ({ api }) => {
    await api.products.changeProductStatusKeepingFlagsCoherent(tenantId);
  });
});
