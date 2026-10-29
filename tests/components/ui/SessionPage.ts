/**
 * KATA Architecture - Layer 3: Session Page Component
 *
 * UI component for the session behaviours of the signed-in Validate SPA: the
 * transparent token refresh done by its error interceptor (AUT-030..AUT-033)
 * and the client inactivity timer reset by user activity (AUT-035), and what a
 * tab does when another tab of the same browser logs out (AUT-037).
 *
 * ATC ids are the local case ids under .context/QA/cases/ (no TMS in this project).
 *
 * Pages: /users and /tenants (protected lists that load data on entry),
 * /dashboard (landing).
 * The SPA exposes no data-testid. Locators use roles and visible text.
 * Each spec signs in by itself through UiSessionSteps (empty storage state):
 * removing cookies or logging out would otherwise break the shared saved session every other e2e
 * spec uses.
 *
 * SCOPE NOTE (AUT-030..AUT-033): token expiry is simulated by REMOVING the
 * `access_token` cookie from the browser context (and `refresh_token` for
 * AUT-032). The server answers the same 401 and the SPA reacts the same way,
 * but the "JWT present and expired" code path is not the one exercised.
 * Cookie values are never read, printed or logged: only cookie names.
 */

import type { Request, Response } from '@playwright/test';

import { expect } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';
import { config } from '@variables';

// ============================================
// Types
// ============================================

/** One `/api/` call seen by the browser: method, path and status only. */
interface ApiCall {
  method: string
  path: string
  status: number
}

/** Generated tenant the mutation of AUT-031 acts on. */
export interface TenantTarget {
  id: number
  rnec: string
}

// ============================================
// Session Page Component
// ============================================

export class SessionPage extends UiBase {
  // ============================================
  // Locators (reused across ATCs)
  // ============================================

  private get usersHeading() {
    return this.page.getByRole('heading', { name: 'Usuarios' });
  }

  private get tenantsHeading() {
    return this.page.getByRole('heading', { name: 'Tenants' });
  }

  private get usersLink() {
    return this.page.getByRole('link', { name: 'Usuarios' });
  }

  private get tenantsLink() {
    return this.page.getByRole('link', { name: 'Tenants' });
  }

  private get dashboardHeading() {
    return this.page.getByText('Resumen del sistema multitenant');
  }

  // ============================================
  // Helpers (Private)
  // ============================================

  /**
   * Start recording every `/api/` response (method, path, status; never
   * headers or bodies). Returns the live list and a stop function.
   */
  private recordApiCalls(): { calls: ApiCall[], stop: () => void } {
    const calls: ApiCall[] = [];
    const onResponse = (response: Response) => {
      const { pathname } = new URL(response.url());
      if (pathname.startsWith('/api/') && !/handshake|health/i.test(pathname)) {
        calls.push({ method: response.request().method(), path: pathname, status: response.status() });
      }
    };
    this.page.on('response', onResponse);
    return { calls, stop: () => this.page.off('response', onResponse) };
  }

  /**
   * Remove session cookies BY NAME from the browser context: simulates an
   * expired access token (and, with `refresh_token`, a refresh that is refused).
   */
  private async removeCookies(...names: string[]): Promise<void> {
    for (const name of names) {
      await this.page.context().clearCookies({ name });
    }
    const left = (await this.page.context().cookies()).map(c => c.name);
    for (const name of names) {
      expect(left).not.toContain(name);
    }
  }

  /** Names (never values) of the cookies the browser context holds. */
  private async cookieNames(): Promise<string[]> {
    return (await this.page.context().cookies()).map(c => c.name);
  }

  /** Is the SPA session metadata present in sessionStorage? */
  private async hasUiSession(): Promise<boolean> {
    return this.page.evaluate(key => sessionStorage.getItem(key) !== null, config.auth.uiSessionKey);
  }

  /**
   * Start collecting unhandled page exceptions (name and message only). Returns
   * the live list and a stop function.
   */
  private collectPageErrors(): { errors: string[], stop: () => void } {
    const errors: string[] = [];
    const onError = (error: Error) => {
      errors.push(`${error.name}: ${error.message}`.slice(0, 200));
    };
    this.page.on('pageerror', onError);
    return { errors, stop: () => this.page.off('pageerror', onError) };
  }

  private isRefreshCall(call: ApiCall): boolean {
    return call.method === 'POST' && /\/api\/auth\/refresh$/i.test(call.path);
  }

  // ============================================
  // ATCs - Complete Test Cases
  // ============================================

  /**
   * ATC AUT-030: when the access token is gone and the user opens a protected
   * screen, the SPA refreshes the session by itself and the screen loads:
   * GET 401 -> POST /api/auth/refresh 200 -> GET 200, same URL, content shown.
   *
   * IMPORTANT: Needs a signed-out context (the spec signs in first with UiSessionSteps). Expiry is simulated by
   * removing the `access_token` cookie (refresh cookie intact); absence of the
   * cookie is not the same code path as an expired JWT.
   */
  @atc('AUT-030')
  async refreshTransparentlyOnExpiredGet(): Promise<void> {
    const { calls, stop } = this.recordApiCalls();

    try {
      await this.removeCookies('access_token');
      const mark = calls.length;

      // In-SPA navigation: the Users list loads its data on entry
      await this.usersLink.click();

      await expect(this.page).toHaveURL(/\/users$/);
      await expect(this.usersHeading).toBeVisible();
      await expect.poll(() => this.sequenceOfFirstExpiredGet(calls.slice(mark)), { timeout: 15000 })
        .toEqual({ expired: true, refreshed: true, retriedOk: true });

      // Still the same screen, still signed in, and a new access token was issued
      await expect(this.page).toHaveURL(/\/users$/);
      expect(await this.hasUiSession()).toBe(true);
      expect(await this.cookieNames()).toContain('access_token');
    }
    finally {
      stop();
    }
  }

  /**
   * ATC AUT-032: when the refresh itself is refused, the SPA clears the session
   * and sends the user to /login: GET 401 -> POST /api/auth/refresh 401 ->
   * session metadata gone, URL /login.
   *
   * IMPORTANT: Needs a signed-out context (the spec signs in first with UiSessionSteps). Both `access_token` and
   * `refresh_token` cookies are removed from the context, so the server gives
   * its real answer to a refresh without credentials; nothing is mocked.
   */
  @atc('AUT-032')
  async clearSessionWhenRefreshFails(): Promise<void> {
    const { calls, stop } = this.recordApiCalls();

    try {
      await this.removeCookies('access_token', 'refresh_token');
      const mark = calls.length;

      await this.usersLink.click();

      await expect(this.page).toHaveURL(/\/login$/);
      const seen = calls.slice(mark);
      const expiredGet = seen.findIndex(c => c.method === 'GET' && c.status === 401);
      const refresh = seen.findIndex(c => this.isRefreshCall(c));
      expect(expiredGet, 'a protected GET answered 401').toBeGreaterThanOrEqual(0);
      expect(refresh, 'the SPA tried to refresh').toBeGreaterThan(expiredGet);
      expect(seen[refresh].status).toBe(401);
      expect(await this.hasUiSession()).toBe(false);
    }
    finally {
      stop();
    }
  }

  /**
   * ATC AUT-033: several requests that fail at the same time with an expired
   * token trigger ONE refresh; the others wait and are then retried: both GETs
   * end 200.
   *
   * IMPORTANT: Needs a signed-out context (the spec signs in first with UiSessionSteps). Opening /tenants by
   * in-SPA navigation fires two `GET /api/tenant` at once (list plus status
   * counters), verified live; that is the concurrency trigger. Expiry is
   * simulated by removing the `access_token` cookie.
   */
  @atc('AUT-033')
  async refreshOnceForConcurrentRequests(): Promise<void> {
    const { calls, stop } = this.recordApiCalls();

    try {
      await this.removeCookies('access_token');
      const mark = calls.length;

      await this.tenantsLink.click();

      await expect(this.page).toHaveURL(/\/tenants$/);
      await expect(this.tenantsHeading).toBeVisible();
      const tenantGets = (status: number) => calls.slice(mark)
        .filter(c => c.method === 'GET' && /\/api\/tenant$/i.test(c.path) && c.status === status)
        .length;
      await expect.poll(() => tenantGets(200), { timeout: 15000 }).toBe(2);

      const seen = calls.slice(mark);
      expect(tenantGets(401), 'two requests failed together').toBe(2);
      expect(seen.filter(c => this.isRefreshCall(c)), 'one single refresh').toHaveLength(1);
      expect(seen.find(c => this.isRefreshCall(c))?.status).toBe(200);
      // Order: both 401 before the refresh, both retries after it
      const refreshAt = seen.findIndex(c => this.isRefreshCall(c));
      const lastExpiredAt = seen.map(c => c.method === 'GET' && c.status === 401).lastIndexOf(true);
      const firstRetryAt = seen.findIndex(c => c.method === 'GET' && c.status === 200);
      expect(lastExpiredAt).toBeLessThan(refreshAt);
      expect(firstRetryAt).toBeGreaterThan(refreshAt);
      await expect(this.page).toHaveURL(/\/tenants$/);
    }
    finally {
      stop();
    }
  }

  /**
   * ATC AUT-031: when the access token is gone during a MUTATION (disable a
   * tenant), the SPA refreshes the session but does not replay the write, and
   * tells the user to repeat the action; the session stays active.
   *
   * IMPORTANT: Needs a signed-out context (signed in by the spec with UiSessionSteps) and a GENERATED tenant
   * (never a real one). Expiry is simulated by removing the `access_token`
   * cookie. Correct behaviour is asserted: HAL-57 predicts the product shows
   * "Error al inhabilitar el tenant" and ends on /login instead, so this ATC
   * is expected to fail until that is fixed.
   *
   * @param tenant - Generated tenant (id and RNEC) to disable
   */
  @atc('AUT-031')
  async askToRepeatMutationAfterRefresh(tenant: TenantTarget): Promise<void> {
    const { calls, stop } = this.recordApiCalls();

    try {
      await this.tenantsLink.click();
      await expect(this.tenantsHeading).toBeVisible();

      // Narrow the list to the generated tenant, so no other tenant is touched
      await this.page.getByPlaceholder('Buscar tenant...').fill(tenant.rnec);
      await Promise.all([
        this.page.waitForResponse(r => r.request().method() === 'GET' && /\/api\/tenant$/i.test(new URL(r.url()).pathname)),
        this.page.getByRole('button', { name: 'Buscar' }).click(),
      ]);
      const row = this.page.getByRole('row').filter({ hasText: tenant.rnec });
      await expect(row).toHaveCount(1);

      await this.removeCookies('access_token');
      const mark = calls.length;

      await row.getByRole('button', { name: 'Inhabilitar' }).click();
      await this.page.getByRole('button', { name: 'Confirmar' }).click();

      const isMutation = (c: ApiCall) => c.method === 'PUT' && new RegExp(`/api/tenant/${tenant.id}$`, 'i').test(c.path);
      await expect.poll(() => calls.slice(mark).some(c => this.isRefreshCall(c)), { timeout: 15000 }).toBe(true);
      const seen = calls.slice(mark);
      expect(seen.find(c => this.isRefreshCall(c))?.status).toBe(200);
      expect(seen.findIndex(c => this.isRefreshCall(c))).toBeGreaterThan(seen.findIndex(isMutation));

      // Wait for the observable end of the flow (the message, the error or /login), so a replay
      // would already have happened when the write is counted. Does not need the correct message.
      const repeatMessage = this.page.getByText('Sesión renovada. Por favor, repite la acción.');
      const failureMessage = this.page.getByText('Error al inhabilitar el tenant');
      await expect.poll(
        async () => (await repeatMessage.isVisible()) || (await failureMessage.isVisible()) || /\/login$/.test(this.page.url()),
        { timeout: 15000, message: 'the flow reached its observable end' },
      ).toBe(true);
      expect(calls.slice(mark).filter(isMutation).map(c => c.status), 'one PUT, rejected, never replayed').toEqual([401]);

      // Correct behaviour: ask to repeat, keep the session
      await expect(repeatMessage).toBeVisible();
      await expect(failureMessage).toHaveCount(0);
      await expect(this.page).toHaveURL(/\/tenants$/);
      expect(await this.hasUiSession()).toBe(true);
    }
    finally {
      stop();
    }
  }

  /**
   * ATC AUT-035: user activity (a real mouse click) restarts the 15 minute
   * inactivity counter, so the session is NOT closed after 20 minutes in total.
   *
   * Scope: the CLIENT inactivity timer (a 15 min setTimeout in the SPA) under
   * Playwright's clock control, same technique as AUT-034. It does NOT wait
   * real minutes and does NOT exercise server-side token expiry. Under the
   * fast-forwarded clock the X-Timestamp of any call is far ahead of the
   * server's, so only the SPA behaviour is judged here. A negative control at
   * the end fast-forwards 6 more minutes (16 since the click) and requires the
   * inactivity logout to happen, so the quiet checks cannot be a false green.
   *
   * IMPORTANT: The spec signs in first with
   * `UiSessionSteps.signInAndReachDashboard(credentials, { fakeClock: true })`:
   * the clock must be installed before the SPA boots. Needs a signed-out
   * context (own login, never the shared saved session).
   */
  @atc('AUT-035')
  async keepSessionAfterActivity(): Promise<void> {
    const logoutRequests: string[] = [];
    const onRequest = (request: Request) => {
      if (request.method() === 'POST' && /\/api\/auth\/logout/i.test(request.url())) {
        logoutRequests.push(request.url());
      }
    };
    this.page.on('request', onRequest);

    try {
      // Signed in by the spec (UiSessionSteps, fake clock installed before the SPA booted)
      await expect(this.page).toHaveURL(/\/dashboard$/);
      await expect(this.dashboardHeading).toBeVisible();

      // 10 minutes of silence: still inside the 15 minute window
      await this.page.clock.fastForward('10:00');
      await expect(this.page).toHaveURL(/\/dashboard$/);

      // Real activity restarts the counter
      await this.page.mouse.move(200, 200);
      await this.page.mouse.click(300, 300);

      // 10 more minutes: 20 in total, more than 15 since the start, only 10 since the activity
      await this.page.clock.fastForward('10:00');

      await expect(this.page).toHaveURL(/\/dashboard$/);
      await expect(this.dashboardHeading).toBeVisible();
      expect(logoutRequests).toHaveLength(0);
      expect(await this.hasUiSession()).toBe(true);

      // Negative control: the same timer, left alone, DOES sign the user out. 26 minutes in
      // total, 16 since the click: this proves the timer and the async logout path are live,
      // so the quiet checks above were not a false green.
      await this.page.clock.fastForward('06:00');
      await expect.poll(() => logoutRequests.length, { timeout: 15000 }).toBeGreaterThan(0);
      await expect(this.page).toHaveURL(/\/login$/);
      await expect.poll(async () => this.hasUiSession()).toBe(false);
    }
    finally {
      this.page.off('request', onRequest);
    }
  }

  /**
   * ATC AUT-037: when the user logs out in another tab of the same browser, this
   * tab loses its session in a controlled way on its next protected request: it
   * ends on /login, its local session is cleared, `auth_session` is absent, the
   * login screen is shown and no unhandled error happens.
   *
   * IMPORTANT: This page is tab A, already signed in by the spec; tab B (same
   * browser context, so the same cookie jar) signed in after it and its logout is
   * passed as `logoutInOtherTab` (a component never holds a second page). Not
   * asserted: HAL-12 (a new tab needing login), the 401/refresh call sequence,
   * server-side revocation (AUT-039) and any toast. Failing checks are
   * accumulated and thrown as ONE error so the @atc decorator records the FAIL.
   *
   * @param logoutInOtherTab - Logs out in tab B (clicks "Cerrar sesión", expects 200 and /login)
   */
  @atc('AUT-037')
  async loseSessionWhenOtherTabLogsOut(logoutInOtherTab: () => Promise<void>): Promise<void> {
    // Precondition: this tab still believes it is signed in
    expect(await this.hasUiSession(), 'tab A starts with its local session').toBe(true);

    await logoutInOtherTab();

    const failures: string[] = [];
    const check = async (label: string, assertion: () => Promise<void> | void) => {
      try {
        await assertion();
      }
      catch (error) {
        failures.push(`${label}: ${(error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0].slice(0, 200)}`);
      }
    };

    const { errors, stop } = this.collectPageErrors();
    try {
      // Tab A's next protected request: in-SPA navigation to a protected list.
      // Assumes tab A may already be on /login (no users link there): then the click is skipped.
      await check('protected request from tab A', async () => {
        if (!/\/login$/.test(new URL(this.page.url()).pathname)) {
          await this.usersLink.click();
        }
      });

      await check('tab A ends on /login', async () => expect(this.page).toHaveURL(/\/login$/));
      await check('local session cleared', async () => expect.poll(async () => this.hasUiSession()).toBe(false));
      await check('login screen shown', async () => expect(this.page.getByRole('button', { name: 'Administrador del sistema' })).toBeVisible());
      // Late errors count: read the list through a poll after the awaited waits above
      await check('no unhandled page errors', async () => expect.poll(() => errors.join(' | ')).toBe(''));

      if (failures.length > 0) {
        throw new Error(`Tab A did not lose its session cleanly (final path ${new URL(this.page.url()).pathname}):\n- ${failures.join('\n- ')}`);
      }
    }
    finally {
      stop();
    }
  }

  // ============================================
  // Helpers (Private, derived data)
  // ============================================

  /**
   * Did the first GET that failed with 401 get refreshed and retried? Pure
   * function over the recorded calls (method, path, status).
   */
  private sequenceOfFirstExpiredGet(seen: ApiCall[]): { expired: boolean, refreshed: boolean, retriedOk: boolean } {
    const expiredAt = seen.findIndex(c => c.method === 'GET' && c.status === 401);
    if (expiredAt < 0) {
      return { expired: false, refreshed: false, retriedOk: false };
    }
    const refreshAt = seen.findIndex((c, i) => i > expiredAt && this.isRefreshCall(c) && c.status === 200);
    const retriedOk = refreshAt > expiredAt
      && seen.some((c, i) => i > refreshAt && c.method === 'GET' && c.path === seen[expiredAt].path && c.status === 200);
    return { expired: true, refreshed: refreshAt > expiredAt, retriedOk };
  }
}
