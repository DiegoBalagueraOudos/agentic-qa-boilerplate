/**
 * KATA Architecture - Layer 3: Smoke Page Component (SMK cases)
 *
 * Short "the application is alive" paths of the Validate SPA for the three human roles: the Administrator reaches the dashboard, the
 * tenant list and a tenant detail; the TenantAdmin reaches its panel; the UserApp reaches its query log; a minimal tenant is created
 * and deleted; every role signs out.
 *
 * The sign-in is NOT done here (a component must not depend on another component): the spec passes it as a `signIn` callback built
 * from `UiSessionSteps`, so credentials never reach this class or a step title. Typed form values go through `fillSecret`.
 *
 * Pages: /dashboard, /tenants, /tenants/{id}, /admin-panel, /logs/consultas-nr. The SPA exposes no data-testid; locators use roles,
 * visible text and `formcontrolname`.
 */

import type { Page } from '@playwright/test';

import { expect } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';

/** A role of the sign-out round: how to sign it in and a name for the failure list. */
export interface SmokeRole {
  label: string
  signIn: () => Promise<void>
}

/** The values the tenant form takes; the password is typed through `fillSecret` and never printed. */
export interface SmokeTenantForm {
  rnec: string
  businessName: string
  dbHost: string
  dbName: string
  dbUser: string
  dbPassword: string
}

/** The active generated operator picked as main operator. */
export interface SmokeOperator {
  code: string
  name: string
}

/** Collect what a smoke path must not produce: console errors, uncaught page errors and 5xx answers (and 403 when asked). */
function watchProblems(page: Page, options: { forbidden?: boolean } = {}): { problems: string[], stop: () => void } {
  const problems: string[] = [];
  const onConsole = (message: { type: () => string, text: () => string }): void => {
    if (message.type() === 'error') {
      problems.push(`console error: ${message.text().replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  };
  const onPageError = (error: Error): void => {
    problems.push(`page error: ${error.message.split('\n')[0].slice(0, 120)}`);
  };
  const onResponse = (response: { status: () => number, url: () => string }): void => {
    const path = new URL(response.url()).pathname;
    const status = response.status();
    if (path.startsWith('/api/') && (status >= 500 || (options.forbidden === true && status === 403))) {
      problems.push(`HTTP ${status} on ${path}`);
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  return {
    problems,
    stop: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
    },
  };
}

export class SmokePage extends UiBase {
  /**
   * ATC SMK-02: the Administrator signs in and lands on the dashboard with its heading.
   *
   * @param args - How to sign the Administrator in
   * @param args.signIn - Signs in through the real form (the spec builds it from `UiSessionSteps`)
   */
  @atc('SMK-02')
  async reachDashboardAsAdmin(args: { signIn: () => Promise<void> }): Promise<void> {
    await args.signIn();
    await expect(this.page).toHaveURL(/\/dashboard$/);
    await expect(this.page.getByText('Resumen del sistema multitenant')).toBeVisible();
  }

  /**
   * ATC SMK-03: the tenant list and the detail of a tenant load without console errors, uncaught page errors or 5xx answers.
   * Works on the saved Administrator session.
   *
   * @param args - The generated tenant to open
   * @param args.tenant - Tenant name and RNEC (the list is searched by RNEC)
   * @param args.tenant.rnec - RNEC
   */
  @atc('SMK-03')
  async openTenantListAndDetail(args: { tenant: { rnec: string } }): Promise<void> {
    const watcher = watchProblems(this.page);
    try {
      await this.page.goto(this.buildUrl('/tenants'));
      await this.page.getByPlaceholder('Buscar tenant...').fill(args.tenant.rnec);
      const row = this.page.getByRole('row').filter({ hasText: args.tenant.rnec });
      await expect(row).toHaveCount(1);
      await row.getByRole('link', { name: /Ver/ }).click();
      await expect(this.page).toHaveURL(/\/tenants\/\d+$/);
      await expect(this.page.getByText(args.tenant.rnec).first()).toBeVisible();
      await this.page.waitForLoadState('networkidle');
    }
    finally {
      watcher.stop();
    }
    if (watcher.problems.length > 0) {
      throw new Error(`${watcher.problems.length} problems while opening the tenant list and detail: ${watcher.problems.join('; ')}`);
    }
  }

  /**
   * ATC SMK-04: the TenantAdmin signs in and lands on its panel: title "Administración", its tenant name next to it, and its data
   * requests answered without 403 or 5xx.
   *
   * @param args - How to sign the TenantAdmin in
   * @param args.signIn - Signs in through the real tenant form (positive login only)
   */
  @atc('SMK-04')
  async reachPanelAsTenantAdmin(args: { signIn: () => Promise<void> }): Promise<void> {
    const watcher = watchProblems(this.page, { forbidden: true });
    try {
      await args.signIn();
      await expect(this.page).toHaveURL(/\/admin-panel$/);
      const title = this.page.getByText('Administración', { exact: true });
      await expect(title).toBeVisible();
      await this.page.waitForLoadState('networkidle');
      const header = ((await title.locator('xpath=..').textContent()) ?? '').replace('Administración', '').trim();
      if (header === '') {
        watcher.problems.push('the panel shows no tenant name next to its title');
      }
    }
    finally {
      watcher.stop();
    }
    if (watcher.problems.length > 0) {
      throw new Error(`${watcher.problems.length} problems on the TenantAdmin panel: ${watcher.problems.join('; ')}`);
    }
  }

  /**
   * ATC SMK-05: a UserApp signs in and lands on the query log screen with its menu entry. The rows are not asserted: the log database
   * of a generated tenant is not reachable.
   *
   * @param args - How to sign the UserApp in
   * @param args.signIn - Signs in through the real tenant form
   */
  @atc('SMK-05')
  async reachQueryLogsAsUserApp(args: { signIn: () => Promise<void> }): Promise<void> {
    await args.signIn();
    await expect(this.page).toHaveURL(/\/logs\/consultas-nr$/);
    await expect(this.page.getByRole('link', { name: 'Log Consultas' })).toBeVisible();
    await expect(this.page.locator('main')).toContainText(/Consultas/);
  }

  /**
   * ATC SMK-06: a minimal tenant is created through the form with a generated operator, found in the list, and deleted from the list;
   * the API reads it as deleted. Works on the saved Administrator session; the tenant is recorded for the spec cleanup through
   * `countByRnec`.
   *
   * @param args - The form values, the operator and the readers of the tenant state
   * @param args.tenant - Values typed in the form
   * @param args.operator - Active generated operator picked as main operator
   * @param args.countByRnec - Reads how many tenants (deleted ones included) hold the RNEC
   * @param args.isActive - Reads whether the tenant is active and not deleted, by its RNEC
   */
  @atc('SMK-06')
  async createAndDeleteMinimalTenant(args: {
    tenant: SmokeTenantForm
    operator: SmokeOperator
    countByRnec: (rnec: string) => Promise<number>
    isActive: (rnec: string) => Promise<boolean>
  }): Promise<void> {
    const { tenant, operator } = args;
    await this.page.goto(this.buildUrl('/tenants'));
    await this.page.getByRole('button', { name: 'Nuevo tenant' }).click();
    await this.page.locator('input[formcontrolname="rnec"]').fill(tenant.rnec);
    await this.page.locator('input[formcontrolname="businessName"]').fill(tenant.businessName);
    await this.fillSecret(this.page.locator('input[formcontrolname="dbHost"]'), tenant.dbHost);
    await this.fillSecret(this.page.locator('input[formcontrolname="dbName"]'), tenant.dbName);
    await this.fillSecret(this.page.locator('input[formcontrolname="dbUser"]'), tenant.dbUser);
    await this.fillSecret(this.page.locator('input[formcontrolname="dbPassword"]'), tenant.dbPassword);
    await this.page.getByRole('button', { name: 'Seleccionar operador' }).first().click();
    await this.page.getByPlaceholder('Buscar...').fill(operator.code);
    await this.page.getByRole('button').filter({ hasText: operator.code }).filter({ hasText: operator.name }).click();
    await this.page.getByRole('button', { name: 'Crear tenant' }).click();
    await expect(this.page.getByRole('button', { name: /Crear tenant|Creando/ })).toBeHidden({ timeout: 20000 });
    expect(await args.countByRnec(tenant.rnec), 'the form created one tenant').toBe(1);

    await this.page.getByPlaceholder('Buscar tenant...').fill(tenant.rnec);
    const row = this.page.getByRole('row').filter({ hasText: tenant.rnec });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Activo', { exact: true })).toBeVisible();

    await row.getByTitle('Eliminar').click();
    await expect(this.page.getByText(`Se eliminará ${tenant.businessName}`)).toBeVisible();
    await this.page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(this.page.getByText(`Se eliminará ${tenant.businessName}`)).toBeHidden();
    await expect(row.getByText('Activo', { exact: true })).toHaveCount(0);
    expect(await args.isActive(tenant.rnec), 'the API no longer reads the tenant as active').toBe(false);
  }

  /**
   * ATC SMK-07: every role signs out through the top bar: the logout call answers 200 and the user ends on `/login`. The roles are
   * signed in one after another.
   *
   * @param args - The roles to try
   * @param args.roles - Label and sign-in of each role (Administrator, TenantAdmin, UserApp)
   */
  @atc('SMK-07')
  async signOutEveryRole(args: { roles: SmokeRole[] }): Promise<void> {
    const failures: string[] = [];
    for (const role of args.roles) {
      try {
        await role.signIn();
        const [response] = await Promise.all([
          this.page.waitForResponse(item => item.request().method() === 'POST' && /\/api\/auth\/logout/i.test(item.url()), { timeout: 15000 }),
          this.page.getByRole('button', { name: 'Cerrar sesión' }).click(),
        ]);
        if (response.status() !== 200) {
          failures.push(`${role.label}: the logout call answered ${response.status()} (expected 200)`);
        }
        await expect(this.page).toHaveURL(/\/login$/);
      }
      catch (error) {
        failures.push(`${role.label}: ${String((error as Error).message).split('\n')[0].slice(0, 200)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} sign-out checks failed: ${failures.join('; ')}`);
    }
  }
}
