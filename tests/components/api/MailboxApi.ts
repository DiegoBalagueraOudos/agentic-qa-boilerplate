/**
 * KATA Architecture - Layer 3: Mailbox API Component (Mailtrap Email Sandbox)
 *
 * Reads the e-mails the backend sends to the test sandbox (welcome and resent
 * activation mails). It is NOT our backend: it talks to the Mailtrap REST API
 * through its own plain request context, with no crypto envelope and no
 * cookies, so it does not extend `SecureApi`. No ATC lives here.
 *
 * Endpoints (https://mailtrap.io/api/sandboxes/{sandbox_id}, header `Api-Token`):
 * - GET    /messages               - list (items: id, to_email, subject, created_at, is_read)
 * - GET    /messages/{id}/body.html - the HTML part (the mails have no text part)
 * - DELETE /messages/{id}          - remove one message
 *
 * Secret handling: the token is read from `config.mailbox` at the call and goes
 * ONLY in the `Api-Token` header built inside `call()`. A transport failure is
 * rethrown sanitised (no call log, no headers). Nothing here is a `@step`, is
 * attached to the report or prints a message body, and errors name the status
 * only. `readHtml` returns the raw body: callers must parse it in private
 * helpers and never log it.
 */

import type { APIRequestContext, APIResponse } from '@playwright/test';

import { expect, request as playwrightRequest } from '@playwright/test';
import { TestContext } from '@TestContext';

// ============================================
// Types
// ============================================

/** A mail in the sandbox, as listed (no body). */
export interface MailMessage {
  id: number
  /** ISO timestamp assigned by Mailtrap (orders the newest first). */
  createdAt: string
}

export interface WaitForMessageOptions {
  /** Poll budget in ms (default 30 s). */
  timeoutMs?: number
}

interface MailtrapListItem {
  id: number
  to_email: string
  created_at: string
}

const API_ROOT = 'https://mailtrap.io/api/sandboxes';
/** Per-request budget; the poll budget is separate. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Bounded retry on 429 / 5xx for the non-polling calls. */
const RETRY_EXTRA_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;
const RETRY_BUDGET_MS = 30_000;

function isTransient(response: APIResponse): boolean {
  return response.status() === 429 || response.status() >= 500;
}

// ============================================
// Mailbox API Component
// ============================================

export class MailboxApi extends TestContext {
  private context: APIRequestContext | null = null;

  // ============================================
  // Helpers (Private)
  // ============================================

  private async ensureContext(): Promise<APIRequestContext> {
    this.context ??= await playwrightRequest.newContext();
    return this.context;
  }

  /**
   * The only place that builds a Mailtrap request. A transport failure (the
   * Playwright error carries a call log with the request headers, the token
   * among them) is replaced by a new error with a short cause code.
   */
  private async call(method: 'GET' | 'DELETE', path: string, what: string): Promise<APIResponse> {
    const { apiToken, sandboxId } = this.config.mailbox;
    const context = await this.ensureContext();
    try {
      return await context.fetch(`${API_ROOT}/${encodeURIComponent(sandboxId)}${path}`, {
        method,
        headers: { 'Api-Token': apiToken },
        timeout: REQUEST_TIMEOUT_MS,
      });
    }
    catch (error) {
      const text = String((error as { code?: unknown, message?: unknown }).message ?? '').split(/\r?\n/)[0];
      const cause = /E[A-Z]{3}[A-Z_]*/.exec(text)?.[0] ?? (/timeout/i.test(text) ? 'timeout' : 'unknown');
      throw new Error(`mailbox ${what} failed on transport (${cause}); details withheld to protect the mailbox token`);
    }
  }

  /**
   * `call` with a bounded retry: at most 2 extra attempts on 429 or 5xx, short delay, small
   * overall budget. Any other answer (2xx, 401, 403, 404...) is returned at once.
   */
  private async callWithRetry(method: 'GET' | 'DELETE', path: string, what: string): Promise<APIResponse> {
    const deadline = Date.now() + RETRY_BUDGET_MS;
    let response = await this.call(method, path, what);
    for (let extra = 0; extra < RETRY_EXTRA_ATTEMPTS && isTransient(response) && Date.now() < deadline; extra++) {
      // Condition-based pause: poll until the delay has elapsed
      const resumeAt = Date.now() + RETRY_DELAY_MS;
      await expect.poll(() => Date.now() >= resumeAt, { timeout: RETRY_DELAY_MS + 2000, intervals: [250] }).toBe(true);
      response = await this.call(method, path, what);
    }
    return response;
  }

  /** Fail with the status only (never the body) when the mailbox does not answer 2xx. */
  private assertOk(response: APIResponse, what: string): void {
    if (!response.ok()) {
      throw new Error(`mailbox ${what} answered HTTP ${response.status()}`);
    }
  }

  /**
   * Messages to exactly this recipient, newest first. With `tolerateTransient` a 429 or
   * 5xx answer returns `undefined` ("not yet": the caller retries inside its budget);
   * any other non-2xx answer (401, 403, 404...) always fails at once with the status.
   */
  private async listMessagesTo(recipient: string, tolerateTransient = false): Promise<MailMessage[] | undefined> {
    const path = `/messages?search=${encodeURIComponent(recipient)}`;
    // The poll in waitForMessageTo is its own retry; the cleanup list gets the bounded one
    const response = tolerateTransient ? await this.call('GET', path, 'list') : await this.callWithRetry('GET', path, 'list');
    if (tolerateTransient && isTransient(response)) {
      return undefined;
    }
    this.assertOk(response, 'list');
    const items = (await response.json()) as MailtrapListItem[];
    return items
      .filter(item => item.to_email.toLowerCase() === recipient.toLowerCase())
      .map(item => ({ id: item.id, createdAt: item.created_at }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ============================================
  // Public helpers (no ATC)
  // ============================================

  /**
   * Wait until a message to exactly this recipient exists and return the newest
   * one. Condition-based poll with a bounded budget; 429 and 5xx answers count
   * as "not yet", any other non-2xx answer (401, 403, 404...) fails at once with the status.
   */
  async waitForMessageTo(recipient: string, options: WaitForMessageOptions = {}): Promise<MailMessage> {
    const { timeoutMs = 30_000 } = options;
    let found: MailMessage | undefined;
    await expect
      .poll(
        async () => {
          const messages = await this.listMessagesTo(recipient, true);
          found = messages?.[0];
          return found !== undefined;
        },
        {
          message: 'a mail to the generated recipient should arrive in the mailbox',
          timeout: timeoutMs,
          intervals: [500, 1000, 2000],
        },
      )
      .toBe(true);
    return found!;
  }

  /** Raw HTML of a message. Parse it in a private helper; never print or attach it. */
  async readHtml(message: MailMessage): Promise<string> {
    const response = await this.callWithRetry('GET', `/messages/${message.id}/body.html`, 'read body');
    this.assertOk(response, 'read body');
    return response.text();
  }

  /** Delete one message. */
  async deleteMessage(message: MailMessage): Promise<void> {
    const response = await this.callWithRetry('DELETE', `/messages/${message.id}`, 'delete message');
    this.assertOk(response, 'delete message');
  }

  /** Delete every message to exactly this recipient (cleanup). Other mails are never touched. */
  async deleteAllFor(recipient: string): Promise<void> {
    const messages = (await this.listMessagesTo(recipient)) ?? [];
    const failures: string[] = [];
    for (const message of messages) {
      try {
        await this.deleteMessage(message);
      }
      catch (error) {
        failures.push((error as Error).message);
      }
    }
    if (failures.length > 0) {
      throw new Error(`mailbox cleanup incomplete: ${failures.join('; ')}`);
    }
  }

  /** Close the request context. */
  async dispose(): Promise<void> {
    await this.context?.dispose().catch(() => undefined);
    this.context = null;
  }
}
