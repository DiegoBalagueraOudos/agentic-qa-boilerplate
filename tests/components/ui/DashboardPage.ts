/**
 * KATA Architecture - Layer 3: Dashboard Page Component
 *
 * UI component for the Administrator Dashboard of the Validate SPA: six statistic cards over the list of tenants (Total, Activos,
 * Inactivos, Eliminados, Credenciales API configuradas, Secreto activo) and the "Actualizar" button.
 *
 * Page: /dashboard
 * The SPA exposes no data-testid; each card is found by its title text.
 */

import type { TenantStats } from '@steps/UiTenantSteps';

import { expect, test } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';

/** The cards in the order of `TenantStats`: title shown, and the field of the statistics it must equal. */
const CARDS: Array<{ title: string, field: keyof TenantStats }> = [
  { title: 'Total', field: 'total' },
  { title: 'Activos', field: 'active' },
  { title: 'Inactivos', field: 'inactive' },
  { title: 'Eliminados', field: 'deleted' },
  { title: 'Credenciales API configuradas', field: 'withApiCredentials' },
  { title: 'Secreto activo', field: 'withActiveSecret' },
];

/** Steps of DSH-002: each changes the tenants through the API and returns the id to work on next. */
export interface TenantChanges {
  create: () => Promise<number>
  disable: (tenantId: number) => Promise<void>
  remove: (tenantId: number) => Promise<void>
}

export class DashboardPage extends UiBase {
  /** The number a card shows. */
  private async readCard(title: string): Promise<number> {
    const card = this.page.locator('app-stat-card').filter({ has: this.page.getByText(title, { exact: true }) });
    await expect(card).toHaveCount(1);
    return Number(((await card.locator('p.text-3xl').textContent()) ?? '').trim());
  }

  /** The six cards as statistics. */
  private async readCards(): Promise<TenantStats> {
    const stats = {} as TenantStats;
    for (const card of CARDS) {
      stats[card.field] = await this.readCard(card.title);
    }
    return stats;
  }

  /**
   * ATC DSH-001: the six statistic cards load and show the figures of the tenant list read through the API (active, inactive and
   * deleted tenants, tenants with API credentials and with an active secret). The dashboard reads the first 100 tenants only, so a
   * larger base shows a smaller figure and the card is wrong.
   *
   * @param expected - The figures computed from every tenant, deleted ones included
   */
  @atc('DSH-001')
  async showTenantStatisticsCards(expected: TenantStats): Promise<void> {
    await this.page.goto(this.buildUrl('/dashboard'));
    await expect(this.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(this.page.locator('app-stat-card')).toHaveCount(CARDS.length);
    const shown = await this.readCards();
    const different = CARDS.filter(card => shown[card.field] !== expected[card.field]).map(card => `${card.title}: shows ${shown[card.field]}, expected ${expected[card.field]}`);
    if (different.length > 0) {
      throw new Error(`${different.length} statistic card(s) differ from the tenant list (${expected.total} tenants in total). ${different.join('; ')}`);
    }
  }

  /**
   * ATC DSH-002: after the tenants change, "Actualizar" brings the figures up to date: a created tenant adds one to Total and Activos,
   * disabling it moves one from Activos to Inactivos, deleting it moves one from Inactivos to Eliminados (Total stays).
   *
   * @param changes - The API changes the case makes on a generated tenant
   */
  @atc('DSH-002')
  async refreshStatisticsAfterTenantChanges(changes: TenantChanges): Promise<void> {
    await this.page.goto(this.buildUrl('/dashboard'));
    await expect(this.page.locator('app-stat-card')).toHaveCount(CARDS.length);
    const refresh = async (): Promise<TenantStats> => {
      await this.page.getByRole('button', { name: 'Actualizar' }).click();
      await expect(this.page.locator('app-stat-card')).toHaveCount(CARDS.length);
      return this.readCards();
    };
    const failures: string[] = [];
    const expectDelta = (label: string, before: TenantStats, after: TenantStats, delta: Partial<Record<'total' | 'active' | 'inactive' | 'deleted', number>>) => {
      for (const field of ['total', 'active', 'inactive', 'deleted'] as const) {
        const expected = before[field] + (delta[field] ?? 0);
        if (after[field] !== expected) {
          failures.push(`${label}: ${field} shows ${after[field]} (expected ${expected})`);
        }
      }
    };

    const start = await this.readCards();
    const id = await changes.create();
    const created = await refresh();
    expectDelta('after creating', start, created, { total: 1, active: 1 });
    await changes.disable(id);
    const disabled = await refresh();
    expectDelta('after disabling', created, disabled, { active: -1, inactive: 1 });
    await changes.remove(id);
    const removed = await refresh();
    expectDelta('after deleting', disabled, removed, { inactive: -1, deleted: 1 });
    if (failures.length > 0) {
      throw new Error(`${failures.length} dashboard refresh checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC DSH-003: when the tenants request fails the Dashboard says so (an error message) instead of showing zeros as if there were no
   * data. The failure is forced by aborting the request in the browser.
   */
  @atc('DSH-003')
  async showControlledErrorWhenApiFails(): Promise<void> {
    await this.page.route(/\/api\/tenant(\?|$)/i, async route => route.abort());
    await this.page.goto(this.buildUrl('/dashboard'));
    await expect(this.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(this.page.locator('app-stat-card')).toHaveCount(CARDS.length);

    const message = this.page.getByText(/error|no se pudo|no fue posible|fall/i);
    let visible = false;
    try {
      await expect(message.first()).toBeVisible({ timeout: 6000 });
      visible = true;
    }
    catch {
      visible = false;
    }
    if (!visible) {
      const shown = await this.readCards();
      throw new Error(`the Dashboard shows no error when the tenants request fails; it shows Total ${shown.total}, Activos ${shown.active} as if there were no data`);
    }
  }

  /**
   * ATC DSH-004: a TenantAdmin and a UserApp who open `/dashboard` are redirected away from it and do not see the Administrator
   * statistics. The caller signs in with the credentials; the case signs out between the two.
   *
   * @param args - The two tenant users
   * @param args.signInAs - Signs a tenant user in and returns when the SPA has left the login
   * @param args.signOut - Signs the current user out
   */
  @atc('DSH-004')
  async redirectTenantUsersAwayFromDashboard(args: { signInAs: (role: 'TenantAdmin' | 'UserApp') => Promise<void>, signOut: () => Promise<void> }): Promise<void> {
    const failures: string[] = [];
    for (const role of ['TenantAdmin', 'UserApp'] as const) {
      await args.signInAs(role);
      try {
        await this.page.goto(this.buildUrl('/dashboard'));
        await this.page.waitForLoadState('networkidle');
        const url = new URL(this.page.url());
        const cards = await this.page.locator('app-stat-card').count();
        if (url.pathname.startsWith('/dashboard') || cards > 0) {
          failures.push(`${role}: stays on ${url.pathname} with ${cards} statistic card(s) (expected a redirect away from the Dashboard)`);
          // Evidence of what the tenant user sees, taken before signing out
          await test.info().attach(`dashboard-as-${role}`, { body: await this.page.screenshot(), contentType: 'image/png' });
        }
      }
      finally {
        await args.signOut();
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} Dashboard access checks failed: ${failures.join('; ')}`);
    }
  }
}
