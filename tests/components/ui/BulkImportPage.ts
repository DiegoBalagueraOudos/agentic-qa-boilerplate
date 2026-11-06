/**
 * KATA Architecture - Layer 3: Bulk Import Page Component (NF-02)
 *
 * UI component for the CSV import modal of a tenant detail (Administrator): "Importar CSV" opens "Importar datos desde CSV", an entity
 * is picked (here "Sedes"), a `.csv` is chosen, "Importar" sends it in batches of 500 rows (`rowOffset` 0, 500, 1000...), and the result
 * tiles Total / Exitosos / Fallidos plus "Descargar errores" (a CSV `Fila,Campo,Mensaje`) close the flow.
 *
 * Page: /tenants/{id}. The SPA exposes no data-testid; locators use roles, visible text and the input type.
 */

import { expect } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';
import { parseCsv } from '@utils/zip';

/** What the import of the file must report. */
export interface ImportExpectation {
  /** Data rows in the file. */
  total: number
  /** Rows that are valid and must end up as branches. */
  imported: number
  /** The `Fila` of every bad row (the header is row 1). */
  errorRows: number[]
}

export class BulkImportPage extends UiBase {
  /** The number under a result tile ("Total", "Exitosos", "Fallidos"). */
  private async tile(label: string): Promise<number> {
    const text = await this.page.getByText(label, { exact: true }).locator('xpath=following-sibling::p').first().textContent();
    return Number((text ?? '').trim());
  }

  /**
   * ATC NF-02: a Sedes file of more than one batch is imported from the modal. It must end within `maxSeconds` with no error message,
   * go out in batches of 500 rows, report the right Total / Exitosos / Fallidos, list exactly the bad rows with their real `Fila`
   * (also when the first copy of a duplicate sits in another batch) and leave the good rows imported.
   *
   * @param args - The tenant, the file, what it must report and the reader of the imported branches
   * @param args.tenantId - Tenant id (route)
   * @param args.file - File name and CSV text (UTF-8)
   * @param args.file.name - File name
   * @param args.file.content - CSV text
   * @param args.expected - Totals and the bad rows
   * @param args.maxSeconds - Ceiling for the whole import, from the click to the result
   * @param args.countImported - Reads how many branches of the file the API holds
   */
  @atc('NF-02')
  async importLargeBranchFileWithRowErrors(args: {
    tenantId: number
    file: { name: string, content: string }
    expected: ImportExpectation
    maxSeconds: number
    countImported: () => Promise<number>
  }): Promise<void> {
    const offsets: number[] = [];
    this.page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'POST' && /\/branches\/import-csv$/i.test(url.pathname)) {
        offsets.push(Number(url.searchParams.get('rowOffset')));
      }
    });
    await this.page.goto(this.buildUrl(`/tenants/${args.tenantId}`));
    await this.page.getByRole('button', { name: 'Importar CSV' }).click();
    await this.page.locator('app-modal').getByRole('button', { name: 'Sedes' }).click();
    await this.page.locator('input[type="file"]').setInputFiles({ name: args.file.name, mimeType: 'text/csv', buffer: Buffer.from(args.file.content, 'utf8') });
    const started = Date.now();
    await this.page.getByRole('button', { name: 'Importar', exact: true }).click();

    const failures: string[] = [];
    try {
      await expect(this.page.getByText('Exitosos', { exact: true })).toBeVisible({ timeout: args.maxSeconds * 1000 });
    }
    catch {
      const label = ((await this.page.getByText(/Procesando/).first().textContent().catch(() => null)) ?? '').trim();
      throw new Error(`the import gave no result within ${args.maxSeconds} s${label === '' ? '' : ` (the screen still says "${label}")`}`);
    }
    const seconds = (Date.now() - started) / 1000;
    if (seconds > args.maxSeconds) {
      failures.push(`the import took ${seconds.toFixed(1)} s (ceiling ${args.maxSeconds} s)`);
    }

    const expectedOffsets = Array.from({ length: Math.ceil(args.expected.total / 500) }, (_, index) => index * 500);
    if (JSON.stringify(offsets) !== JSON.stringify(expectedOffsets)) {
      failures.push(`the batches went out with rowOffset [${offsets.join(', ')}] (expected [${expectedOffsets.join(', ')}])`);
    }
    const tiles = { total: await this.tile('Total'), imported: await this.tile('Exitosos'), failed: await this.tile('Fallidos') };
    if (tiles.total !== args.expected.total || tiles.imported !== args.expected.imported || tiles.failed !== args.expected.errorRows.length) {
      failures.push(`the tiles read Total ${tiles.total}, Exitosos ${tiles.imported}, Fallidos ${tiles.failed} (expected ${args.expected.total}, ${args.expected.imported}, ${args.expected.errorRows.length})`);
    }

    const downloadPromise = this.page.waitForEvent('download', { timeout: 15000 });
    await this.page.getByRole('button', { name: 'Descargar errores' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const [header = [], ...lines] = parseCsv(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
    if (header.join(',') !== 'Fila,Campo,Mensaje') {
      failures.push(`the errors file header is "${header.join(',')}" (expected "Fila,Campo,Mensaje")`);
    }
    const reported = lines.filter(line => line.some(cell => cell !== '')).map(line => Number(line[0])).sort((a, b) => a - b);
    const expectedRows = [...args.expected.errorRows].sort((a, b) => a - b);
    if (JSON.stringify(reported) !== JSON.stringify(expectedRows)) {
      failures.push(`the errors file lists the rows [${reported.join(', ')}] (expected [${expectedRows.join(', ')}])`);
    }

    const imported = await args.countImported();
    if (imported !== args.expected.imported) {
      failures.push(`the API holds ${imported} branch(es) of the file (expected ${args.expected.imported})`);
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} large import checks failed: ${failures.join('; ')}`);
    }
  }
}
