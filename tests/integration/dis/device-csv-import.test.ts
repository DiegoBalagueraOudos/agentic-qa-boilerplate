/**
 * DIS devices: CSV import (DIS-010).
 *
 * Mail-free. Empty storage state: the ATC opens its own crypto session and spends one positive
 * Administrator login; the generated tenant, branch and eight terminals (the import finds them by NAME) are
 * prepared in `beforeAll` (one more login) and deleted in `afterAll`. trace is off because those logins carry
 * live tokens. The upload is multipart (not encrypted) and the files are built in memory.
 */

import type { GeneratedTerminal } from '@steps/BranchDataSteps';

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('DIS: device CSV import', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;
  const terminals: GeneratedTerminal[] = [];

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
    const branch = await data.prepareBranch(tenantId);
    for (let index = 0; index < 8; index++) {
      terminals.push(await data.prepareNamedTerminal(tenantId, branch));
    }
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('DIS-010: should import devices from CSV and report per-row errors', async ({ api }) => {
    await api.devices.importDevicesFromCsv({ tenantId, terminals });
  });
});
