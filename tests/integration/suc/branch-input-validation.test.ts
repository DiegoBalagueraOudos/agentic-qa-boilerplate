/**
 * SUC branches: backend input validation at create (SUC-003, 004, 005).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one
 * positive Administrator login; the generated tenant is prepared in `beforeAll` (one more login)
 * and deleted in `afterAll`. trace is off because those logins carry live tokens. Every branch an
 * ATC creates (including any row the product wrongly accepts) is deleted before it ends.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('SUC: branch input validation', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('SUC-003: should reject invalid branch codes', async ({ api }) => {
    await api.branches.rejectInvalidBranchCodes(tenantId);
  });

  test('SUC-004: should reject invalid branch names', async ({ api }) => {
    await api.branches.rejectInvalidBranchNames(tenantId);
  });

  test('SUC-005: should reject an oversized address and department', async ({ api }) => {
    await api.branches.rejectOversizedAddressAndDepartment(tenantId);
  });
});
