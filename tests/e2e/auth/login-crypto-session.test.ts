/**
 * Login with an expired crypto session: AUT-038.
 *
 * The expiry is simulated by rewriting `X-Session-Id` of the first login call to
 * an unknown id; the backend answers 401 `CRYPTO_SESSION_EXPIRED`. Credentials are
 * generated and non-existent (the real account is never sent). The ATC waits out
 * the address limiter window in a `finally`. HAL-51: the SPA is expected to
 * show "Credenciales incorrectas" today, so this test is expected to fail until
 * the defect is fixed.
 * File-level trace off: keep request headers out of trace archives.
 */

import { DataFactory } from '@DataFactory';
import { test } from '@TestFixture';

test.use({ storageState: { cookies: [], origins: [] } });
test.use({ trace: 'off' });

test.describe('Login with an expired crypto session', () => {
  test('AUT-038: should ask to repeat the action instead of showing wrong credentials', async ({ ui }) => {
    test.setTimeout(90000);
    await ui.login.goto();
    const { email, password } = DataFactory.createCredentials();
    await ui.login.retryAfterCryptoSessionExpired({ username: email, password });
  });
});
