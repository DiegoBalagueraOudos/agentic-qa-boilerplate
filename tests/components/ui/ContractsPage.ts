/**
 * KATA Architecture - Layer 3: Contracts Page Component (INT cases)
 *
 * UI component for the cross-screen integration checks of the Validate SPA (Administrator): what the screens do with what the
 * backend answers. INT-001 (a field name the front reads wrongly), INT-002 and INT-004 (rules only the backend enforces, shown on the
 * field), INT-003 (a clear message per status code) and INT-005 (the backend down).
 *
 * Pages: /tenants/{id} (Usuarios App tab), /operators, /users. The SPA exposes no data-testid; locators use text, roles and
 * `formcontrolname`. Typed values go through `fillSecret` so no value reaches a report step title.
 */

import { expect, test } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';

/** One value the front accepts and only the backend refuses. */
export interface ServerOnlyRule {
  label: string
  /** `userapp` form of the tenant detail, or the `operator` form of /operators. */
  form: 'userapp' | 'operator'
  values: Record<string, string>
  /** The `formcontrolname` of the field that must show the message. */
  field: string
}

/** The text the SPA shows for a generic failure; a field message must replace it. */
const GENERIC_ERROR = /Error inesperado/i;

export class ContractsPage extends UiBase {
  /** Save and attach the screen at the moment of a defect, so the report shows the right image and the bug can be annotated from it. */
  private async evidence(name: string): Promise<void> {
    const body = await this.page.screenshot();
    await this.page.screenshot({ path: test.info().outputPath(`${name}.png`) });
    await test.info().attach(name, { body, contentType: 'image/png' });
  }

  /** Open the "Nuevo usuario" form of the Usuarios App tab of a tenant. */
  private async openUserAppForm(tenantId: number): Promise<void> {
    await this.page.goto(this.buildUrl(`/tenants/${tenantId}`));
    await this.page.getByText('Usuarios App', { exact: true }).click();
    await this.page.getByRole('button', { name: 'Nuevo usuario' }).click();
    await expect(this.page.locator('input[formcontrolname="fullName"]')).toBeVisible();
  }

  /** Open the "Nuevo operador" form. */
  private async openOperatorForm(): Promise<void> {
    await this.page.goto(this.buildUrl('/operators'));
    await this.page.getByRole('button', { name: 'Nuevo operador' }).click();
    await expect(this.page.locator('input[formcontrolname="operatorCode"]')).toBeVisible();
  }

  /**
   * Type the values of a form (each one hidden from the step titles) and press its submit button. Returns the status of the create
   * request, or null when the form sent nothing (the front refused the value itself).
   */
  private async submitForm(form: 'userapp' | 'operator', values: Record<string, string>): Promise<number | null> {
    for (const [field, value] of Object.entries(values)) {
      await this.fillSecret(this.page.locator(`input[formcontrolname="${field}"]`), value);
    }
    const created = this.page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/(?:tenants\/\d+\/appusers|operators)$/i.test(new URL(response.url()).pathname), { timeout: 5000 }).then(response => response.status()).catch(() => null);
    await this.page.getByRole('button', { name: form === 'userapp' ? 'Crear usuario' : 'Crear operador' }).click();
    return created;
  }

  /** The messages shown under the fields of the open form (red text), in order. */
  private async fieldMessages(): Promise<string[]> {
    const messages = await this.page.locator('form p.text-red-600').allTextContents();
    return messages.map(text => text.trim()).filter(text => text !== '');
  }

  /**
   * ATC INT-001: the Usuarios App table shows the login name of each user in its "Username" column. The backend sends `UserName` and the
   * screen reads another field name, so the column comes out empty (HAL-08).
   *
   * @param args - The tenant and the user it holds
   * @param args.tenantId - Tenant id (route)
   * @param args.username - The login name the API holds for the user
   */
  @atc('INT-001')
  async showUsernameColumnOfUserApps(args: { tenantId: number, username: string }): Promise<void> {
    await this.page.goto(this.buildUrl(`/tenants/${args.tenantId}`));
    await this.page.getByText('Usuarios App', { exact: true }).click();
    const rows = this.page.locator('tbody tr');
    await expect(rows).toHaveCount(1);
    const header = await this.page.locator('thead th').allTextContents();
    const column = header.findIndex(text => text.trim() === 'Username');
    expect(column, 'the table has a Username column').toBeGreaterThanOrEqual(0);
    const shown = ((await rows.first().locator('td').nth(column).textContent()) ?? '').trim();
    if (shown !== args.username) {
      throw new Error(`the Username column shows ${shown === '' ? 'nothing' : `"${shown}"`} for a user whose login name is ${args.username}`);
    }
  }

  /**
   * ATC INT-002: a value that the front accepts and only the backend refuses (a name of 61 characters, a position of 101, a weak
   * password, an FTP service URL) is refused with 400 AND the form shows the message on that field, not the generic «Error inesperado».
   * Today the front has no such rules and the person only sees the generic toast (HAL-13, HAL-26, HAL-33).
   *
   * @param args - The tenant of the user form and the rows to try
   * @param args.tenantId - Tenant id (route of the user form)
   * @param args.rows - Values the front accepts and the backend refuses
   */
  @atc('INT-002')
  async showServerOnlyRulesOnTheirField(args: { tenantId: number, rows: ServerOnlyRule[] }): Promise<void> {
    const failures: string[] = [];
    for (const row of args.rows) {
      try {
        if (row.form === 'userapp') {
          await this.openUserAppForm(args.tenantId);
        }
        else {
          await this.openOperatorForm();
        }
        const status = await this.submitForm(row.form, row.values);
        if (status !== null && status !== 400) {
          failures.push(`${row.label}: the backend answered ${status} (expected a 400 refusal, or the front stopping the value)`);
          continue;
        }
        const messages = await this.fieldMessages();
        const generic = await this.page.getByText(GENERIC_ERROR).filter({ visible: true }).count();
        if (messages.length === 0) {
          failures.push(`${row.label}: no message under the "${row.field}" field${generic > 0 ? ' (only the generic «Error inesperado»)' : ''}`);
          await this.evidence(`int-002-${row.field}`);
        }
      }
      catch (error) {
        failures.push(`${row.label}: ${String((error as Error).message).split('\n')[0]}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} server-only rule checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC INT-004: when the backend answers `VALIDATION_ERROR` with several errors at once, each one is shown under its own field. The
   * user form is sent with a name of 61 characters and a position of 101: two fields the front lets through, two messages.
   *
   * @param args - The tenant and the values to send
   * @param args.tenantId - Tenant id (route of the user form)
   * @param args.values - Invalid values the front accepts
   * @param args.invalidFields - How many of them the backend refuses (one message each)
   */
  @atc('INT-004')
  async showEachValidationErrorOnItsField(args: { tenantId: number, values: Record<string, string>, invalidFields: number }): Promise<void> {
    await this.openUserAppForm(args.tenantId);
    const status = await this.submitForm('userapp', args.values);
    expect(status, 'control: the backend refuses the values the front lets through').toBe(400);
    const messages = await this.fieldMessages();
    const expected = args.invalidFields;
    if (messages.length < expected) {
      await this.evidence('int-004-form');
      const generic = await this.page.getByText(GENERIC_ERROR).filter({ visible: true }).count();
      throw new Error(`${messages.length} field message(s) shown for ${expected} invalid fields${generic > 0 ? ', and the generic «Error inesperado» is shown' : ''}`);
    }
  }

  /** The text of the first toast-like notice on screen (the SPA shows its notices as small cards at the bottom right), or an empty text. */
  private async noticeText(): Promise<string> {
    const notice = this.page.locator('[role="alert"], [role="status"]').first();
    return (await notice.isVisible().catch(() => false)) ? ((await notice.textContent()) ?? '').replace(/\s+/g, ' ').trim() : '';
  }

  /**
   * ATC INT-003: each failure code reaches the person as a clear message on screen: a 404 (an id that does not exist), a 400 (a value the
   * backend refuses) and a 429 (too many requests, forced in the browser). A blank screen, or the generic «Error inesperado», is wrong
   * (HAL-13, HAL-19, HAL-10).
   *
   * @param args - The values that make the backend answer 400 on the operator form
   * @param args.operator - An operator with an FTP service URL
   * @param args.operator.operatorCode - Operator code
   * @param args.operator.operatorName - Operator name
   * @param args.operator.serviceUrl - Service URL the backend refuses
   */
  @atc('INT-003')
  async showClearMessageForEachStatusCode(args: { operator: { operatorCode: string, operatorName: string, serviceUrl: string } }): Promise<void> {
    const failures: string[] = [];

    // 404: a tenant that does not exist
    await this.page.goto(this.buildUrl('/tenants/2147000000'));
    const notFound = this.page.getByText(/no fue encontrado|no encontrado|no existe/i).filter({ visible: true });
    try {
      await expect(notFound.first()).toBeVisible({ timeout: 12000 });
    }
    catch {
      failures.push(`404 (id that does not exist): no «not found» message is shown (notice: "${await this.noticeText() || 'none'}")`);
    }
    const mainText = ((await this.page.locator('main').textContent().catch(() => '')) ?? '').trim();
    if (mainText === '') {
      failures.push('404 (id that does not exist): the screen is left blank');
      await this.evidence('int-003-not-found');
    }

    // 400: a value the backend refuses
    await this.openOperatorForm();
    const status = await this.submitForm('operator', args.operator);
    const generic = await this.page.getByText(GENERIC_ERROR).filter({ visible: true }).count();
    if (status !== 400) {
      failures.push(`400 (value refused): the backend answered ${String(status)}`);
    }
    else if (generic > 0 && (await this.fieldMessages()).length === 0) {
      failures.push('400 (value refused): the screen shows only the generic «Error inesperado»');
      await this.evidence('int-003-bad-request');
    }

    // 429: too many requests, forced in the browser
    const tooMany = { status: 429, contentType: 'application/json', body: '{}' };
    await this.page.route(/\/api\/operators(\?|$)/i, async route => route.fulfill(tooMany));
    await this.page.goto(this.buildUrl('/operators'));
    const limited = this.page.getByText(/demasiad|l.mite|espera|m.s tarde/i).filter({ visible: true });
    try {
      await expect(limited.first()).toBeVisible({ timeout: 10000 });
    }
    catch {
      failures.push(`429 (too many requests): no message about the limit is shown (notice: "${await this.noticeText() || 'none'}")`);
    }
    await this.page.unroute(/\/api\/operators(\?|$)/i);

    if (failures.length > 0) {
      throw new Error(`${failures.length} status code message checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC INT-005: with the backend down, the Operadores and Usuarios screens show an error notice, stop the spinner and do NOT present the
   * empty list as «no records found» (a misleading state, HAL-53). The failure is forced by aborting the list request in the browser.
   */
  @atc('INT-005')
  async showErrorAndStopSpinnerWhenBackendDown(): Promise<void> {
    await this.page.route(/\/api\/(?:operators|user)(?:\?|$)/i, async route => route.abort());
    const failures: string[] = [];
    for (const [label, path] of [['Operadores', '/operators'], ['Usuarios', '/users']] as const) {
      await this.page.goto(this.buildUrl(path));
      try {
        await expect(this.page.getByText(/error/i).filter({ visible: true }).first()).toBeVisible({ timeout: 10000 });
      }
      catch {
        failures.push(`${label}: no error notice is shown`);
      }
      try {
        await expect(this.page.locator('app-loading-spinner')).toHaveCount(0, { timeout: 10000 });
      }
      catch {
        failures.push(`${label}: the spinner keeps spinning`);
      }
      if (await this.page.getByText(/No se encontraron/i).filter({ visible: true }).count() > 0) {
        failures.push(`${label}: the list says «No se encontraron» although the request failed (misleading empty state)`);
        await this.evidence(`int-005-${label.toLowerCase()}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} backend-down checks failed: ${failures.join('; ')}`);
    }
  }
}
