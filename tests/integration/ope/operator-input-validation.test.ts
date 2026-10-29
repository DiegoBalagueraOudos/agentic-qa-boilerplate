/**
 * OPE operators catalog: backend input validation at create (OPE-003, 004, 005, 006).
 *
 * Mail-free: no operator endpoint sends mail. Empty storage state: each ATC opens its own
 * crypto session and spends one positive Administrator login. trace is off because that
 * login carries live tokens. The catalog is GLOBAL: every ATC creates its own `QAX` operators
 * and deletes them (including any row the product wrongly accepts) before it ends.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('OPE: operator input validation', () => {
  test('OPE-003: should reject invalid operator codes', async ({ api }) => {
    await api.operators.rejectInvalidOperatorCodes();
  });

  test('OPE-004: should reject a duplicate operator code', async ({ api }) => {
    await api.operators.rejectDuplicateOperatorCode();
  });

  test('OPE-005: should reject invalid operator names', async ({ api }) => {
    await api.operators.rejectInvalidOperatorNames();
  });

  test('OPE-006: should reject invalid service URLs', async ({ api }) => {
    await api.operators.rejectInvalidServiceUrls();
  });
});
