/**
 * Login pilot (admin mode): AUT-001, AUT-002, AUT-006, AUT-007.
 *
 * Cases live in .context/QA/cases/AUT/. The e2e project loads a signed-in
 * storage state by default; these cases need a signed-out browser, so the file
 * starts from an empty one.
 */

import { DataFactory } from '@DataFactory';
import { test } from '@TestFixture';
import { config } from '@variables';

// File-level trace off: the trace records the arguments of fill/evaluate, which carry a real credential.
test.use({ trace: 'off' });

test.describe('Login (admin mode)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ ui }) => {
    await ui.login.goto();
  });

  test('AUT-001: should show the mode selector and then the admin form', async ({ ui }) => {
    await ui.login.showModeSelectorAndAdminForm();
  });

  test('AUT-002: should sign in the administrator and land on the dashboard', { tag: ['@critical'] }, async ({ ui }) => {
    await ui.login.loginAsAdminSuccessfully({
      username: config.testUser.email,
      password: config.testUser.password,
    });
  });

  test('AUT-006: should reject an empty user and password on the client', async ({ ui }) => {
    await ui.login.submitEmptyAdminForm();
  });

  test('AUT-007: should reject wrong credentials with a generic message', async ({ ui }) => {
    // A user that does not exist: a wrong password against the real administrator
    // would count toward that account's lockout.
    const { email, password } = DataFactory.createCredentials();
    await ui.login.loginAsAdminWithInvalidCredentials({ username: email, password });
  });
});
