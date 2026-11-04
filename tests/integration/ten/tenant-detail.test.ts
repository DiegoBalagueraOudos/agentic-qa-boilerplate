/**
 * TEN block 2.6 (part 1): detail and tenant isolation (TEN-080, TEN-081, TEN-083, TEN-090, TEN-093).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login; TEN-083, TEN-090
 * and TEN-093 also sign the suite's real TenantAdmin in on its own context for READ-ONLY and refusal checks (one positive login each).
 * Tenants are generated and deleted. trace is off because the logins carry live tokens.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TEN: tenant detail and isolation', () => {
  test('TEN-080: should read the tenant detail', async ({ api }) => {
    await api.tenantManagement.readTenantDetail();
  });

  test('TEN-081: should answer unknown tenant ids in a controlled way', async ({ api }) => {
    await api.tenantManagement.answerUnknownTenantIdsInControlledWay();
  });

  test('TEN-083: should isolate the data of a tenant from other TenantAdmins', async ({ api }) => {
    await api.tenantManagement.isolateTenantDataFromOtherTenantAdmins();
  });

  test('TEN-090: should read only the own tenant', async ({ api }) => {
    await api.tenantManagement.readOnlyOwnTenant();
  });

  test('TEN-093: should refuse another tenant by id to a TenantAdmin', async ({ api }) => {
    await api.tenantManagement.refuseTenantByIdToTenantAdmin();
  });
});
