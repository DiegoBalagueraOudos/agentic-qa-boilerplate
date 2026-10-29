/**
 * Forced password change of a pending TenantAdmin: AUT-005, AUT-027.
 *
 * Both cases share ONE pending account created in `beforeAll` through the
 * Administrator API (generated tenant + generated TenantAdmin whose welcome mail
 * is read from the Mailtrap sandbox) and removed in `afterAll`. Signing in does
 * not consume the pending state, so each test makes its own login. Positive
 * logins only. The temporary password is read through a thunk right before the
 * login and only travels as the flat `password` field (masked in step titles).
 *
 * The sessions of these tests end on /change-password, which has no shell and
 * so no sign-out button: the account is deleted in `afterAll` instead. File-level
 * trace off: the browser context holds a live session cookie.
 */

import type { PendingTenantAdmin } from '@steps/MailedAccountSteps';

import { MailedAccountSteps } from '@steps/MailedAccountSteps';
import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';

test.use({ storageState: { cookies: [], origins: [] } });
test.use({ trace: 'off' });

test.describe('Forced password change (pending TenantAdmin)', () => {
  const mailed = new MailedAccountSteps();
  let account: PendingTenantAdmin;

  test.beforeAll(async () => {
    // Tenant + TenantAdmin creation (about 5 s, the mail is sent inside the call) + mail delivery
    test.setTimeout(120_000);
    account = await mailed.createPendingTenantAdmin();
  });

  test.afterAll(async () => {
    await mailed.cleanup();
  });

  test('AUT-005: should redirect a TenantAdmin with a temporary password to /change-password', async ({ ui }) => {
    await ui.login.goto();
    await ui.login.redirectMustChangePasswordTenantAdmin({
      username: account.username,
      password: await account.readTemporaryPassword(),
    });
  });

  test('AUT-027: should keep the user on /change-password when navigating to other routes', async ({ ui, page }) => {
    let bodyPassed = false;
    try {
      await new UiSessionSteps({ page }).signInAsTenantUserAndReachLanding(
        { username: account.username, password: await account.readTemporaryPassword() },
        /\/change-password$/,
      );
      await ui.activation.keepForcedChangePasswordOnNavigation();
      bodyPassed = true;
    }
    finally {
      // A pass ends on /change-password (no shell, nothing to close). After a failure the app may
      // have loaded the panel: close that server session best-effort, never masking the failure.
      if (!bodyPassed) {
        await new UiSessionSteps({ page }).signOut(false);
      }
    }
  });
});
