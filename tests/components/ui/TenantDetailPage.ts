/**
 * KATA Architecture - Layer 3: Tenant Detail Page Component
 *
 * UI component for the detail of one tenant of the Validate SPA (Administrator): the resources tabs (Usuarios, Sedes...) and the
 * "Exportar CSV" menu. Holds UAP-014 (the users counter after creating) and TEN-082 (the CSV exports).
 *
 * Page: /tenants/{id}
 * The SPA exposes no data-testid; locators use visible text and roles.
 */

import { expect } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';
import { parseCsv } from '@utils/zip';

/** One export of the menu: the menu entry, the file the SPA names and the rows the tenant must hold in it. */
export interface ExportExpectation {
  entry: string
  file: RegExp
  rows: number
}

export class TenantDetailPage extends UiBase {
  /**
   * ATC UAP-014: the footer counter "N usuarios en total" and the rows agree right after creating a user, with no reload. The tenant
   * starts with one user (counter 1, one row); the form creates a second and the counter must read 2 with two rows.
   *
   * @param args - The generated tenant with one UserApp and the user to create through the form
   * @param args.tenantId - Tenant id (route)
   * @param args.user - Values typed in the form
   * @param args.user.fullName - Full name
   * @param args.user.username - Login name
   * @param args.user.password - Password typed in the form and never printed
   */
  @atc('UAP-014')
  async keepUsersCounterAfterCreating(args: { tenantId: number, user: { fullName: string, username: string, password: string } }): Promise<void> {
    await this.page.goto(this.buildUrl(`/tenants/${args.tenantId}`));
    await this.page.getByText('Usuarios App', { exact: true }).click();
    await expect(this.page.getByText('1 usuarios en total')).toBeVisible();
    await expect(this.page.locator('tbody tr')).toHaveCount(1);

    await this.page.getByRole('button', { name: 'Nuevo usuario' }).click();
    await this.page.locator('input[formcontrolname="fullName"]').fill(args.user.fullName);
    await this.page.locator('input[formcontrolname="username"]').fill(args.user.username);
    await this.fillSecret(this.page.locator('input[formcontrolname="password"]'), args.user.password);
    await this.page.getByRole('button', { name: 'Crear usuario' }).click();
    await expect(this.page.getByRole('button', { name: 'Crear usuario' })).toBeHidden({ timeout: 15000 });

    const failures: string[] = [];
    try {
      await expect(this.page.locator('tbody tr')).toHaveCount(2);
    }
    catch {
      failures.push(`${await this.page.locator('tbody tr').count()} row(s) after creating (expected 2)`);
    }
    try {
      await expect(this.page.getByText('2 usuarios en total')).toBeVisible({ timeout: 5000 });
    }
    catch {
      const footer = await this.page.getByText(/usuarios en total/).first().textContent().catch(() => null);
      failures.push(`the counter reads "${(footer ?? 'nothing').trim()}" after creating (expected "2 usuarios en total")`);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} users counter checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC TEN-082: every entry of "Exportar CSV" downloads a CSV with the rows the tenant holds, without sensitive columns or values,
   * and with a UTF-8 BOM (so Excel reads the accents).
   *
   * @param args - The tenant, the expected exports and the secrets that must never appear in a file
   * @param args.tenantId - Tenant id (route)
   * @param args.exports - Menu entries with their file pattern and expected row count
   * @param args.secrets - Values (passwords) that must not appear in any export
   */
  @atc('TEN-082')
  async exportTenantDataToCsv(args: { tenantId: number, exports: ExportExpectation[], secrets: string[] }): Promise<void> {
    await this.page.goto(this.buildUrl(`/tenants/${args.tenantId}`));
    const failures: string[] = [];
    for (const expected of args.exports) {
      await this.page.getByRole('button', { name: 'Exportar CSV' }).click();
      const downloadPromise = this.page.waitForEvent('download', { timeout: 20000 });
      await this.page.locator('div.z-20').getByRole('button', { name: expected.entry, exact: true }).click();
      let name = expected.entry;
      try {
        const download = await downloadPromise;
        name = download.suggestedFilename();
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk as Uint8Array));
        }
        const bytes = Buffer.concat(chunks);
        if (!expected.file.test(name)) {
          failures.push(`${expected.entry}: the file is named ${name} (expected ${expected.file})`);
        }
        if (!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)) {
          failures.push(`${name}: the file has no UTF-8 BOM`);
        }
        const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
        const [header = [], ...lines] = parseCsv(text);
        const lineCount = lines.filter(line => line.some(cell => cell !== '')).length;
        if (lineCount !== expected.rows) {
          failures.push(`${name}: ${lineCount} data row(s) (expected ${expected.rows})`);
        }
        const sensitive = header.filter(column => /pass|hash|token|secret|clave|contrase/i.test(column));
        if (sensitive.length > 0) {
          failures.push(`${name}: sensitive column(s) ${sensitive.join(', ')}`);
        }
        if (args.secrets.some(secret => secret !== '' && text.includes(secret))) {
          failures.push(`${name}: a password appears in the file`);
        }
      }
      catch (error) {
        failures.push(`${name}: no download (${String((error as Error).message).split('\n')[0]})`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} CSV export checks failed: ${failures.join('; ')}`);
    }
  }
}
