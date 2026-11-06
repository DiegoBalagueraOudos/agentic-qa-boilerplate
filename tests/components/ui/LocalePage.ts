/**
 * KATA Architecture - Layer 3: Locale Page Component (NF-08)
 *
 * Localization of the Validate SPA (Administrator): accents and `ñ` must survive every hop (the API, the Sedes tab, the "Exportar CSV"
 * file, a CSV imported from the modal) and the dates of the tenant list must use the `es-CO` format and show the right day for the
 * zone of the browser.
 *
 * Pages: /tenants (list) and /tenants/{id} (tab "Sedes", menu "Exportar CSV", "Importar CSV"). The SPA exposes no data-testid; locators
 * use roles, visible text and tags. The hour of the logs is NOT checked here (LOG-016-BUG-47 and INT-008-BUG-62 hold it).
 */

import type { Page } from '@playwright/test';

import { expect } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';
import { config } from '@variables';

/** A branch with accents the API already holds. */
export interface AccentBranch {
  name: string
  address: string
  department: string
}

export class LocalePage extends UiBase {
  /** Open the tenant detail on the "Sedes" tab. */
  private async openBranchesTab(tenantId: number): Promise<void> {
    await this.page.goto(this.buildUrl(`/tenants/${tenantId}`));
    await this.page.locator('tui-tabs button').filter({ hasText: /^\s*Sedes\s*$/ }).click();
  }

  /** A second browser context in another time zone with the same signed-in session. */
  private async openInZone(timezoneId: string): Promise<{ page: Page, close: () => Promise<void> }> {
    const source = this.page.context();
    const browser = source.browser();
    if (browser === null) {
      throw new Error('the browser of the page is not reachable');
    }
    const uiSession = await this.page.evaluate(key => sessionStorage.getItem(key), config.auth.uiSessionKey);
    const context = await browser.newContext({ storageState: await source.storageState(), timezoneId, locale: 'es-CO', ignoreHTTPSErrors: true });
    if (uiSession !== null) {
      await context.addInitScript(([key, value]) => {
        if (sessionStorage.getItem(key) === null) {
          sessionStorage.setItem(key, value);
        }
      }, [config.auth.uiSessionKey, uiSession] as const);
    }
    return { page: await context.newPage(), close: async () => context.close() };
  }

  /**
   * ATC NF-08: accents and `ñ` are kept in the Sedes tab, in the exported CSV and in a UTF-8 CSV imported from the modal, and the
   * creation date of the tenant list uses `dd/mm/aaaa` and shows the day of the API instant in the zone of the browser (Bogota and
   * Auckland). An instant without a zone designator is read as UTC.
   *
   * @param args - The tenant, its accented branches, the file to import and the readers
   * @param args.tenant - Tenant id and RNEC
   * @param args.tenant.id - Tenant id (route)
   * @param args.tenant.rnec - RNEC (the list is searched by it)
   * @param args.branches - Accented branches already created through the API
   * @param args.importFile - UTF-8 CSV with accented branches, and the names it must create
   * @param args.importFile.name - File name
   * @param args.importFile.content - CSV text
   * @param args.importFile.names - Branch names the import must create, exactly as written
   * @param args.readNames - Reads the names of the tenant branches that hold a search term, through the API
   * @param args.createdAt - Creation instant of the tenant as the API states it
   * @param args.zones - IANA time zones to open the list in
   */
  @atc('NF-08')
  async showAccentsAndDatesCorrectly(args: {
    tenant: { id: number, rnec: string }
    branches: AccentBranch[]
    importFile: { name: string, content: string, names: string[] }
    readNames: (term: string) => Promise<string[]>
    createdAt: string
    zones: string[]
  }): Promise<void> {
    const failures: string[] = [];

    // 1. the Sedes tab shows the accents the API holds
    await this.openBranchesTab(args.tenant.id);
    for (const branch of args.branches) {
      try {
        await expect(this.page.getByText(branch.name, { exact: true })).toBeVisible({ timeout: 8000 });
      }
      catch {
        failures.push(`the Sedes tab does not show "${branch.name}" as the API holds it`);
      }
    }

    // 2. the exported CSV keeps them
    await this.page.getByRole('button', { name: 'Exportar CSV' }).click();
    const downloadPromise = this.page.waitForEvent('download', { timeout: 20000 });
    await this.page.locator('div.z-20').getByRole('button', { name: 'Solo Sedes', exact: true }).click();
    const stream = await (await downloadPromise).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const exported = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
    for (const branch of args.branches) {
      for (const [what, value] of [['name', branch.name], ['address', branch.address], ['department', branch.department]] as const) {
        if (!exported.includes(value)) {
          failures.push(`the exported CSV does not hold the ${what} "${value}" as written`);
        }
      }
    }

    // 3. a UTF-8 CSV imported from the modal arrives intact
    await this.page.goto(this.buildUrl(`/tenants/${args.tenant.id}`));
    await this.page.getByRole('button', { name: 'Importar CSV' }).click();
    await this.page.locator('app-modal').getByRole('button', { name: 'Sedes' }).click();
    await this.page.locator('input[type="file"]').setInputFiles({ name: args.importFile.name, mimeType: 'text/csv', buffer: Buffer.from(args.importFile.content, 'utf8') });
    await this.page.getByRole('button', { name: 'Importar', exact: true }).click();
    try {
      await expect(this.page.getByText('Exitosos', { exact: true })).toBeVisible({ timeout: 30000 });
      const stored = await args.readNames('QAX');
      for (const name of args.importFile.names) {
        if (!stored.includes(name)) {
          failures.push(`the imported branch "${name}" is not held as written (the API has ${stored.filter(item => item.toLowerCase().includes(name.slice(0, 8).toLowerCase())).map(item => `"${item}"`).join(', ') || 'nothing like it'})`);
        }
      }
    }
    catch {
      failures.push('the import of the accented file gave no result');
    }

    // 4. the creation date: format and day in the zone of the browser
    const instant = /(?:Z|[+-]\d{2}:?\d{2})$/.test(args.createdAt) ? args.createdAt : `${args.createdAt}Z`;
    for (const zone of args.zones) {
      const view = await this.openInZone(zone);
      try {
        await view.page.goto(this.buildUrl('/tenants'));
        await view.page.getByPlaceholder('Buscar tenant...').fill(args.tenant.rnec);
        const row = view.page.getByRole('row').filter({ hasText: args.tenant.rnec });
        await expect(row).toHaveCount(1);
        const shown = ((await row.locator('td').nth(5).textContent()) ?? '').trim();
        const expected = new Intl.DateTimeFormat('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(new Date(instant));
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(shown)) {
          failures.push(`${zone}: the creation date reads "${shown}" (expected dd/mm/aaaa)`);
        }
        else if (shown !== expected) {
          failures.push(`${zone}: the creation date reads ${shown} (expected ${expected} for the API instant ${args.createdAt})`);
        }
      }
      catch (error) {
        failures.push(`${zone}: ${String((error as Error).message).split('\n')[0].slice(0, 200)}`);
      }
      finally {
        await view.close();
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} localization checks failed: ${failures.join('; ')}`);
    }
  }
}
