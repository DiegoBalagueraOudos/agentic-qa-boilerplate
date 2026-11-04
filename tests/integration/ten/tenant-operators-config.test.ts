/**
 * TEN block 2.5: operators and configuration (TEN-070 to TEN-075).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login, and works on a
 * tenant (and generated operators) that it creates and deletes. trace is off because the logins carry live tokens.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TEN: operators and configuration', () => {
  test('TEN-070: should assign the main and the contingency operator', async ({ api }) => {
    await api.tenantManagement.assignMainAndContingencyOperators();
  });

  test('TEN-071: should clear the contingency operator', async ({ api }) => {
    await api.tenantManagement.clearContingencyOperator();
  });

  test('TEN-072: should reject operators that do not exist or were deleted', async ({ api }) => {
    await api.tenantManagement.rejectUnavailableOperators();
  });

  test('TEN-073: should switch the MAC-serial validation on and off', async ({ api }) => {
    await api.tenantManagement.toggleMacSerialValidation();
  });

  test('TEN-074: should persist the lockout parameters', async ({ api }) => {
    await api.tenantManagement.persistLockoutParameters();
  });

  test('TEN-075: should persist the finger and location options', async ({ api }) => {
    await api.tenantManagement.persistFingerAndLocationOptions();
  });
});
