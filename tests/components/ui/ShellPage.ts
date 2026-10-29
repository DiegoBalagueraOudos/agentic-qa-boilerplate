/**
 * KATA Architecture - Layer 3: Shell Page Component
 *
 * UI component for the signed-in shell of the Validate SPA: the topbar with the
 * "Cerrar sesión" control, the sidebar and the dashboard landing. Covers manual
 * logout (AUT-014), logout with the backend down (AUT-015) and the page reload
 * with an active session (AUT-036), plus the role matrix: route access by direct
 * URL (AUT-040), sidebar menu per role (AUT-041) and the root redirect (AUT-042).
 *
 * ATC ids are the local case ids under .context/QA/cases/ (no TMS in this project).
 *
 * Page: /dashboard (and any signed-in route)
 * The SPA exposes no data-testid. The logout control is a button named by its
 * title and sr-only text; locators were verified live on the signed-in shell.
 * Each spec signs in by itself through UiSessionSteps (empty storage state):
 * logout would otherwise revoke the shared saved session every other e2e spec uses.
 */

import type { Request } from '@playwright/test';

import { expect, test } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';
import { config } from '@variables';

// ============================================
// Types and role matrix data
// ============================================

export type RoleName = 'Administrator' | 'TenantAdmin' | 'UserApp';

/**
 * How each role gets signed in. Supplied by the spec (built on UiSessionSteps),
 * because a component never instantiates another component.
 */
export type RoleSignIns = Record<RoleName, () => Promise<void>>;

interface RoleAccess {
  role: RoleName
  /** Where `/` (and any unknown route) sends the role. */
  home: string
  /** Routes the role may open: the URL stays. */
  allowed: string[]
  /** Routes of the other roles: the role guard sends it to /dashboard. */
  foreign: string[]
  /** Visible sidebar link names, in menu order. */
  menu: string[]
}

/**
 * The matrix of the cases ("la matriz anterior"), derived from the SPA source:
 * `app.routes.ts` (guards per route), `role.guard.ts` (a failed guard redirects to
 * /dashboard, which has no guard) and `sidebar-nav.ts` (NAV_ITEMS per role).
 */
const ADMIN_ONLY_ROUTES = [
  '/tenants',
  '/users',
  '/operators',
  '/settings',
  '/products',
  '/log-consultas-nr',
  '/log-peticiones-nr',
  '/log-respuestas-no-satisfactorias-nr',
];
const TENANT_USER_ROUTES = [
  '/logs/consultas-nr',
  '/logs/peticiones-nr',
  '/logs/respuestas-no-satisfactorias-nr',
];
const TENANT_ADMIN_ONLY_ROUTES = ['/admin-panel'];
const LOG_MENU = ['Log Consultas', 'Log Peticiones', 'Log Resp. No Sat.'];

const ROLE_MATRIX: RoleAccess[] = [
  {
    role: 'Administrator',
    home: '/dashboard',
    allowed: ADMIN_ONLY_ROUTES,
    foreign: [...TENANT_USER_ROUTES, ...TENANT_ADMIN_ONLY_ROUTES],
    menu: ['Dashboard', 'Tenants', 'Usuarios', 'Operadores', 'Productos', ...LOG_MENU, 'Configuración'],
  },
  {
    role: 'TenantAdmin',
    home: '/admin-panel',
    allowed: [...TENANT_USER_ROUTES, ...TENANT_ADMIN_ONLY_ROUTES],
    foreign: ADMIN_ONLY_ROUTES,
    menu: ['Mi Panel', ...LOG_MENU],
  },
  {
    role: 'UserApp',
    home: '/logs/consultas-nr',
    allowed: TENANT_USER_ROUTES,
    foreign: [...ADMIN_ONLY_ROUTES, ...TENANT_ADMIN_ONLY_ROUTES],
    menu: LOG_MENU,
  },
];

// ============================================
// Shell Page Component
// ============================================

export class ShellPage extends UiBase {
  // ============================================
  // Locators (reused across ATCs)
  // ============================================

  private get logoutButton() {
    return this.page.getByRole('button', { name: 'Cerrar sesión' });
  }

  private get dashboardHeading() {
    return this.page.getByText('Resumen del sistema multitenant');
  }

  private get sidebarLinks() {
    return this.page.locator('nav a');
  }

  // ============================================
  // Helpers (Private)
  // ============================================

  /** Open a path by direct URL (full page load). */
  private async openByUrl(path: string): Promise<void> {
    await this.page.goto(this.buildUrl(path));
  }

  /**
   * Sign out through the shell and prove the server session was closed: the
   * logout call answers 200 and the user lands on /login.
   */
  private async signOut(timeout?: number): Promise<void> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        r => r.request().method() === 'POST' && /\/api\/auth\/logout/i.test(r.url()),
        { timeout },
      ),
      this.logoutButton.click({ timeout }),
    ]);
    expect(response.status(), 'the logout call closes the server session').toBe(200);
    await expect(this.page).toHaveURL(/\/login$/, { timeout });
  }

  /**
   * Sign out at the end of a role iteration without masking the body's result
   * (same idea as the limiter release in LoginPage): a body that passed turns a
   * sign-out failure into the failure; a body that already failed keeps its own
   * error and leaves a `signout-failed` note (the server session may stay open).
   */
  private async signOutAfterBody(role: RoleName, bodyPassed: boolean): Promise<void> {
    try {
      await this.signOut(bodyPassed ? undefined : 5000);
    }
    catch (error) {
      if (bodyPassed) {
        throw error;
      }
      const firstLine = (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0].slice(0, 200);
      test.info().annotations.push({ type: 'signout-failed', description: `${role}: ${firstLine}` });
    }
  }

  /**
   * Run one role's body (its sign-in included) and ALWAYS try to sign the role out, so a failing
   * assertion never leaves a real server session (7-day refresh token) open.
   */
  private async withRoleSession(role: RoleName, body: () => Promise<void>): Promise<void> {
    let bodyPassed = false;
    try {
      await body();
      bodyPassed = true;
    }
    finally {
      await this.signOutAfterBody(role, bodyPassed);
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

  // ============================================
  // ATCs - Complete Test Cases
  // ============================================

  /**
   * ATC AUT-014: clicking "Cerrar sesión" signs the user out: the backend
   * answers the logout call, the session cookies and the SPA session are gone,
   * the user lands on /login and a protected route no longer opens.
   *
   * IMPORTANT: Needs a signed-out context: the spec signs in first with
   * UiSessionSteps (own login, never the shared saved session). Server-side
   * revocation of the token is proven by AUT-039; no token is replayed here.
   */
  @atc('AUT-014')
  async logoutManually(): Promise<void> {
    expect(await this.cookieNames()).toEqual(expect.arrayContaining(['access_token', 'refresh_token', 'csrf_token']));
    expect(await this.hasUiSession()).toBe(true);

    const [response] = await Promise.all([
      this.page.waitForResponse(
        r => r.request().method() === 'POST' && /\/api\/auth\/logout/i.test(r.url()),
      ),
      this.logoutButton.click(),
    ]);
    expect(response.status()).toBe(200);

    await expect(this.page).toHaveURL(/\/login$/);
    const names = await this.cookieNames();
    expect(names).not.toContain('access_token');
    expect(names).not.toContain('refresh_token');
    expect(names).not.toContain('csrf_token');
    expect(await this.hasUiSession()).toBe(false);

    // A protected route no longer opens
    await this.page.goto(this.buildUrl('/dashboard'));
    await expect(this.page).toHaveURL(/\/login$/);
  }

  /**
   * ATC AUT-015: with the backend unreachable, "Cerrar sesión" still clears the
   * local session and sends the user to /login.
   *
   * IMPORTANT: Needs a signed-out context: the spec signs in first with
   * UiSessionSteps (own login). The outage is simulated in the browser by
   * aborting the logout call; a real outage is not reproduced. HAL-52 (the HttpOnly cookies stay valid because the backend
   * never heard the logout) is documented in the case and not asserted here.
   */
  @atc('AUT-015')
  async logoutWithBackendDown(): Promise<void> {
    expect(await this.hasUiSession()).toBe(true);

    const abortedLogouts: Request[] = [];
    await this.page.route('**/api/auth/logout', async (route) => {
      abortedLogouts.push(route.request());
      await route.abort('connectionrefused');
    });

    try {
      await this.logoutButton.click();

      await expect(this.page).toHaveURL(/\/login$/);
      expect(abortedLogouts.length).toBeGreaterThan(0);
      expect(await this.hasUiSession()).toBe(false);
    }
    finally {
      await this.page.unroute('**/api/auth/logout');
    }
  }

  /**
   * ATC AUT-036: reloading the page (F5) with an active session keeps the user
   * signed in on the same route.
   *
   * IMPORTANT: The spec signs in first with UiSessionSteps (own login): a
   * reload must not depend on the shared saved session.
   */
  @atc('AUT-036')
  async reloadWithActiveSession(): Promise<void> {
    await this.page.reload();

    await expect(this.dashboardHeading).toBeVisible();
    await expect(this.page).toHaveURL(/\/dashboard$/);
    await expect(this.logoutButton).toBeVisible();
    expect(await this.cookieNames()).toContain('access_token');
  }

  /**
   * ATC AUT-040: every cell of the role x route matrix holds by direct URL. A
   * route of the role stays, a route of another role ends on /dashboard, an
   * unknown route ends on the role's home, and with no session /tenants ends on
   * /login. Rows: Administrator, TenantAdmin, UserApp.
   *
   * IMPORTANT: Needs a signed-out context. `signIns` holds one positive login
   * per role (built by the spec on UiSessionSteps). The matrix is typed data in
   * this component (source: app.routes.ts, role.guard.ts). The case note says an
   * unknown route goes to /dashboard; the SPA sends it to '' and the root
   * redirect picks the role's home, which is what is asserted.
   *
   * @param signIns - Sign-in action of each role
   */
  @atc('AUT-040')
  async followRouteMatrixByDirectUrl(signIns: RoleSignIns): Promise<void> {
    // No session: a protected route sends to /login
    await this.openByUrl('/tenants');
    await expect(this.page).toHaveURL(this.buildUrl('/login'));

    // Failing cells are collected and thrown once: the whole matrix is the diagnostic
    // (a soft expect would not make the @atc decorator record a FAIL)
    const failures: string[] = [];
    const checkCell = async (role: RoleName, route: string, expected: string, assertion: () => Promise<void>) => {
      try {
        await assertion();
      }
      catch {
        const observed = new URL(this.page.url()).pathname;
        failures.push(`${role} ${route}: observed=${observed} expected=${expected}`);
      }
    };

    for (const row of ROLE_MATRIX) {
      await this.withRoleSession(row.role, async () => {
        await signIns[row.role]();

        for (const route of row.allowed) {
          await this.openByUrl(route);
          await checkCell(row.role, route, route, async () => {
            await expect(this.page, `${row.role} opens ${route}`).toHaveURL(this.buildUrl(route));
            // The router marks the menu entry active once the route has really settled
            await expect(this.page.locator(`nav a[href="${route}"]`), `${row.role} stays on ${route}`).toHaveClass(/bg-slate-700/);
          });
        }
        for (const route of row.foreign) {
          await this.openByUrl(route);
          await checkCell(row.role, route, '/dashboard', async () => {
            await expect(this.page, `${row.role} is sent away from ${route}`).toHaveURL(this.buildUrl('/dashboard'));
          });
        }
        await this.openByUrl('/no-such-route');
        await checkCell(row.role, '/no-such-route', row.home, async () => {
          await expect(this.page, `${row.role} on an unknown route`).toHaveURL(this.buildUrl(row.home));
        });
      });
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} cells of the role x route matrix failed. ${failures.join('; ')}`);
    }
  }

  /**
   * ATC AUT-041: the sidebar shows exactly the entries of the signed-in role,
   * none of another role's. Rows: Administrator, TenantAdmin, UserApp.
   *
   * IMPORTANT: Needs a signed-out context. `signIns` holds one positive login
   * per role. Link names and order come from NAV_ITEMS (sidebar-nav.ts).
   *
   * @param signIns - Sign-in action of each role
   */
  @atc('AUT-041')
  async showOnlyMenuOfTheRole(signIns: RoleSignIns): Promise<void> {
    for (const row of ROLE_MATRIX) {
      await this.withRoleSession(row.role, async () => {
        await signIns[row.role]();

        // The array form also fails on an extra, foreign entry
        await expect(this.sidebarLinks, `${row.role} menu`).toHaveText(row.menu);
      });
    }
  }

  /**
   * ATC AUT-042: the root route redirects each role to its home: Administrator
   * to /dashboard, TenantAdmin to /admin-panel, UserApp to /logs/consultas-nr.
   *
   * IMPORTANT: Needs a signed-out context. `signIns` holds one positive login
   * per role. The root is opened by a fresh page load, not by the post-login
   * redirect.
   *
   * @param signIns - Sign-in action of each role
   */
  @atc('AUT-042')
  async redirectRootByRole(signIns: RoleSignIns): Promise<void> {
    for (const row of ROLE_MATRIX) {
      await this.withRoleSession(row.role, async () => {
        await signIns[row.role]();

        await this.openByUrl('/');
        await expect(this.page, `${row.role} on the root`).toHaveURL(this.buildUrl(row.home));
      });
    }
  }
}
