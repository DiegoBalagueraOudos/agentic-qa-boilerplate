/**
 * DIS devices: backend input validation at create (DIS-003 .. DIS-008).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login; two generated tenants (the second one for the cross-tenant serial row), their
 * branches and a pool of terminals are created in `beforeAll` on demand and deleted in `afterAll`.
 * trace is off because those logins carry live tokens. A terminal holds one device, so every row asks for
 * a fresh terminal; every device an ATC creates is deleted before it ends.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('DIS: device input validation', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;
  let branchId = 0;
  let otherTenantId = 0;
  let otherBranchId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
    branchId = (await data.prepareBranch(tenantId)).id;
    otherTenantId = await data.prepareTenant();
    otherBranchId = (await data.prepareBranch(otherTenantId)).id;
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  const scope = () => ({ tenantId, newTerminal: async () => data.prepareTerminal(tenantId, branchId) });

  test('DIS-003: should reject a missing, unknown or inactive terminal', async ({ api }) => {
    await api.devices.rejectMissingTerminal({ scope: scope(), inactiveTerminal: async () => data.prepareInactiveTerminal(tenantId, branchId) });
  });

  test('DIS-004: should reject invalid device codes', async ({ api }) => {
    await api.devices.rejectInvalidDeviceCodes(scope());
  });

  test('DIS-005: should reject a duplicate device code', async ({ api }) => {
    await api.devices.rejectDuplicateDeviceCode(scope());
  });

  test('DIS-006: should reject invalid serial numbers', async ({ api }) => {
    await api.devices.rejectInvalidSerials(scope());
  });

  test('DIS-007: should keep the serial unique and one device per terminal', async ({ api }) => {
    await api.devices.enforceUniqueSerialAndOneDevicePerTerminal({
      scope: scope(),
      other: { tenantId: otherTenantId, newTerminal: async () => data.prepareTerminal(otherTenantId, otherBranchId) },
    });
  });

  test('DIS-008: should reject a device name over 150 characters', async ({ api }) => {
    await api.devices.rejectOversizedDeviceName(scope());
  });
});
