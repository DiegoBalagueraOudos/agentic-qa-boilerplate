/**
 * SUC branches: dependency rules on deactivate and delete (SUC-009, 010).
 *
 * Mail-free: a generated tenant has no TenantAdmin. Empty storage state: each ATC opens its own
 * crypto session and spends one positive Administrator login; the generated tenant is prepared in
 * `beforeAll` (one more login) and deleted in `afterAll`. trace is off because those logins carry
 * live tokens. Each ATC hands its branch to the steps class, which also owns the terminal and removes
 * terminal, branch and tenant in that order (a branch with an active terminal cannot be deleted).
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('SUC: branch dependencies', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  const wiring = () => ({
    tenantId,
    track: (branchId: number) => data.trackBranch(tenantId, branchId),
    addTerminal: async (branchId: number) => data.prepareTerminal(tenantId, branchId),
    deactivateTerminal: async (terminalId: number) => data.deactivateTerminal(tenantId, terminalId),
    readTerminal: async (terminalId: number) => data.readTerminal(tenantId, terminalId),
  });

  test('SUC-009: should refuse to deactivate a branch with active terminals', async ({ api }) => {
    await api.branches.refuseDeactivatingBranchWithActiveTerminals(wiring());
  });

  test('SUC-010: should delete a branch softly without leaving orphans', async ({ api }) => {
    await api.branches.deleteBranchSoftlyWithoutOrphans(wiring());
  });
});
