/**
 * KATA Architecture - Layer 3: Operators Page Component
 *
 * UI component for the operators list of the Validate SPA (Administrator only).
 * Covers the rendering of hostile operator names (SEC-003): free text the backend
 * does not validate must show as literal text, never as markup or script. Also the
 * list and search (OPE-001) and the footer counter after creating an operator through
 * the "Nuevo operador" modal (OPE-012).
 *
 * ATC ids are the local case ids under .context/QA/cases/ (no TMS in this project).
 *
 * Page: /operators
 * The SPA exposes no data-testid. Locators were verified live (SEC-003 and, in the
 * step-0 probe, OPE-001 and OPE-012): the search box by its placeholder, the rows by
 * role, the empty state by its text, the modal fields by their form control name.
 * The hostile operators are generated and deleted by the spec (SecurityDataSteps);
 * this component only reads the page with the saved Administrator session.
 */

import type { GeneratedOperator } from '@data/types';

import { expect } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';

// ============================================
// Types
// ============================================

/** Page-level evidence of script execution, filled by the detector installed before navigation. */
interface ExecutionEvidence {
  dialogs: number
}

/** Values typed in the "Nuevo operador" form. */
interface UiCreatedOperator {
  code: string
  name: string
  serviceUrl: string
}

/** Selector of elements a hostile name must never turn into inside the table. */
const INJECTED_ELEMENTS = 'img, script, svg[onload], [onerror], [onload]';

/** Hostile text typed in the search box (the echo of the search term must stay text too). */
const HOSTILE_SEARCH = '<img src=x onerror="window.__xss=9">';

// ============================================
// Operators Page Component
// ============================================

export class OperatorsPage extends UiBase {
  // ============================================
  // Helpers (Private)
  // ============================================

  /**
   * Install the execution detector BEFORE the page loads: a `dialog` listener and a
   * `window.__xss` probe (the hostile payloads set it when they run). Returns the
   * evidence counter.
   */
  private async installDetector(): Promise<ExecutionEvidence> {
    const evidence: ExecutionEvidence = { dialogs: 0 };
    this.page.on('dialog', async (dialog) => {
      evidence.dialogs += 1;
      await dialog.dismiss();
    });
    await this.page.addInitScript(() => {
      (window as unknown as { __xss?: unknown }).__xss = undefined;
    });
    return evidence;
  }

  /** The `window.__xss` flag: stays undefined unless a payload ran. */
  private async readExecutionFlag(): Promise<unknown> {
    return this.page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss);
  }

  // ============================================
  // ATCs - Complete Test Cases
  // ============================================

  /**
   * ATC SEC-003: hostile operator names render as literal text in the operators
   * table: the cell text equals the payload, no script or handler runs (no dialog,
   * `window.__xss` stays undefined) and no injected element appears in the table.
   * A hostile search term is also echoed as text.
   *
   * IMPORTANT: Needs the saved Administrator session (project e2e default) and the
   * generated operators already created by SecurityDataSteps (cleaned by the spec).
   * The "logs" half of the case is not covered (backend log is out of scope).
   *
   * @param operators - Generated hostile operators, one per payload kind
   */
  @atc('SEC-003')
  async showHostileNamesAsPlainText(operators: GeneratedOperator[]): Promise<void> {
    const evidence = await this.installDetector();
    await this.page.goto(this.buildUrl('/operators'));

    const search = this.page.getByPlaceholder('Buscar operador...');
    const table = this.page.getByRole('table');
    await expect(search).toBeVisible();

    // Failing checks are collected and thrown once (a soft expect would hide the failure from @atc)
    const failures: string[] = [];
    const check = async (label: string, assertion: () => Promise<void>) => {
      try {
        await assertion();
      }
      catch {
        failures.push(label);
      }
    };

    for (const operator of operators) {
      await search.fill(operator.code);
      await search.press('Enter');
      const row = this.page.getByRole('row').filter({ hasText: operator.code });
      await check(`${operator.kind}: row not found`, async () => {
        await expect(row).toHaveCount(1);
      });
      await check(`${operator.kind}: cell text differs from the payload`, async () => {
        await expect(row).toContainText(operator.name);
      });
      await check(`${operator.kind}: injected element in the table`, async () => {
        await expect(table.locator(INJECTED_ELEMENTS)).toHaveCount(0);
      });
      await check(`${operator.kind}: script flag set`, async () => {
        expect(await this.readExecutionFlag()).toBeUndefined();
      });
      await check(`${operator.kind}: dialog opened`, async () => {
        expect(evidence.dialogs).toBe(0);
      });
    }

    // A hostile search term: no result, echoed (if at all) as text, nothing runs
    await search.fill(HOSTILE_SEARCH);
    await search.press('Enter');
    await check('search term: empty state not shown', async () => {
      await expect(this.page.getByText('No se encontraron operadores')).toBeVisible();
    });
    await check('search term: injected element on the page', async () => {
      await expect(this.page.locator('img[src="x"], [onerror], [onload]')).toHaveCount(0);
    });
    await check('search term: script flag set or dialog opened', async () => {
      expect(await this.readExecutionFlag()).toBeUndefined();
      expect(evidence.dialogs).toBe(0);
    });

    if (failures.length > 0) {
      throw new Error(`${failures.length} hostile-rendering checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC OPE-001: the operators list shows a table with rows, and the search (server side,
   * confirmed with Enter) leaves exactly 1 row for the exact code, the same code in lower
   * case and the unique name text of a generated operator. A made-up `QAX` term shows the
   * empty state.
   *
   * IMPORTANT: Needs the saved Administrator session and a generated operator already created
   * by SecurityDataSteps (cleaned by the spec). The catalog is shared: only unique generated
   * values are searched.
   *
   * @param operator - Generated operator with a known code and unique name text
   */
  @atc('OPE-001')
  async listAndSearchOperators(operator: GeneratedOperator): Promise<void> {
    await this.page.goto(this.buildUrl('/operators'));

    const search = this.page.getByPlaceholder('Buscar operador...');
    const rows = this.page.getByRole('row');
    await expect(search).toBeVisible();

    const failures: string[] = [];
    const check = async (label: string, assertion: () => Promise<void>) => {
      try {
        await assertion();
      }
      catch {
        failures.push(label);
      }
    };

    await check('list: no data row in the table', async () => {
      await expect(this.page.getByRole('table')).toBeVisible();
      await expect(rows.nth(1)).toBeVisible();
    });

    const searches = [
      { label: 'exact code', term: operator.code },
      { label: 'lower case code', term: operator.code.toLowerCase() },
      { label: 'unique name text', term: operator.name },
    ];
    const madeUp = `QAX${operator.code}NOEXISTE`;
    const emptyState = this.page.getByText('No se encontraron operadores');
    const searchFor = async (term: string) => {
      await search.fill(term);
      await search.press('Enter');
    };
    for (const { label, term } of searches) {
      // A DIFFERENT state first (empty result), so the previous search can never satisfy this one
      await searchFor(madeUp);
      await check(`${label}: the empty state did not show before the search`, async () => {
        await expect(emptyState).toBeVisible();
      });
      await searchFor(term);
      await check(`${label}: expected exactly 1 row for the operator`, async () => {
        await expect(rows.filter({ hasText: operator.code })).toHaveCount(1);
        await expect(rows).toHaveCount(2);
      });
    }

    await searchFor(madeUp);
    await check('made-up term: empty state not shown', async () => {
      await expect(emptyState).toBeVisible();
    });

    if (failures.length > 0) {
      throw new Error(`${failures.length} list/search checks failed: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC OPE-012: after creating an operator through the "Nuevo operador" modal, WITHOUT
   * reloading, the footer total equals the previous total + 1 and the new row is visible.
   * The failure message carries facts only (before, after, expected, row visible).
   *
   * IMPORTANT: Needs the saved Administrator session. The caller must adopt the operator
   * by code (SecurityDataSteps.adoptOperatorIfCreated) so cleanup deletes it.
   *
   * @param operator - Unique generated values typed in the form: code, name and serviceUrl
   */
  @atc('OPE-012')
  async showCounterInSyncAfterCreate(operator: UiCreatedOperator): Promise<void> {
    await this.page.goto(this.buildUrl('/operators'));

    const counter = this.page.getByText(/operadores en total/);
    const emptyState = this.page.getByText('No se encontraron operadores');
    await expect(counter.or(emptyState)).toBeVisible();

    const readTotal = async (): Promise<number> => {
      if (!(await counter.isVisible())) {
        return 0;
      }
      const text = ((await counter.first().textContent()) ?? '').trim();
      return Number.parseInt(text, 10);
    };
    const before = await readTotal();

    await this.page.getByRole('button', { name: 'Nuevo operador' }).click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[formControlName="operatorCode"]').fill(operator.code);
    await dialog.locator('input[formControlName="operatorName"]').fill(operator.name);
    await dialog.locator('input[formControlName="serviceUrl"]').fill(operator.serviceUrl);
    await dialog.getByRole('button', { name: 'Crear operador' }).click();
    await expect(dialog).toBeHidden();

    // Without reload: the new row appears (the list patches its items), then the total is read
    const newRow = this.page.getByRole('row').filter({ hasText: operator.code });
    const rowVisible = await newRow.first().isVisible()
      || await expect(newRow.first()).toBeVisible().then(() => true, () => false);
    const expected = before + 1;
    await expect(counter).toHaveText(new RegExp(`^\\s*${expected}\\s+operadores en total`)).catch(() => undefined);
    const after = await readTotal();

    if (after !== expected || !rowVisible) {
      throw new Error(`Counter after create (no reload): before=${before}, after=${after}, expected=${expected}, new row visible=${rowVisible ? 'yes' : 'no'}`);
    }
  }
}
