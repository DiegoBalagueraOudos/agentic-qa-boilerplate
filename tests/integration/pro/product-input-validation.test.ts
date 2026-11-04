/**
 * PRO products: backend input validation at create (PRO-002 to PRO-006) and refused statuses (PRO-009).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login; the generated tenant is prepared in `beforeAll` (one more login) and deleted in
 * `afterAll`. trace is off because those logins carry live tokens. Every product an ATC creates
 * (including any row the product wrongly accepts) is deleted before it ends.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('PRO: product input validation', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('PRO-002: should create a product with a name and a 7-character code', async ({ api }) => {
    await api.products.createProductWithNameAndCode(tenantId);
  });

  test('PRO-003: should reject product codes of 6 and 8 characters', async ({ api }) => {
    await api.products.rejectProductCodesOfWrongLength(tenantId);
  });

  test('PRO-004: should reject product codes with spaces or symbols', async ({ api }) => {
    await api.products.rejectProductCodesWithSpacesOrSymbols(tenantId);
  });

  test('PRO-005: should reject a duplicate product code', async ({ api }) => {
    await api.products.rejectDuplicateProductCode(tenantId);
  });

  test('PRO-006: should reject an empty name and one over the limit', async ({ api }) => {
    await api.products.rejectInvalidProductNames(tenantId);
  });

  test('PRO-009: should reject an invalid product status', async ({ api }) => {
    await api.products.rejectInvalidProductStatuses(tenantId);
  });
});
