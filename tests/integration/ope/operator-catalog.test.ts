/**
 * OPE operators catalog: create and edit (OPE-002, 007).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one
 * positive Administrator login. trace is off because that login carries live tokens. The
 * catalog is GLOBAL: each ATC creates its own `QAX` operator and deletes it before it ends.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('OPE: operator catalog create and edit', () => {
  test('OPE-002: should create an operator with code, name and URL', async ({ api }) => {
    await api.operators.createOperatorWithCodeNameAndUrl();
  });

  test('OPE-007: should edit name and URL and keep the code', async ({ api }) => {
    await api.operators.editNameAndUrlKeepingCode();
  });
});
