/**
 * SUC-012: a TenantAdmin of another tenant is refused on every branch route of a tenant that is not its own.
 *
 * The real TenantAdmin (`config.tenantAdminUser`, read inside the component) does ONE positive login on
 * its own session (empty storage state) and signs out; no failed login is sent. The target tenant and branch
 * are generated and read back as the Administrator by the steps class, so "unchanged" is judged from the
 * server. Mail-free.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

// trace off (top-level: Playwright forbids it in a describe): the tenant login issues live
// session cookies that must not end up in a trace.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('SUC: branch tenant access', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;
  let branchId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
    branchId = (await data.prepareBranch(tenantId)).id;
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('SUC-012: should refuse a TenantAdmin of another tenant on the branch routes', async ({ api }) => {
    await api.branches.refuseBranchAccessToOtherTenantAdmin({
      foreignTenantId: tenantId,
      target: { id: branchId },
      readTarget: async () => data.readBranch(tenantId, branchId),
      trackCreated: createdId => data.trackBranch(tenantId, createdId),
    });
  });
});
