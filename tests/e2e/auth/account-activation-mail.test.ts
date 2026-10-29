/**
 * Activation of a real pending TenantAdmin through the mailed link: AUT-020, AUT-025.
 *
 * Each test builds its OWN pending account (generated tenant + TenantAdmin whose
 * welcome mail is read from the Mailtrap sandbox) because activation consumes it,
 * and removes it in `finally`. Tokens and passwords travel only as thunks or as the
 * masked `password` key. File-level trace off: tokenised pages must not be recorded.
 *
 * Rate limit: the `rl-auth` limiter (4 per 30 s per IP) is shared by activate AND
 * resend. AUT-020 spends 1 permit and AUT-025 spends 3 and then waits out the window
 * itself, so this file must stay away from the neighbours' window (specs run with
 * one worker; account-activation.test.ts spends 3 more permits).
 */

import type { PendingTenantAdmin } from '@steps/MailedAccountSteps';

import { DataFactory } from '@DataFactory';
import { MailedAccountSteps } from '@steps/MailedAccountSteps';
import { UiSessionSteps } from '@steps/UiSessionSteps';
import { test } from '@TestFixture';

test.use({ storageState: { cookies: [], origins: [] } });
test.use({ trace: 'off' });

test.describe('Account activation with the mailed link', () => {
  const mailed = new MailedAccountSteps();
  let account: PendingTenantAdmin;

  test.beforeEach(async () => {
    // Tenant + TenantAdmin creation (about 5 s, the mail is sent inside the call) + mail delivery
    test.setTimeout(120_000);
    account = await mailed.createPendingTenantAdmin();
  });

  test.afterEach(async () => {
    await mailed.cleanup();
  });

  test('AUT-020: should activate the account with the mailed token and let the user sign in', async ({ ui, page }) => {
    const password = DataFactory.createActivationPassword();
    const session = new UiSessionSteps({ page });
    let bodyPassed = false;
    try {
      await ui.activation.activateWithMailedToken({
        readToken: account.readActivationToken,
        password,
        signInAfter: async () => session.signInAsTenantUserAndReachLanding({ username: account.username, password }, /\/admin-panel$/),
      });
      bodyPassed = true;
    }
    finally {
      // Close the server session of the activated account (best-effort after a failure)
      await session.signOut(bodyPassed);
    }
  });

  test('AUT-025: should send a new mail on resend and reject the previous token', async ({ ui }) => {
    await ui.activation.resendActivationAndRejectOldToken({
      username: account.username,
      password: DataFactory.createActivationPassword(),
      readOldToken: account.readActivationToken,
      readNewToken: account.readResentActivationToken,
      waitForResentMail: account.waitForResentMail,
      waitForMailSlot: account.waitForMailSlot,
    });
  });
});
