/**
 * DIS devices: catalog list, create, edit, deactivate and delete (DIS-001, 002, 009).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login; the generated tenant, two branches and six terminals are prepared in `beforeAll`
 * (one more login) and deleted in `afterAll`. trace is off because those logins carry live tokens. Every device
 * an ATC creates is deleted before it ends; the steps class removes terminals, branches and the tenant.
 */

import type { GeneratedTerminal } from '@steps/BranchDataSteps';

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('DIS: device catalog', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;
  let terminals: GeneratedTerminal[] = [];

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
    const first = await data.prepareBranch(tenantId);
    const second = await data.prepareBranch(tenantId);
    terminals = [
      await data.prepareNamedTerminal(tenantId, first),
      await data.prepareNamedTerminal(tenantId, second),
      await data.prepareNamedTerminal(tenantId, first),
      await data.prepareNamedTerminal(tenantId, first),
      await data.prepareNamedTerminal(tenantId, second),
      await data.prepareNamedTerminal(tenantId, first),
    ];
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('DIS-001: should list devices with their terminal and branch', async ({ api }) => {
    await api.devices.listDevicesWithTerminalAndBranch({ tenantId, terminals: [terminals[0], terminals[1]] });
  });

  test('DIS-002: should create a device with terminal, code and serial', async ({ api }) => {
    await api.devices.createDeviceWithTerminalCodeAndSerial({ tenantId, terminal: terminals[2] });
  });

  test('DIS-009: should edit, deactivate and delete a device', async ({ api }) => {
    await api.devices.editDeactivateAndDeleteDevice({ tenantId, terminals: [terminals[3], terminals[4], terminals[5]] });
  });
});
