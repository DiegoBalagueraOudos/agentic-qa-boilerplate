/**
 * USR platform users: backend input validation at create and edit (USR-003 .. USR-006).
 *
 * Mail-free (platform Admins receive no mail). Empty storage state: each ATC opens its own crypto session and spends
 * one positive root Administrator login; only GENERATED Admins are created and every one is deleted before the ATC ends
 * (including any row the product wrongly accepts). USR-006 signs in once with a generated Admin. trace is off because
 * those logins carry live tokens and the payloads carry passwords.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('USR: platform user input validation', () => {
  test('USR-003: should reject personal e-mail domains', async ({ api }) => {
    await api.users.rejectPersonalEmailDomains();
  });

  test('USR-004: should reject invalid and duplicate e-mails', async ({ api }) => {
    await api.users.rejectInvalidAndDuplicateEmails();
  });

  test('USR-005: should reject names outside 3 to 100 characters', async ({ api }) => {
    await api.users.rejectInvalidNameLengths();
  });

  test('USR-006: should reject weak passwords at create and at edit', async ({ api }) => {
    await api.users.rejectWeakPasswords();
  });
});
