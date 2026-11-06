/**
 * KATA Architecture - Layer 3: Logs Page Component
 *
 * UI component for the Administrator log review screen "Log Consultas" of the Validate SPA.
 *
 * Page: /log-consultas-nr
 * The SPA exposes no data-testid; locators use visible text, roles and the input types.
 * Holds LOG-002 (nothing is queried without a tenant and dates) and LOG-016 (the ZIP/CSV export).
 */

import type { LogDoc } from '@steps/LogSeedSteps';

import { expect } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';
import { parseCsv, readZipTextEntries } from '@utils/zip';

/** Header the SPA writes in the exported CSV. */
const CSV_HEADER = 'SearchStatus,NUT,RequestId,OperatorId,ClienteId,AplicantId,StartDate,EndDate,IdFinger1,IdFinger2,FingerPrintFormat,StatusFinger1,StatusFinger2,OperationDate,ServerName,ServerIP,ServerMac';

/** Calendar date (`YYYY-MM-DD`, UTC) `days` away from today. */
function dateAway(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export class LogsPage extends UiBase {
  /**
   * ATC LOG-002: with no tenant and no dates "Ver datos" does not query: the screen asks for a tenant and both dates, the empty state
   * invites to pick them, the export is disabled and no log request leaves the browser.
   */
  @atc('LOG-002')
  async requireTenantAndDatesBeforeQuerying(): Promise<void> {
    const requests: string[] = [];
    this.page.on('request', (request) => {
      if (request.url().includes('/logs/consultas-nr')) {
        requests.push(request.url());
      }
    });
    await this.page.goto(this.buildUrl('/log-consultas-nr'));
    const failures: string[] = [];
    const check = async (label: string, assertion: () => Promise<void>) => {
      try {
        await assertion();
      }
      catch {
        failures.push(label);
      }
    };

    await expect(this.page.getByRole('heading', { name: 'Log Consultas' })).toBeVisible();
    await check('the empty state does not ask to pick a tenant and a date range', async () => {
      await expect(this.page.getByText('Selecciona un tenant y un rango de fechas, luego haz clic en Ver datos')).toBeVisible();
    });
    await check('"Exportar ZIP" is enabled before any query', async () => {
      await expect(this.page.getByRole('button', { name: 'Exportar ZIP' })).toBeDisabled();
    });

    await this.page.getByRole('button', { name: 'Ver datos' }).click();
    await check('the tenant is not asked for', async () => {
      await expect(this.page.getByText('Selecciona un tenant', { exact: true })).toBeVisible();
    });
    await check('the start date is not asked for', async () => {
      await expect(this.page.getByText('Falta fecha inicial', { exact: true })).toBeVisible();
    });
    await check('the end date is not asked for', async () => {
      await expect(this.page.getByText('Falta fecha final', { exact: true })).toBeVisible();
    });
    await check('"Exportar ZIP" is enabled after the refused query', async () => {
      await expect(this.page.getByRole('button', { name: 'Exportar ZIP' })).toBeDisabled();
    });
    if (requests.length > 0) {
      failures.push(`${requests.length} log request(s) were sent without a tenant and dates`);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} log screen checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC LOG-016: "Exportar ZIP" downloads a ZIP with `log-consultas-nr.csv`: the header, one line per row of the query (the seeded
   * rows of the generated tenant), the seeded values in the right columns, quoted values, and no `IdInscripcion` column.
   *
   * @param args - The generated tenant and its seeded rows
   * @param args.tenant - Generated tenant (name and RNEC, searched in the selector)
   * @param args.tenant.name - Business name shown in the selector
   * @param args.tenant.rnec - RNEC shown as the option subtitle
   * @param args.rows - Seeded rows of that tenant in this view, newest first
   */
  @atc('LOG-016')
  async exportQueriesToCsv(args: { tenant: { name: string, rnec: string }, rows: LogDoc[] }): Promise<void> {
    await this.page.goto(this.buildUrl('/log-consultas-nr'));
    await this.page.getByRole('button', { name: /Todos los tenants/ }).click();
    await this.page.getByPlaceholder('Buscar...').fill(args.tenant.rnec);
    await this.page.getByRole('button').filter({ hasText: args.tenant.name }).filter({ hasText: args.tenant.rnec }).click();

    await this.fillSecret(this.page.locator('input[type="date"]').first(), dateAway(-40));
    await this.fillSecret(this.page.locator('input[type="date"]').nth(1), dateAway(-1));
    await this.page.getByRole('button', { name: 'Ver datos' }).click();
    await expect(this.page.getByText(`${args.rows.length} registros en total`)).toBeVisible();

    const downloadPromise = this.page.waitForEvent('download');
    await this.page.getByRole('button', { name: 'Exportar ZIP' }).click();
    const download = await downloadPromise;
    const failures: string[] = [];
    if (download.suggestedFilename() !== 'log-consultas-nr.zip') {
      failures.push(`the download is named ${download.suggestedFilename()} (expected log-consultas-nr.zip)`);
    }
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const entries = readZipTextEntries(Buffer.concat(chunks));
    const csv = entries['log-consultas-nr.csv'];
    if (csv === undefined) {
      throw new Error(`the ZIP holds ${Object.keys(entries).join(', ') || 'nothing'} (expected log-consultas-nr.csv)`);
    }

    const table = parseCsv(csv);
    const [header, ...lines] = table;
    if (header.join(',') !== CSV_HEADER) {
      failures.push('the CSV header differs from the expected columns');
    }
    if (header.includes('IdInscripcion')) {
      failures.push('the CSV carries the IdInscripcion column');
    }
    if (lines.length !== args.rows.length) {
      failures.push(`the CSV has ${lines.length} data row(s) (expected ${args.rows.length})`);
    }
    const column = (name: string) => header.indexOf(name);
    const byNut = new Map(lines.map(line => [line[column('NUT')], line]));
    const mapping: Array<[string, string]> = [['RequestId', 'RequestId'], ['OperatorId', 'OperatorId'], ['ClienteId', 'ClientId'], ['AplicantId', 'AplicantId'], ['IdFinger1', 'IdFinger1'], ['IdFinger2', 'IdFinger2'], ['FingerPrintFormat', 'FingerPrintFormat'], ['StatusFinger1', 'StatusFinger1'], ['StatusFinger2', 'StatusFinger2'], ['ServerName', 'ServerName'], ['ServerIP', 'ServerIP'], ['ServerMac', 'ServerMac']];
    const different: string[] = [];
    for (const doc of args.rows) {
      const line = byNut.get(String(doc.Id));
      if (line === undefined) {
        different.push(`${String(doc.Id)} (missing)`);
        continue;
      }
      for (const [csvName, field] of mapping) {
        if ((line[column(csvName)] ?? '') !== String(doc[field] ?? '')) {
          different.push(`${String(doc.Id)}.${csvName}`);
        }
      }
      const exported = line[column('OperationDate')] ?? '';
      if (new Date(exported).getTime() !== new Date(String(doc.OperationDate)).getTime()) {
        different.push(`${String(doc.Id)}.OperationDate (exported "${exported}", stored "${String(doc.OperationDate)}")`);
      }
    }
    if (different.length > 0) {
      failures.push(`${different.length} value(s) differ from the stored rows (${different.slice(0, 5).join(', ')})`);
    }
    const unquoted = csv.split('\n').slice(1).filter(line => line.trim() !== '' && !line.split(',').every(cell => cell === '' || cell.startsWith('"')));
    if (unquoted.length > 0) {
      failures.push(`${unquoted.length} CSV line(s) with unquoted values`);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} log export checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC INT-008: the date of a log row means the same instant on the screen, in the API and in the exported CSV. The screen shows the
   * stored time (12:00 for a row stored at 12:00Z, as the API returns it); the CSV must carry the same instant, not five hours later
   * (HAL-37).
   *
   * @param args - The generated tenant and its seeded rows
   * @param args.tenant - Generated tenant (name and RNEC, searched in the selector)
   * @param args.tenant.name - Business name shown in the selector
   * @param args.tenant.rnec - RNEC shown as the option subtitle
   * @param args.rows - Seeded rows of that tenant in this view, newest first
   */
  @atc('INT-008')
  async showSameInstantOnScreenAndCsv(args: { tenant: { name: string, rnec: string }, rows: LogDoc[] }): Promise<void> {
    await this.page.goto(this.buildUrl('/log-consultas-nr'));
    await this.page.getByRole('button', { name: /Todos los tenants/ }).click();
    await this.page.getByPlaceholder('Buscar...').fill(args.tenant.rnec);
    await this.page.getByRole('button').filter({ hasText: args.tenant.name }).filter({ hasText: args.tenant.rnec }).click();
    await this.fillSecret(this.page.locator('input[type="date"]').first(), dateAway(-40));
    await this.fillSecret(this.page.locator('input[type="date"]').nth(1), dateAway(-1));
    await this.page.getByRole('button', { name: 'Ver datos' }).click();
    await expect(this.page.getByText(`${args.rows.length} registros en total`)).toBeVisible();

    const newest = args.rows[0];
    const stored = new Date(String(newest.OperationDate)).getTime();
    const header = await this.page.locator('thead th').allTextContents();
    const column = header.findIndex(text => text.trim() === 'OperationDate');
    expect(column, 'the table has an OperationDate column').toBeGreaterThanOrEqual(0);
    const row = this.page.locator('tbody tr').filter({ hasText: String(newest.Id) });
    const shown = ((await row.first().locator('td').nth(column).textContent()) ?? '').trim();
    // The screen text is `YYYY-MM-DD HH:mm:ss.SSS` with no zone: the same wall-clock time as the stored UTC instant when it reads like it
    const onScreen = new Date(`${shown.replace(' ', 'T')}Z`).getTime();

    const downloadPromise = this.page.waitForEvent('download');
    await this.page.getByRole('button', { name: 'Exportar ZIP' }).click();
    const download = await downloadPromise;
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const csv = readZipTextEntries(Buffer.concat(chunks))['log-consultas-nr.csv'] ?? '';
    const [header2, ...lines] = parseCsv(csv);
    const line = lines.find(item => item[header2.indexOf('NUT')] === String(newest.Id));
    const exported = new Date(line?.[header2.indexOf('OperationDate')] ?? '').getTime();

    const failures: string[] = [];
    if (onScreen !== stored) {
      failures.push(`the screen shows "${shown}" for a row stored at ${String(newest.OperationDate)}`);
    }
    if (exported !== stored) {
      failures.push(`the CSV carries ${line?.[header2.indexOf('OperationDate')] ?? 'no row'} for a row stored at ${String(newest.OperationDate)}`);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} date consistency checks failed: ${failures.join('; ')}`);
    }
  }
}
