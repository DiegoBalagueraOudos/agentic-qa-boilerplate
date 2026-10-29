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

import { expect } from '@playwright/test';
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
}
