/**
 * KATA Architecture - Layer 3: Tenant Admins Page Component
 *
 * UI component for the "Administradores" tab of the tenant detail screen of the
 * Validate SPA (Administrator only). Covers the load time of the tab (ADM-013) and the
 * live reflection of an activation through the SSE stream (ADM-009).
 *
 * ATC ids are the local case ids under .context/QA/cases/ (no TMS in this project).
 *
 * Page: /tenants/:id (route `tenants`, child `:id`), tab "Administradores".
 * The SPA exposes no data-testid. Locators were verified live on an empty generated
 * tenant: the tab is a button (not role=tab), the empty state is its text.
 * The tenant is generated and deleted by the spec (TenantAdminAccountSteps); this
 * component only reads the page with the saved Administrator session.
 */

import { expect } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';

// ============================================
// Types
// ============================================

/** Arguments of the load-time ATC (one object, never positional). */
interface LoadTabArgs {
  /** Id of the generated tenant whose detail screen is opened */
  tenantId: number
}

/** One measured load of the tab, in milliseconds. */
interface TabLoadSample {
  /** Navigation to the tenant, click on the tab, until the ready condition is visible */
  uiMs: number
  /** Time the `GET tenant-admins` list request took to answer */
  apiMs: number
}

/** Arguments of the activation-events ATC (one object, never positional). */
interface ActivationEventArgs {
  /** Id of the generated tenant whose Administradores tab is open */
  tenantId: number
  /** Generated full name of the PENDING account: the row shows it (its "Correo" cell is empty) */
  fullName: string
  /** Activates that account while the tab is open (the Steps; an anonymous API call, no mail) */
  activate: () => Promise<void>
}

/** Time the badge gets to flip after the activation answered (the event travels over SSE). */
const BADGE_FLIP_TIMEOUT_MS = 15000;

/** Time the events stream (SSE) gets to answer its headers once the tab is open. */
const STREAM_OPEN_TIMEOUT_MS = 15000;

/** Upper bound of the list-response wait of ADM-013, so a missing response never dangles. */
const LIST_RESPONSE_TIMEOUT_MS = 15000;

/** ADM-013 limit ("Responde en tiempo razonable (< 3 s)"), in milliseconds. */
const LOAD_THRESHOLD_MS = 3000;

/** Measured loads per run, after one warm-up that is discarded. */
const SAMPLES = 3;

// ============================================
// Tenant Admins Page Component
// ============================================

export class TenantAdminsPage extends UiBase {
  // ============================================
  // Helpers (Private)
  // ============================================

  /** Median of a non-empty list of numbers. */
  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  }

  /**
   * Open the tenant, click the tab and wait until the list is ready: first the RESPONSE of the
   * list request, then the table or the empty message of a tenant without administrators (so an
   * empty state rendered before the answer cannot understate the time). The persistent SSE stream
   * `.../tenant-admins/events` is never timed and `networkidle` is never used.
   */
  private async loadTabOnce(tenantId: number): Promise<TabLoadSample> {
    const listUrl = new RegExp(`/tenants/${tenantId}/tenant-admins(\\?|$)`);
    const listResponse = this.page.waitForResponse(
      response => response.request().method() === 'GET' && listUrl.test(response.url()),
      { timeout: LIST_RESPONSE_TIMEOUT_MS },
    );
    // Never dangling: a rejection here is surfaced by the await below, not as an unhandled one
    listResponse.catch(() => undefined);

    try {
      // Documented deviation: the clock starts before `goto` (the whole user wait is measured)
      const started = performance.now();
      await this.page.goto(this.buildUrl(`/tenants/${tenantId}`));
      await this.page.getByRole('button', { name: 'Administradores' }).click();
      const response = await listResponse;
      await expect(
        this.page.getByRole('table').or(this.page.getByText('No hay administradores registrados')),
      ).toBeVisible();
      const uiMs = performance.now() - started;

      const timing = response.request().timing();
      return { uiMs, apiMs: timing.responseEnd - timing.requestStart };
    }
    finally {
      await listResponse.catch(() => undefined);
    }
  }

  // ============================================
  // ATCs - Complete Test Cases
  // ============================================

  /**
   * ATC ADM-013: the Administradores tab of a tenant loads in a reasonable time: the
   * median of 3 loads (after one discarded warm-up) is under 3000 ms, and so is the
   * median answer time of `GET tenant-admins`.
   *
   * IMPORTANT: Needs the saved Administrator session (project e2e default) and a
   * generated tenant (cleaned by the spec). No administrator is created: mail free.
   *
   * @param args - One object with the tenant to open
   * @param args.tenantId - Id of the generated tenant
   */
  @atc('ADM-013')
  async loadAdministratorsTabWithinThreshold({ tenantId }: LoadTabArgs): Promise<void> {
    // Warm-up: the first load pays cold caches and is not measured
    await this.loadTabOnce(tenantId);

    const samples: TabLoadSample[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      samples.push(await this.loadTabOnce(tenantId));
    }

    const uiMedian = this.median(samples.map(sample => sample.uiMs));
    const apiMedian = this.median(samples.map(sample => sample.apiMs));

    console.log(`---- ADM-013 samples (ms): ui ${samples.map(s => Math.round(s.uiMs)).join('/')}, api ${samples.map(s => Math.round(s.apiMs)).join('/')}; medians ui ${Math.round(uiMedian)}, api ${Math.round(apiMedian)}`);

    // Failing checks are collected and thrown once (a soft expect would hide the failure from @atc)
    const failures: string[] = [];
    if (uiMedian >= LOAD_THRESHOLD_MS) {
      failures.push(`tab load median ${Math.round(uiMedian)} ms`);
    }
    if (apiMedian >= LOAD_THRESHOLD_MS) {
      failures.push(`list request median ${Math.round(apiMedian)} ms`);
    }

    if (failures.length > 0) {
      throw new Error(`Administradores tab is not under ${LOAD_THRESHOLD_MS} ms: ${failures.join('; ')}`);
    }
  }

  /**
   * ATC ADM-009: the activation of an account is reflected in the Administradores tab without a
   * reload: the row flips from "Pendiente activación" to "Activo" with no page navigation and no
   * new list request (the SPA receives the `GET .../tenant-admins/events` SSE event).
   *
   * IMPORTANT: Needs the saved Administrator session (project e2e default) and a PENDING account
   * (the lifecycle chain, before its activation). The activation is triggered through the API by
   * the `activate` callback while the tab is open (no second browser tab); it sends no mail.
   * Locators for the row and the badges come from the SPA source and are UNVERIFIED LIVE.
   *
   * @param args - One object with the tenant, the pending account and the activation trigger
   * @param args.tenantId - Id of the generated tenant
   * @param args.fullName - Generated full name of the pending account (the row is found by it)
   * @param args.activate - Activates the account (API) while the tab is open
   */
  @atc('ADM-009')
  async showActivationWithoutReload({ tenantId, fullName, activate }: ActivationEventArgs): Promise<void> {
    const listUrl = new RegExp(`/tenants/${tenantId}/tenant-admins(\\?|$)`);
    const eventsUrl = new RegExp(`/tenants/${tenantId}/tenant-admins/events`);
    let navigations = 0;
    let listRequests = 0;
    let counting = false;

    this.page.on('request', (request) => {
      if (counting && request.method() === 'GET' && listUrl.test(request.url())) {
        listRequests++;
      }
    });
    this.page.on('framenavigated', (frame) => {
      if (counting && frame === this.page.mainFrame()) {
        navigations++;
      }
    });

    // Registered BEFORE the navigation: the stream opens as soon as the tab renders. The response
    // event fires with the headers, which is when the server accepted the stream.
    const streamResponse = this.page.waitForResponse(
      response => eventsUrl.test(response.url()),
      { timeout: STREAM_OPEN_TIMEOUT_MS },
    );
    const streamAccepted = streamResponse.then(() => true, () => false);

    await this.page.goto(this.buildUrl(`/tenants/${tenantId}`));
    await this.page.getByRole('button', { name: 'Administradores' }).click();

    const row = this.page.getByRole('row').filter({ hasText: fullName });
    await expect(row.getByText('Pendiente activación', { exact: true })).toBeVisible();

    // The event only reaches a stream that is already open: do not activate without it
    if (!(await streamAccepted)) {
      throw new Error(`events stream not accepted: no response from the events URL within ${STREAM_OPEN_TIMEOUT_MS} ms, the account was NOT activated`);
    }

    counting = true;
    try {
      await activate();
    }
    catch (error) {
      counting = false;
      throw new Error(`the activation trigger failed: ${String((error as Error).message).split(/\r?\n/)[0].slice(0, 200)}`);
    }

    // Failing checks are collected and thrown once (a soft expect would hide the failure from @atc)
    const failures: string[] = [];
    try {
      await expect(row.getByText('Activo', { exact: true })).toBeVisible({ timeout: BADGE_FLIP_TIMEOUT_MS });
      await expect(row.getByText('Pendiente activación', { exact: true })).toBeHidden();
    }
    catch {
      failures.push(`the row did not flip to "Activo" within ${BADGE_FLIP_TIMEOUT_MS} ms`);
    }
    counting = false;

    if (navigations > 0) {
      failures.push(`${navigations} page navigation(s) happened after the activation`);
    }
    if (listRequests > 0) {
      failures.push(`${listRequests} new list request(s) were sent after the activation`);
    }

    if (failures.length > 0) {
      throw new Error(`Activation was not reflected without a reload: ${failures.join('; ')}`);
    }
  }
}
