/**
 * USR platform users: list, create, edit, password change, deactivation and delete (USR-001, 002, 007, 008).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session (one positive root Administrator login) and
 * signs in with GENERATED Admins in their own request contexts (at most two refused sign-ins per ATC, then the address
 * limiter window is waited out). trace is off because those logins carry live tokens.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('USR: platform user catalog', () => {
  test('USR-001: should list, search and filter platform users', async ({ api }) => {
    await api.users.listAdminsWithSearchAndState();
  });

  test('USR-002: should create a platform user with a corporate e-mail', async ({ api }) => {
    await api.users.createAdminWithCorporateEmail();
  });

  test('USR-007: should edit a user and change the password', async ({ api }) => {
    test.setTimeout(120000);
    await api.users.editAdminAndChangePassword();
  });

  test('USR-008: should refuse the sign-in of an inactive or deleted user', async ({ api }) => {
    test.setTimeout(120000);
    await api.users.refuseSignInOfInactiveAndDeletedAdmin();
  });
});
