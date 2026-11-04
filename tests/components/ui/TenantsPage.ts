/**
 * KATA Architecture - Layer 3: Tenants Page Component
 *
 * UI component for the tenants list and the "Nuevo tenant" creation form of the
 * Validate SPA (Administrator only). Holds the OPE-013 ATC: the operators offered by
 * the main-operator selector of the creation form.
 *
 * Page: /tenants
 * The SPA exposes no data-testid.
 */

import type { GeneratedOperator } from '@data/types';

import { expect, test } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';

export class TenantsPage extends UiBase {
  /**
   * ATC OPE-013: the main-operator selector of the "Nuevo tenant" form offers an ACTIVE
   * generated operator (searched by its unique code, shown as code + name). The form is
   * cancelled: nothing is submitted and no tenant is created.
   *
   * IMPORTANT: Needs the saved Administrator session and an active generated operator
   * already created by SecurityDataSteps (cleaned by the spec).
   *
   * @param operator - Active generated operator with a known code and name
   */
  @atc('OPE-013')
  async listActiveOperatorsInMainSelector(operator: GeneratedOperator): Promise<void> {
    await this.page.goto(this.buildUrl('/tenants'));
    await this.page.getByRole('button', { name: 'Nuevo tenant' }).click();
    await expect(this.page.getByText('Operador principal *')).toBeVisible();

    // Two identical triggers exist: the MAIN one is the first
    await this.page.getByRole('button', { name: 'Seleccionar operador' }).first().click();
    await this.page.getByPlaceholder('Buscar...').fill(operator.code);

    const option = this.page.getByRole('button').filter({ hasText: operator.code }).filter({ hasText: operator.name });
    const failures: string[] = [];
    try {
      await expect(option).toHaveCount(1);
    }
    catch {
      failures.push(`the selector offers the generated operator ${await option.count()} times (expected 1)`);
    }
    try {
      await this.page.getByRole('button', { name: 'Cancelar' }).click();
    }
    catch {
      failures.push('the form could not be closed with Cancelar (no tenant was created either way)');
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} main-operator selector checks failed: ${failures.join('; ')}`);
    }
  }

  /** Count the requests the browser sends that match a method and a path filter, from now on. */
  private watchRequests(match: (method: string, path: string) => boolean): string[] {
    const seen: string[] = [];
    this.page.on('request', (request) => {
      if (match(request.method(), new URL(request.url()).pathname)) {
        seen.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    return seen;
  }

  /**
   * ATC TEN-021: the "Nuevo tenant" form sent empty shows the six required fields as "Campo requerido" and "El operador principal es
   * requerido", stays open and sends nothing: no request to create a tenant leaves the browser.
   */
  @atc('TEN-021')
  async requireFieldsInEmptyTenantForm(): Promise<void> {
    const posts = this.watchRequests((method, path) => method === 'POST' && /\/api\/tenant$/i.test(path));
    await this.page.goto(this.buildUrl('/tenants'));
    await this.page.getByRole('button', { name: 'Nuevo tenant' }).click();
    await expect(this.page.getByText('Operador principal *')).toBeVisible();
    await this.page.getByRole('button', { name: 'Crear tenant' }).click();

    const failures: string[] = [];
    try {
      await expect(this.page.getByText('El operador principal es requerido')).toBeVisible();
    }
    catch {
      failures.push('"El operador principal es requerido" is not shown');
    }
    try {
      await expect(this.page.getByText('Campo requerido')).toHaveCount(6);
    }
    catch {
      failures.push(`${await this.page.getByText('Campo requerido').count()} "Campo requerido" message(s) are shown (expected 6)`);
    }
    try {
      await expect(this.page.getByRole('button', { name: 'Crear tenant' })).toBeVisible();
    }
    catch {
      failures.push('the form closed');
    }
    if (posts.length > 0) {
      failures.push(`${posts.length} request(s) to create a tenant were sent`);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} empty tenant form checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC TEN-026: three quick clicks on "Crear tenant" with a valid form send a single create request and leave a single tenant.
   *
   * @param args - The valid tenant data, the active operator to pick and the count of tenants by RNEC
   * @param args.tenant - Values typed in the form
   * @param args.tenant.rnec - RNEC
   * @param args.tenant.businessName - Business name
   * @param args.tenant.dbHost - Database server
   * @param args.tenant.dbName - Database name
   * @param args.tenant.dbUser - Database user
   * @param args.tenant.dbPassword - Database password, typed in the form and never printed
   * @param args.operator - Active generated operator picked as main operator
   * @param args.countByRnec - Reads how many tenants hold an RNEC (the case leaves them for the spec to remove)
   */
  @atc('TEN-026')
  async createOneTenantOnRapidClicks(args: {
    tenant: { rnec: string, businessName: string, dbHost: string, dbName: string, dbUser: string, dbPassword: string }
    operator: GeneratedOperator
    countByRnec: (rnec: string) => Promise<number>
  }): Promise<void> {
    const { tenant, operator } = args;
    const posts = this.watchRequests((method, path) => method === 'POST' && /\/api\/tenant$/i.test(path));
    await this.page.goto(this.buildUrl('/tenants'));
    await this.page.getByRole('button', { name: 'Nuevo tenant' }).click();
    await this.page.locator('input[formcontrolname="rnec"]').fill(tenant.rnec);
    await this.page.locator('input[formcontrolname="businessName"]').fill(tenant.businessName);
    await this.page.locator('input[formcontrolname="dbHost"]').fill(tenant.dbHost);
    await this.page.locator('input[formcontrolname="dbName"]').fill(tenant.dbName);
    await this.page.locator('input[formcontrolname="dbUser"]').fill(tenant.dbUser);
    await this.page.locator('input[formcontrolname="dbPassword"]').fill(tenant.dbPassword);
    await this.page.getByRole('button', { name: 'Seleccionar operador' }).first().click();
    await this.page.getByPlaceholder('Buscar...').fill(operator.code);
    await this.page.getByRole('button').filter({ hasText: operator.code }).filter({ hasText: operator.name }).click();

    await this.page.getByRole('button', { name: 'Crear tenant' }).click({ clickCount: 3, delay: 0 });
    const failures: string[] = [];
    try {
      await expect(this.page.getByRole('button', { name: /Crear tenant|Creando/ })).toBeHidden({ timeout: 20000 });
    }
    catch {
      failures.push('the form did not close after creating');
    }
    if (posts.length !== 1) {
      failures.push(`${posts.length} request(s) to create a tenant were sent (expected 1)`);
    }
    const tenants = await args.countByRnec(tenant.rnec);
    if (tenants !== 1) {
      failures.push(`${tenants} tenant(s) exist with that RNEC (expected 1)`);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} rapid-click checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC TEN-037: cancelling the "Inhabilitar tenant" confirmation changes nothing: the dialog closes, the row stays active, no request
   * that changes the tenant is sent and the API still reads it as active.
   *
   * @param args - The generated active tenant and a reader of its state
   * @param args.tenant - Generated tenant (name and RNEC shown in the list)
   * @param args.tenant.name - Business name
   * @param args.tenant.rnec - RNEC used to find the row
   * @param args.isActive - Reads whether the tenant is still active
   */
  @atc('TEN-037')
  async keepTenantActiveWhenCancellingDisable(args: { tenant: { name: string, rnec: string }, isActive: () => Promise<boolean> }): Promise<void> {
    const changes = this.watchRequests((method, path) => ['PUT', 'PATCH', 'DELETE'].includes(method) && /\/api\/tenant\//i.test(path));
    await this.page.goto(this.buildUrl('/tenants'));
    await this.page.getByPlaceholder('Buscar tenant...').fill(args.tenant.rnec);
    const row = this.page.getByRole('row').filter({ hasText: args.tenant.rnec });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Activo', { exact: true })).toBeVisible();

    await row.getByTitle('Inhabilitar').click();
    await expect(this.page.getByText(`¿Deseas inhabilitar ${args.tenant.name}?`)).toBeVisible();
    await this.page.getByRole('button', { name: 'Cancelar' }).click();

    const failures: string[] = [];
    try {
      await expect(this.page.getByText(`¿Deseas inhabilitar ${args.tenant.name}?`)).toBeHidden();
    }
    catch {
      failures.push('the confirmation stays open after Cancelar');
    }
    try {
      await expect(row.getByText('Activo', { exact: true })).toBeVisible();
    }
    catch {
      failures.push('the row no longer shows the tenant as active');
    }
    if (changes.length > 0) {
      failures.push(`${changes.length} request(s) that change a tenant were sent`);
    }
    if (!(await args.isActive())) {
      failures.push('the API reads the tenant as inactive or deleted');
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} cancelled-confirmation checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC TEN-013: when the tenant is created with the MAC-serial validation on and the follow-up configuration request fails, the tenant
   * exists, the screen warns that the validation could not be activated and does NOT also announce "Tenant creado correctamente".
   * The failure is forced by aborting the configuration request in the browser.
   *
   * @param args - Valid tenant data, the operator to pick and the count of tenants by RNEC
   * @param args.tenant - Values typed in the form
   * @param args.tenant.rnec - RNEC
   * @param args.tenant.businessName - Business name
   * @param args.tenant.dbHost - Database server
   * @param args.tenant.dbName - Database name
   * @param args.tenant.dbUser - Database user
   * @param args.tenant.dbPassword - Database password, typed in the form and never printed
   * @param args.operator - Active generated operator picked as main operator
   * @param args.countByRnec - Reads how many tenants hold an RNEC (the case leaves them for the spec to remove)
   */
  @atc('TEN-013')
  async warnWithoutSuccessWhenMacConfigFails(args: {
    tenant: { rnec: string, businessName: string, dbHost: string, dbName: string, dbUser: string, dbPassword: string }
    operator: GeneratedOperator
    countByRnec: (rnec: string) => Promise<number>
  }): Promise<void> {
    const { tenant, operator } = args;
    await this.page.route(/\/api\/tenant\/\d+\/config$/i, async route => route.abort());
    await this.page.goto(this.buildUrl('/tenants'));
    await this.page.getByRole('button', { name: 'Nuevo tenant' }).click();
    await this.page.locator('input[formcontrolname="rnec"]').fill(tenant.rnec);
    await this.page.locator('input[formcontrolname="businessName"]').fill(tenant.businessName);
    await this.page.locator('input[formcontrolname="dbHost"]').fill(tenant.dbHost);
    await this.page.locator('input[formcontrolname="dbName"]').fill(tenant.dbName);
    await this.page.locator('input[formcontrolname="dbUser"]').fill(tenant.dbUser);
    await this.page.locator('input[formcontrolname="dbPassword"]').fill(tenant.dbPassword);
    await this.page.getByRole('button', { name: 'Seleccionar operador' }).first().click();
    await this.page.getByPlaceholder('Buscar...').fill(operator.code);
    await this.page.getByRole('button').filter({ hasText: operator.code }).filter({ hasText: operator.name }).click();
    await this.page.getByText('Validar correspondencia MAC — Serial').click();
    await this.page.getByRole('button', { name: 'Crear tenant' }).click();

    const failures: string[] = [];
    const warning = this.page.getByText('El tenant se creó, pero no se pudo activar la validación MAC — Serial');
    try {
      await expect(warning).toBeVisible({ timeout: 20000 });
    }
    catch {
      failures.push('the warning about the MAC-serial validation is not shown');
    }
    // The toasts disappear in seconds: keep the moment of the warning on screen as the bug evidence, before anything else runs
    // the toasts slide in from the bottom right: let the animation finish so the capture shows them whole
    await this.page.waitForTimeout(700);
    await test.info().attach('toasts-after-create', { body: await this.page.screenshot(), contentType: 'image/png' });
    const successShown = await this.page.getByText('Tenant creado correctamente').filter({ visible: true }).count();
    if (successShown > 0) {
      failures.push('"Tenant creado correctamente" is shown together with the warning');
    }
    const tenants = await args.countByRnec(tenant.rnec);
    if (tenants !== 1) {
      failures.push(`${tenants} tenant(s) exist with that RNEC (expected 1)`);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} MAC-serial warning checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC TEN-005: with more than 100 tenants the "Activo (N)" and "Inactivo (N)" counters of the list stay right. The screen computes them
   * from the first 100 tenants only (`loadStatusCounts` asks for page size 100), so a larger base shows smaller figures.
   *
   * @param expected - The active and inactive tenants counted from every tenant through the API
   * @param expected.active - Tenants that are active and not deleted
   * @param expected.inactive - Tenants that are inactive and not deleted
   */
  @atc('TEN-005')
  async keepStatusCountersWithMoreThan100Tenants(expected: { active: number, inactive: number }): Promise<void> {
    await this.page.goto(this.buildUrl('/tenants'));
    const read = async (label: 'Activo' | 'Inactivo'): Promise<number> => {
      const chip = this.page.getByRole('button', { name: new RegExp(String.raw`^${label}\s*\(\d+\)`) });
      await expect(chip).toBeVisible();
      return Number(/\((\d+)\)/.exec((await chip.textContent()) ?? '')?.[1] ?? Number.NaN);
    };
    const shown = { active: await read('Activo'), inactive: await read('Inactivo') };
    const failures: string[] = [];
    if (shown.active !== expected.active) {
      failures.push(`Activo shows ${shown.active} (expected ${expected.active})`);
    }
    if (shown.inactive !== expected.inactive) {
      failures.push(`Inactivo shows ${shown.inactive} (expected ${expected.inactive})`);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} status counter checks failed with the base above 100 tenants: ${failures.join('; ')}`);
    }
  }
}
