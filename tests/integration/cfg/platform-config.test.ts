/**
 * CFG platform configuration: the contingency switch (CFG-001, 002, 004) and the global lockout threshold (CFG-005, 006, 007).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login (CFG-004
 * also one positive TenantAdmin login on its own session). The settings are GLOBAL: every ATC reads the original value, changes
 * it only inside its own body and puts it back before it ends (read-back checked). trace is off because the logins carry live tokens.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('CFG: platform configuration', () => {
  test('CFG-001: should read the contingency state', async ({ api }) => {
    await api.platformConfig.readContingencyState();
  });

  test('CFG-002: should switch the contingency and keep it persisted', async ({ api }) => {
    await api.platformConfig.switchContingencyAndKeepItPersisted();
  });

  test('CFG-004: should refuse the contingency to a TenantAdmin', async ({ api }) => {
    await api.platformConfig.refuseContingencyToTenantAdmin();
  });

  test('CFG-005: should read the global lockout threshold', async ({ api }) => {
    await api.platformConfig.readLockoutThreshold();
  });

  test('CFG-006: should update the lockout threshold to 1, 5 and 100', async ({ api }) => {
    await api.platformConfig.updateLockoutThreshold();
  });

  test('CFG-007: should reject a lockout threshold of 0, a negative number or text', async ({ api }) => {
    await api.platformConfig.rejectInvalidLockoutThresholds();
  });
});
