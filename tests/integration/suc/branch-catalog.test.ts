/**
 * SUC branches: catalog list, create, duplicates, cross-tenant codes and edit (SUC-001, 002, 006, 007, 008).
 *
 * Mail-free: a generated tenant has no TenantAdmin. Empty storage state: each ATC opens its own
 * crypto session and spends one positive Administrator login; the two generated tenants are
 * prepared in `beforeAll` (one more login) and deleted in `afterAll`. trace is off because those
 * logins carry live tokens. Rows are scoped by a per-ATC token, so the shared tenant stays clean;
 * SUC-001 hands its branches to the steps class because one of them has a terminal.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('SUC: branch catalog', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;
  let secondTenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
    secondTenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('SUC-001: should list branches with search and paging', async ({ api }) => {
    await api.branches.listBranchesWithSearchAndPaging({
      tenantId,
      track: branchId => data.trackBranch(tenantId, branchId),
      addTerminal: async (branchId) => {
        await data.prepareTerminal(tenantId, branchId);
      },
    });
  });

  test('SUC-002: should create a branch with a valid code and name', async ({ api }) => {
    await api.branches.createBranchWithValidCodeAndName(tenantId);
  });

  test('SUC-006: should reject a duplicate branch code in the same tenant', async ({ api }) => {
    await api.branches.rejectDuplicateBranchCode(tenantId);
  });

  test('SUC-007: should allow the same branch code in different tenants', async ({ api }) => {
    await api.branches.allowSameCodeInDifferentTenants({ tenantId, secondTenantId });
  });

  test('SUC-008: should edit name, address and department', async ({ api }) => {
    await api.branches.editNameAddressAndDepartment(tenantId);
  });
});
