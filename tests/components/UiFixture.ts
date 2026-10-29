/**
 * KATA Architecture - Layer 4: UI Fixture
 *
 * Dependency Injection container for all UI components.
 * Provides unified access to UI testing capabilities.
 *
 * All UI components share the same page context from TestContext,
 * ensuring consistent browser state across components.
 *
 * HOW TO ADD NEW UI COMPONENTS:
 * 1. Create your component in tests/components/ui/YourPage.ts
 * 2. Import it here
 * 3. Add as readonly property
 * 4. Initialize in constructor passing the options
 */

import type { TestContextOptions } from '@TestContext';

import { ActivationPage } from '@ui/ActivationPage';
import { LoginPage } from '@ui/LoginPage';
import { OperatorsPage } from '@ui/OperatorsPage';
import { SessionPage } from '@ui/SessionPage';
import { ShellPage } from '@ui/ShellPage';
import { TenantAdminsPage } from '@ui/TenantAdminsPage';
import { TenantsPage } from '@ui/TenantsPage';
import { UiBase } from '@ui/UiBase';

// ============================================
// UI Fixture Class
// ============================================

export class UiFixture extends UiBase {
  /** Login page component - handles authentication flows */
  readonly login: LoginPage;

  /** Activation page component - account activation and resend flows */
  readonly activation: ActivationPage;

  /** Shell page component - signed-in shell: logout, reload and the role matrix (routes, menu, root redirect) */
  readonly shell: ShellPage;

  /** Session page component - token refresh and inactivity behaviours */
  readonly session: SessionPage;

  /** Operators page component - hostile names rendering (SEC-003), list and search (OPE-001), counter after create (OPE-012) */
  readonly operators: OperatorsPage;

  /** Tenant admins page component - load time of the Administradores tab (ADM-013) */
  readonly tenantAdmins: TenantAdminsPage;

  /** Tenants page component - tenant list and creation form (OPE-013) */
  readonly tenants: TenantsPage;

  constructor(options: TestContextOptions) {
    super(options);

    // All components receive the same options (same page context)
    this.login = new LoginPage(options);
    this.activation = new ActivationPage(options);
    this.shell = new ShellPage(options);
    this.session = new SessionPage(options);
    this.operators = new OperatorsPage(options);
    this.tenantAdmins = new TenantAdminsPage(options);
    this.tenants = new TenantsPage(options);
  }
}
