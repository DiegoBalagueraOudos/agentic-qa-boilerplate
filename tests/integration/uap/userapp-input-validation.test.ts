/**
 * UAP UserApps: backend input validation at create (UAP-002 .. UAP-008).
 *
 * Mail-free (creating a UserApp sends no mail). Empty storage state: each ATC opens its own crypto
 * session and spends one positive Administrator login; two generated tenants (the second one for the
 * cross-tenant username row) are prepared in `beforeAll` and deleted in `afterAll`. trace is off because
 * those logins carry live tokens and the payloads carry passwords. Every UserApp an ATC creates (including
 * any row the product wrongly accepts) is deleted before it ends.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('UAP: userapp input validation', () => {
  const data = new BranchDataSteps();
  let tenantId = 0;
  let otherTenantId = 0;

  test.beforeAll(async () => {
    tenantId = await data.prepareTenant();
    otherTenantId = await data.prepareTenant();
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('UAP-002: should accept the allowed username symbols', async ({ api }) => {
    await api.userApps.acceptUsernameSymbols(tenantId);
  });

  test('UAP-003: should reject usernames with invalid characters', async ({ api }) => {
    await api.userApps.rejectUsernameInvalidCharacters(tenantId);
  });

  test('UAP-004: should reject invalid username lengths', async ({ api }) => {
    await api.userApps.rejectInvalidUsernameLengths(tenantId);
  });

  test('UAP-005: should keep the username unique in the whole system', async ({ api }) => {
    await api.userApps.enforceGlobalUsernameUniqueness({ tenantId, otherTenantId });
  });

  test('UAP-006: should reject weak passwords', async ({ api }) => {
    await api.userApps.rejectWeakPasswords(tenantId);
  });

  test('UAP-007: should validate the e-mail', async ({ api }) => {
    await api.userApps.validateEmails(tenantId);
  });

  test('UAP-008: should reject an oversized name and position', async ({ api }) => {
    await api.userApps.rejectOversizedNameAndPosition(tenantId);
  });
});
