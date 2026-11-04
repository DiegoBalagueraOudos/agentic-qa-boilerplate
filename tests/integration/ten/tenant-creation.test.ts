/**
 * TEN block 2.2: tenant creation and its input rules (TEN-010 to TEN-025).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive Administrator login. Every tenant an
 * ATC creates (including any row the product wrongly accepts) is deleted before it ends. trace is off because the logins carry live
 * tokens and the bodies carry database passwords. TEN-013, 021 and 026 are screen behaviours and stay for the interface tests.
 */

import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TEN: tenant creation', () => {
  test('TEN-010: should create a tenant with the required data', async ({ api }) => {
    await api.tenantManagement.createTenantWithRequiredData();
  });

  test('TEN-011: should create a tenant with a logs database', async ({ api }) => {
    await api.tenantManagement.createTenantWithLogDatabase();
  });

  test('TEN-012: should enable the MAC-Serial validation after the create', async ({ api }) => {
    await api.tenantManagement.createTenantAndEnableMacSerialValidation();
  });

  test('TEN-014: should reject an invalid RNEC', async ({ api }) => {
    await api.tenantManagement.rejectInvalidRnecs();
  });

  test('TEN-015: should reject a duplicate RNEC', async ({ api }) => {
    await api.tenantManagement.rejectDuplicateRnec();
  });

  test('TEN-016: should validate the business name length and characters', async ({ api }) => {
    await api.tenantManagement.rejectInvalidBusinessNames();
  });

  test('TEN-017: should validate the database host formats', async ({ api }) => {
    await api.tenantManagement.validateDatabaseHosts();
  });

  test('TEN-018: should validate the database name and user', async ({ api }) => {
    await api.tenantManagement.validateDatabaseNameAndUser();
  });

  test('TEN-019: should validate the database password length', async ({ api }) => {
    await api.tenantManagement.validateDatabasePasswordLength();
  });

  test('TEN-020: should validate the logs database port', async ({ api }) => {
    await api.tenantManagement.validateLogDatabasePort();
  });

  test('TEN-022: should reject a contingency operator equal to the main one', async ({ api }) => {
    await api.tenantManagement.rejectContingencyEqualToMainOperator();
  });

  test('TEN-023: should reject negative and decimal parameters', async ({ api }) => {
    await api.tenantManagement.rejectNegativeAndDecimalParameters();
  });

  test('TEN-024: should validate the blocked fingers limit', async ({ api }) => {
    await api.tenantManagement.validateBlockedFingersLimit();
  });

  test('TEN-025: should create a tenant with only the required fields', async ({ api }) => {
    await api.tenantManagement.createTenantWithOnlyRequiredFields();
  });
});
