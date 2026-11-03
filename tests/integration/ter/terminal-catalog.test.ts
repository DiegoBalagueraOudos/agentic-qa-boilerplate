/**
 * TER terminals: catalog list, create and edit (TER-001, 002, 013).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login; the generated tenant and its two branches are prepared in `beforeAll` (one more
 * login) and deleted in `afterAll`. trace is off because those logins carry live tokens. Rows are scoped by
 * a per-ATC token; TER-001 hands its terminals to the steps class because one of them has a device.
 */

import type { GeneratedBranch } from '@steps/BranchDataSteps';

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TER: terminal catalog', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;
  let first: GeneratedBranch;
  let second: GeneratedBranch;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
    first = await data.prepareBranch(tenantId);
    second = await data.prepareBranch(tenantId);
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('TER-001: should list terminals with their branch and device count', async ({ api }) => {
    await api.terminals.listTerminalsWithBranchAndDevicesCount({
      tenantId,
      branches: [first, second],
      track: terminalId => data.trackTerminal(tenantId, terminalId),
      addDevice: async (terminalId) => {
        await data.prepareDevice(tenantId, terminalId);
      },
    });
  });

  test('TER-002: should create a terminal with branch, name, MAC and type', async ({ api }) => {
    await api.terminals.createTerminalWithBranchNameMacAndType({ tenantId, branchId: first.id, branchName: first.name });
  });

  test('TER-013: should edit a terminal and change its branch', async ({ api }) => {
    await api.terminals.editTerminalAndChangeBranch({ tenantId, branchId: first.id, secondBranchId: second.id });
  });
});
