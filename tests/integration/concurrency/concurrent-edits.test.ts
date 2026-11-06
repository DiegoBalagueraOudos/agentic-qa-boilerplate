/**
 * CON-001: two simultaneous edits of the same operator.
 *
 * Mail-free. Empty storage state: the ATC opens its own crypto session, spends one positive Administrator login, creates an operator
 * and deletes it before it ends. trace is off because the login carries live tokens.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('CON: concurrent edits', () => {
  test('CON-001: should refuse simultaneous edits of the same operator', async ({ api }) => {
    await api.concurrency.refuseSimultaneousEditsOfTheSameOperator();
  });
});
