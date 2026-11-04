/**
 * DAT data integrity: soft delete (DAT-001), operator references (DAT-002), credential history (DAT-004) and seeded base data (DAT-005).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login. The ATCs
 * create and delete their own tenants, Administrators and operators (DAT-001 leaves them soft-deleted, which is what it proves).
 * trace is off because the logins carry live tokens and DAT-004 sends API passwords and secrets.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('DAT: data integrity', () => {
  test('DAT-001: should keep soft-deleted tenants and Administrators as history', async ({ api }) => {
    await api.dataIntegrity.keepSoftDeletedTenantsAndAdministrators();
  });

  test('DAT-002: should refuse operator references that do not exist', async ({ api }) => {
    await api.dataIntegrity.refuseOperatorReferencesThatDoNotExist();
  });

  test('DAT-004: should record the API password and secret history', async ({ api }) => {
    await api.dataIntegrity.recordApiPasswordAndSecretHistory();
  });

  test('DAT-005: should have the seeded root user and roles', async ({ api }) => {
    await api.dataIntegrity.haveSeededRootUserAndRoles();
  });
});
