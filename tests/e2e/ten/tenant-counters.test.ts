/**
 * Tenant list counters with a large base (TEN-005).
 *
 * Needs no data of its own: the base already holds more than 100 tenants (deleted ones included). The expected figures are counted
 * from every tenant through the API. It keeps the saved Administrator session. File-level trace off.
 */

import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Tenant list counters', () => {
  const tenants = new UiTenantSteps();

  test.afterAll(async () => {
    await tenants.cleanup();
  });

  test('TEN-005: should keep the status counters with more than 100 tenants', async ({ ui }) => {
    const stats = await tenants.tenantStats();
    test.skip(stats.total <= 100, 'The base holds 100 tenants or fewer: the counters cannot be incomplete');
    await ui.tenants.keepStatusCountersWithMoreThan100Tenants({ active: stats.active, inactive: stats.inactive });
  });
});
