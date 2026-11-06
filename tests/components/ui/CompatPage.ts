/**
 * KATA Architecture - Layer 3: Compatibility Page Component (NF-04)
 *
 * The same short Administrator walk in several browsers, to prove the SPA behaves the same: sign in, dashboard, tenant list, a tenant
 * detail, the "Nuevo operador" form and sign out. Each browser gives one "observation" (URLs, counts, texts); every observation must
 * equal the first one.
 *
 * The browsers are launched by the spec (Chromium, Edge, Firefox) and handed over as `Page` objects with a `signIn` callback built
 * from `UiSessionSteps`, so credentials never reach this class. The SPA exposes no data-testid; locators use roles, text and tags.
 */

import type { Page } from '@playwright/test';

import { expect } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';

/** One browser the walk runs in. */
export interface CompatBrowser {
  label: string
  page: Page
  signIn: () => Promise<void>
}

/** What the walk saw; two browsers are "equivalent" when these are equal. */
interface Observation {
  afterSignIn: string
  cards: number
  listRow: string
  detailPath: string
  tabs: string[]
  operatorFields: string[]
  afterSignOut: string
}

export class CompatPage extends UiBase {
  /** Run the walk in one browser and report what it saw. */
  private async walk(browser: CompatBrowser, tenant: { rnec: string }): Promise<Observation> {
    const { page } = browser;
    await browser.signIn();
    await expect(page.getByText('Resumen del sistema multitenant')).toBeVisible();
    const afterSignIn = new URL(page.url()).pathname;
    await expect(page.locator('app-stat-card').first()).toBeVisible();
    const cards = await page.locator('app-stat-card').count();

    await page.goto(this.buildUrl('/tenants'));
    await page.getByPlaceholder('Buscar tenant...').fill(tenant.rnec);
    const row = page.getByRole('row').filter({ hasText: tenant.rnec });
    await expect(row).toHaveCount(1);
    const listRow = ((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    await row.getByRole('link', { name: /Ver/ }).click();
    await expect(page).toHaveURL(/\/tenants\/\d+$/);
    const detailPath = new URL(page.url()).pathname.replace(/\d+$/, '{id}');
    await expect(page.locator('tui-tabs button').first()).toBeVisible();
    const tabs = (await page.locator('tui-tabs button').allTextContents()).map(text => text.replace(/\s+/g, ' ').trim());

    await page.goto(this.buildUrl('/operators'));
    await page.getByRole('button', { name: 'Nuevo operador' }).click();
    await expect(page.locator('input[formcontrolname="operatorCode"]')).toBeVisible();
    const operatorFields = await page.locator('form input[formcontrolname]').evaluateAll(inputs => inputs.map(input => input.getAttribute('formcontrolname') ?? ''));
    await page.getByRole('button', { name: 'Cancelar' }).click();

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login$/);
    return { afterSignIn, cards, listRow, detailPath, tabs, operatorFields, afterSignOut: new URL(page.url()).pathname };
  }

  /**
   * ATC NF-04: the same walk gives the same observation in every browser. Each browser must also have SEEN something (a walk that saw
   * nothing would be equal to another that saw nothing).
   *
   * @param args - The browsers, in order (the first one is the reference) and the generated tenant to open
   * @param args.browsers - Label, page and sign-in of each browser
   * @param args.tenant - Generated tenant (found in the list by its RNEC)
   * @param args.tenant.rnec - RNEC
   */
  @atc('NF-04')
  async showSameResultInEveryBrowser(args: { browsers: CompatBrowser[], tenant: { rnec: string } }): Promise<void> {
    const failures: string[] = [];
    const seen = new Map<string, Observation>();
    for (const browser of args.browsers) {
      try {
        seen.set(browser.label, await this.walk(browser, args.tenant));
      }
      catch (error) {
        failures.push(`${browser.label}: the walk stopped (${String((error as Error).message).split('\n')[0].slice(0, 200)})`);
      }
    }
    const [reference] = [...seen.entries()];
    if (reference !== undefined) {
      const [referenceLabel, expected] = reference;
      if (expected.cards === 0 || expected.tabs.length === 0 || expected.operatorFields.length === 0) {
        failures.push(`${referenceLabel}: the walk saw nothing to compare (${expected.cards} cards, ${expected.tabs.length} tabs, ${expected.operatorFields.length} form fields)`);
      }
      for (const [label, observation] of seen) {
        for (const key of Object.keys(expected) as Array<keyof Observation>) {
          if (JSON.stringify(observation[key]) !== JSON.stringify(expected[key])) {
            failures.push(`${label} differs from ${referenceLabel} in ${key}: ${JSON.stringify(observation[key]).slice(0, 120)} (expected ${JSON.stringify(expected[key]).slice(0, 120)})`);
          }
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} browser compatibility checks failed: ${failures.join('; ')}`);
    }
  }
}
