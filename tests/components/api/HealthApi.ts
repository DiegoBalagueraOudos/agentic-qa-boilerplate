/**
 * KATA Architecture - Layer 3: Health API Component (SMK cases)
 *
 * The public health endpoint of the Validate API. No session, no encryption: a plain request, so the spec runs on an empty storage state.
 *
 * - SMK-01: `GET /api/health` answers 200 with an overall `Healthy` status and the four dependency checks (redis, postgres, mongodb,
 *   rabbitmq) `Healthy`. With RabbitMQ stopped the endpoint answers 503: that is an environment precondition of the case, named in the
 *   failure list.
 *
 * Nothing is printed beyond the check names and their statuses.
 */

import { ApiBase } from '@api/ApiBase';
import { atc } from '@utils/decorators';

/** The dependencies the health endpoint reports on. */
const EXPECTED_CHECKS = ['redis', 'postgres', 'mongodb', 'rabbitmq'];

interface HealthReport {
  status?: string
  checks?: Array<{ name?: string, status?: string }>
}

export class HealthApi extends ApiBase {
  /**
   * ATC SMK-01: the API reports itself and each dependency as healthy.
   *
   * IMPORTANT: needs Redis, PostgreSQL, MongoDB and RabbitMQ up. A 503 names the unhealthy dependency in the failure.
   */
  @atc('SMK-01')
  async reportEveryDependencyHealthy(): Promise<void> {
    const response = await this.request.get(this.apiEndpoint('/health'), { timeout: this.config.browser.defaultTimeout });
    const failures: string[] = [];
    if (response.status() !== 200) {
      failures.push(`HTTP ${response.status()} (expected 200)`);
    }
    const report = await response.json().catch(() => ({})) as HealthReport;
    if (report.status !== 'Healthy') {
      failures.push(`overall status ${String(report.status)} (expected Healthy)`);
    }
    const checks = report.checks ?? [];
    for (const name of EXPECTED_CHECKS) {
      const check = checks.find(item => item.name === name);
      if (check === undefined) {
        failures.push(`check "${name}" is missing`);
      }
      else if (check.status !== 'Healthy') {
        failures.push(`check "${name}" is ${String(check.status)} (expected Healthy)`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} health checks failed: ${failures.join('; ')}`);
    }
  }
}
