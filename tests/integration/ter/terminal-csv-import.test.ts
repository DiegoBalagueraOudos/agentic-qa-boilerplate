/**
 * TER terminals: CSV import (TER-016).
 *
 * Mail-free. Empty storage state: the ATC opens its own crypto session and spends one positive
 * Administrator login; the generated tenant and branch are prepared in `beforeAll` (one more login) and
 * deleted in `afterAll`. trace is off because those logins carry live tokens. The upload is multipart
 * (not encrypted) and the files are built in memory.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TER: terminal CSV import', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;
  let branch = { id: 0, code: '', name: '' };

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
    branch = await data.prepareBranch(tenantId);
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('TER-016: should import terminals from CSV and report per-row errors', async ({ api }) => {
    await api.terminals.importTerminalsFromCsv({ tenantId, branchId: branch.id, branchCode: branch.code });
  });
});
