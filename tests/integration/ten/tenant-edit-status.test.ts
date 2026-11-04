/**
 * TEN block 2.3 (part 1): edit, logo and status (TEN-030 to TEN-038).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login and works on a
 * tenant it creates and deletes. trace is off because the logins carry live tokens. TEN-037 (cancel the confirmation) is a screen
 * behaviour and stays for the interface tests.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TEN: tenant edit, logo and status', () => {
  test('TEN-030: should edit the business name and the parameters', async ({ api }) => {
    await api.tenantManagement.editBusinessNameAndParameters();
  });

  test('TEN-031: should keep the RNEC on edit', async ({ api }) => {
    await api.tenantManagement.keepRnecOnEdit();
  });

  test('TEN-032: should reject invalid data on edit', async ({ api }) => {
    await api.tenantManagement.rejectInvalidDataOnEdit();
  });

  test('TEN-033: should save a valid logo', async ({ api }) => {
    await api.tenantManagement.saveValidLogo();
  });

  test('TEN-034: should reject an invalid logo', async ({ api }) => {
    await api.tenantManagement.rejectInvalidLogos();
  });

  test('TEN-035: should disable a tenant', async ({ api }) => {
    await api.tenantManagement.disableTenant();
  });

  test('TEN-036: should enable a tenant', async ({ api }) => {
    await api.tenantManagement.enableTenant();
  });

  test('TEN-038: should change the status only with PUT', async ({ api }) => {
    await api.tenantManagement.changeStatusOnlyWithPut();
  });
});
