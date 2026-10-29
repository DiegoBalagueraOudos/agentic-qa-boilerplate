/**
 * Account activation screen (/activate): AUT-021, AUT-022, AUT-023, AUT-024, AUT-026.
 *
 * Cases live in .context/QA/cases/AUT/. Activation tokens are generated fakes
 * and the email is generated and non-existent, so nothing touches a real account
 * and no mail is sent. The e2e project loads a signed-in storage state by
 * default; this screen is opened signed out, so the file starts from an empty one.
 */

import { DataFactory } from '@DataFactory';
import { test } from '@TestFixture';

test.use({ storageState: { cookies: [], origins: [] } });
test.use({ trace: 'off' });

test.describe('Account activation', () => {
  test('AUT-021: should hide the token field and call the activation endpoint with the URL link', async ({ ui }) => {
    await ui.activation.openActivationLinkWithToken({
      token: DataFactory.createFakeActivationToken(),
      password: DataFactory.createActivationPassword(),
    });
  });

  test('AUT-022: should reject an invalid token and not activate the account', async ({ ui }) => {
    await ui.activation.activateWithInvalidToken({
      token: DataFactory.createFakeActivationToken(),
      password: DataFactory.createActivationPassword(),
    });
  });

  test('AUT-023: should show the password rule message per weak password', async ({ ui }) => {
    await ui.activation.rejectWeakPasswords();
  });

  test('AUT-024: should show a mismatch error when the confirmation differs', async ({ ui }) => {
    await ui.activation.rejectMismatchedConfirmation({
      token: DataFactory.createFakeActivationToken(),
      password: DataFactory.createActivationPassword(),
    });
  });

  test('AUT-026: should answer generically when resending to an unknown email', async ({ ui }) => {
    await ui.activation.resendActivationForUnknownUser();
  });
});
