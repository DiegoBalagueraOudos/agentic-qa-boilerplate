/**
 * TER terminals: dependency rules on deactivate and delete (TER-014, 015).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login; the generated tenant and branch are prepared in `beforeAll` (one more login) and
 * deleted in `afterAll`. trace is off because those logins carry live tokens. Each ATC hands its terminals
 * to the steps class, which also owns the devices and removes device, terminal, branch and tenant in that order.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TER: terminal dependencies', () => {
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

  const wiring = () => ({
    tenantId,
    branchId,
    track: (terminalId: number) => data.trackTerminal(tenantId, terminalId),
    addDevice: async (terminalId: number) => data.prepareDevice(tenantId, terminalId),
    deactivateDevice: async (deviceId: number) => data.deactivateDevice(tenantId, deviceId),
    readDevice: async (deviceId: number) => data.readDevice(tenantId, deviceId),
  });

  test('TER-014: should refuse to deactivate a terminal with an active device', async ({ api }) => {
    await api.terminals.refuseDeactivatingTerminalWithActiveDevice(wiring());
  });

  test('TER-015: should delete a terminal softly', async ({ api }) => {
    await api.terminals.deleteTerminalSoftly({
      ...wiring(),
      newBranch: async () => (await data.prepareBranch(tenantId)).id,
      deleteBranch: async newBranchId => data.deleteBranch(tenantId, newBranchId),
    });
  });
});
