/**
 * TEN block 2.4: API credentials, tenant secret and sensitive fields (TEN-050 to TEN-063).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login and works on a tenant
 * it creates and deletes. The Administrator password the secret and the sensitive fields ask for is read by name inside the component;
 * wrong passwords are sent only against the suite's session, except TEN-062, which uses a GENERATED Administrator. TEN-059 and TEN-060 send
 * failed machine logins and wait out the address limiter (4 failures / 30 s) before they end. trace is off because the bodies carry
 * passwords and secrets.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

// The sensitive routes allow 10 calls per minute per address: the component waits for a free slot, so an ATC can take minutes.
test.describe.configure({ timeout: 360000 });

test.describe('TEN: API credentials, secret and sensitive fields', () => {
  test('TEN-050: should set valid API credentials', async ({ api }) => {
    await api.tenantManagement.setValidApiCredentials();
  });

  test('TEN-051: should validate the API password length', async ({ api }) => {
    await api.tenantManagement.validateApiPasswordLength();
  });

  test('TEN-052: should validate the API password complexity', async ({ api }) => {
    await api.tenantManagement.validateApiPasswordComplexity();
  });

  test('TEN-053: should validate the API user name', async ({ api }) => {
    await api.tenantManagement.validateApiUsername();
  });

  test('TEN-054: should generate an automatic secret', async ({ api }) => {
    await api.tenantManagement.generateAutomaticSecret();
  });

  test('TEN-055: should refuse a secret with a wrong Administrator password', async ({ api }) => {
    await api.tenantManagement.refuseSecretWithWrongAdminPassword();
  });

  test('TEN-056: should validate the custom secret length', async ({ api }) => {
    await api.tenantManagement.validateCustomSecretLength();
  });

  test('TEN-057: should validate the custom secret complexity', async ({ api }) => {
    await api.tenantManagement.validateCustomSecretComplexity();
  });

  test('TEN-058: should show the plain secret only once', async ({ api }) => {
    await api.tenantManagement.showPlainSecretOnlyOnce();
  });

  test('TEN-059: should revoke the secret', async ({ api }) => {
    await api.tenantManagement.revokeSecret();
  });

  test('TEN-060: should regenerate an active secret', async ({ api }) => {
    await api.tenantManagement.regenerateActiveSecret();
  });

  test('TEN-061: should reveal sensitive fields only with the Administrator password', async ({ api }) => {
    await api.tenantManagement.revealSensitiveFieldsOnlyWithAdminPassword();
  });

  test('TEN-063: should limit the API password reuse to the last five', async ({ api }) => {
    await api.tenantManagement.limitApiPasswordReuseToLastFive();
  });

  // Last on purpose: it sends 12 calls at once and leaves the limiter window full.
  test('TEN-062: should limit repeated wrong Administrator passwords', async ({ api }) => {
    await api.tenantManagement.limitRepeatedWrongAdminPasswords();
  });
});
