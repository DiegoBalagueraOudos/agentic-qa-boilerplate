/**
 * SUC branches: CSV import (SUC-011).
 *
 * Mail-free: a generated tenant has no TenantAdmin. Empty storage state: the ATC opens its own
 * crypto session and spends one positive Administrator login; the generated tenant is prepared in
 * `beforeAll` (one more login) and deleted in `afterAll`. trace is off because those logins carry
 * live tokens. The upload is multipart (not encrypted) and the files are built in memory.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('SUC: branch CSV import', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('SUC-011: should import branches from CSV and report per-row errors', async ({ api }) => {
    await api.branches.importBranchesFromCsv(tenantId);
  });
});
