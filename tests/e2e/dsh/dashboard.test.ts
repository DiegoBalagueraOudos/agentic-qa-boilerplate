/**
 * Dashboard cases for the Administrator: statistic cards (DSH-001), refresh after tenant changes (DSH-002) and a failing API (DSH-003).
 *
 * DSH-001 compares the cards with the figures of EVERY tenant read through the API; DSH-002 creates, disables and deletes one GENERATED
 * tenant through the API, which `afterAll` also removes. They keep the saved Administrator session. File-level trace off.
 */

import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off' });

test.describe('Dashboard (Administrator)', () => {
  const tenants = new UiTenantSteps();

  test.afterAll(async () => {
    await tenants.cleanup();
  });

  test('DSH-001: should load the statistic cards with the figures of the tenant list', async ({ ui }) => {
    await ui.dashboard.showTenantStatisticsCards(await tenants.tenantStats());
  });

  test('DSH-002: should update the figures after tenants are created, disabled and deleted', async ({ ui }) => {
    await ui.dashboard.refreshStatisticsAfterTenantChanges({
      create: async () => tenants.createTenantId(),
      disable: async id => tenants.disableTenant(id),
      remove: async id => tenants.removeTenant(id),
    });
  });

  test('DSH-003: should show a controlled error when the API fails', async ({ ui }) => {
    await ui.dashboard.showControlledErrorWhenApiFails();
  });
});
