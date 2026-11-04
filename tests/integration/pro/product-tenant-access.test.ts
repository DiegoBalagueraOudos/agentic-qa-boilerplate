/**
 * PRO-011: a TenantAdmin sees only the products of its own tenant.
 *
 * The real TenantAdmin (`config.tenantAdminUser`, read inside the component) does ONE positive login on its
 * own session (empty storage state) and signs out; no failed login is sent. The foreign tenant is generated
 * and deleted by the steps class. Mail-free. trace off: the tenant login issues live session cookies.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('PRO: product tenant access', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('PRO-011: should show a TenantAdmin only the products of its own tenant', async ({ api }) => {
    await api.products.listOnlyOwnTenantProductsAsTenantAdmin({ foreignTenantId: tenantId });
  });
});
