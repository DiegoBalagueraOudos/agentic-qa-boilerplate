/**
 * CON-005: the backend restarts with an open session. It needs the USER to restart the backend while the test waits, so it is skipped
 * unless QA_BACKEND_RESTART=1 is set; the regular runs never wait. Run it alone, in a terminal:
 *   set QA_BACKEND_RESTART=1 && bun run test tests/integration/concurrency/backend-restart.test.ts
 * and, when the test prints "RESTART THE BACKEND NOW", run `docker restart validate-backend` in another terminal.
 * Empty storage state; trace is off because the login carries live tokens.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe.configure({ timeout: 360000 });

test.describe('CON: backend restart', () => {
  test('CON-005: should recover the session after a backend restart', async ({ api }) => {
    test.skip(process.env.QA_BACKEND_RESTART?.trim() !== '1', 'Set QA_BACKEND_RESTART=1 and restart the backend when the test asks');
    await api.concurrency.recoverSessionAfterBackendRestart();
  });
});
