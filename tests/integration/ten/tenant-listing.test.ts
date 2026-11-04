/**
 * TEN block 2.1: list, search and paging (TEN-001 to TEN-004, TEN-006, TEN-007).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login, and works on
 * tenants it creates under a token of its own (the search isolates them from the rest of the base) and deletes. TEN-005 (more than 100
 * tenants) is manual. trace is off because the logins carry live tokens.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TEN: tenant list', () => {
  test('TEN-001: should load the tenant list', async ({ api }) => {
    await api.tenantManagement.loadTenantList();
  });

  test('TEN-002: should search tenants by name and RNEC', async ({ api }) => {
    await api.tenantManagement.searchTenantsByNameAndRnec();
  });

  test('TEN-003: should list tenants by state', async ({ api }) => {
    await api.tenantManagement.listTenantsByState();
  });

  test('TEN-004: should page the tenant list', async ({ api }) => {
    await api.tenantManagement.pageTenantList();
  });

  test('TEN-006: should search with accents and special characters', async ({ api }) => {
    await api.tenantManagement.searchWithSpecialCharacters();
  });

  test('TEN-007: should keep the total after creating and deleting', async ({ api }) => {
    await api.tenantManagement.keepTenantTotalAfterCreateAndDelete();
  });
});
