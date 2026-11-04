/**
 * LOG-013: the log database (Mongo) is down.
 *
 * Needs the USER to stop Mongo before the run and start it again after. While Mongo answers, the test is skipped (not failed), so
 * the regular runs are unaffected. Run it alone: `bun run test tests/integration/log/log-mongo-down.test.ts`. The log query hangs for
 * about 40 s when Mongo is down, so the timeout is 3 minutes. trace is off because the login carries live tokens.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe.configure({ timeout: 180000 });

test.describe('LOG: log database down', () => {
  test('LOG-013: should keep the application stable with the log database down', async ({ api }) => {
    test.skip(!(await api.logs.isLogDatabaseDown()), 'Mongo answers: stop it before running this case');
    await api.logs.keepApplicationStableWithLogDatabaseDown();
  });
});
