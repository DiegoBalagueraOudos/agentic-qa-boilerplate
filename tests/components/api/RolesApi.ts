/**
 * KATA Architecture - Layer 3: Roles API Component (USR-012)
 *
 * Platform roles. Creating and editing roles needs the SuperAdminSistema policy (the Administrator session). The
 * delete is a soft one (`IsActive` false). Roles are GLOBAL, so every generated role is named `QAX...` and is
 * deactivated before the ATC ends.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - GET    /Role/{id}   - read one
 * - POST   /Role        - create (today it always fails: the controller never sets `CreatedBy`, HAL-42)
 * - PUT    /Role/{id}   - update
 * - DELETE /Role/{id}   - deactivate
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope } from '@schemas/auth.types';
import type { RoleData } from '@schemas/resources.types';

import { SecureApi } from '@api/SecureApi';
import { atc } from '@utils/decorators';

/** Record a failure line when `ok` is false. */
function verify(failures: string[], ok: boolean, text: string): void {
  if (!ok) {
    failures.push(text);
  }
}

export class RolesApi extends SecureApi {
  /** Create a role with ANY body; asserts nothing. */
  async attemptCreateRole(payload: object): Promise<[APIResponse, ApiEnvelope<RoleData>]> {
    return this.securePOST<RoleData, object>('/Role', payload);
  }

  /** Update a role with ANY body; asserts nothing. */
  async attemptUpdateRole(roleId: number, payload: object): Promise<[APIResponse, ApiEnvelope<RoleData>]> {
    return this.securePUT<RoleData, object>(`/Role/${roleId}`, payload);
  }

  /** Read one role; asserts nothing. */
  async getRole(roleId: number): Promise<[APIResponse, ApiEnvelope<RoleData>]> {
    return this.secureGET<RoleData>(`/Role/${roleId}`);
  }

  /** Deactivate a role; asserts nothing (cleanup tolerates one that is already gone). */
  async attemptDeleteRole(roleId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.secureDELETE<unknown>(`/Role/${roleId}`);
  }

  /** First line of an error, for a failure list. */
  private firstLine(error: unknown): string {
    return String((error as Error).message ?? error).split(/\r?\n/)[0].slice(0, 200);
  }

  /**
   * USR-012: create and edit a role. Creating a valid role must answer 200 (today it answers 400 «El creador es requerido»,
   * HAL-42: the failure is reported and the rest cannot run). With a role created: rename it (200, read-back), a name of 51
   * characters is refused on create and on edit (400 `VALIDATION_ERROR`), a name of 50 characters is accepted, and a duplicate
   * name is refused (400 `ROLE_DUPLICATE`). Every role created is deactivated at the end.
   */
  @atc('USR-012')
  async createAndEditRole(): Promise<void> {
    const failures: string[] = [];
    const createdIds: number[] = [];
    const track = (body: ApiEnvelope<RoleData>) => {
      const id = body.Data?.IdRole;
      if (typeof id === 'number' && id > 0) {
        createdIds.push(id);
      }
      return typeof id === 'number' && id > 0 ? id : 0;
    };

    await this.openAdministratorSession();
    try {
      const name = this.data.createRoleNameOfLength(20);
      const [createResponse, created] = await this.attemptCreateRole({ RoleName: name });
      const roleId = track(created);
      const createText = `${created.Error ?? ''} ${JSON.stringify(created.ValidationErrors ?? [])}`;
      verify(failures, createResponse.status() === 200 && created.Ok === true && roleId > 0, `create a valid role: HTTP ${createResponse.status()} ${created.CodeError ?? 'no error code'} ${createText.trim().slice(0, 80)} (expected 200 and a role)`);
      if (roleId > 0) {
        const renamed = this.data.createRoleNameOfLength(20);
        const [editResponse, edited] = await this.attemptUpdateRole(roleId, { RoleName: renamed });
        verify(failures, editResponse.status() === 200 && edited.Ok === true, `rename: HTTP ${editResponse.status()} ${edited.CodeError ?? 'no error code'}`);
        const [readResponse, read] = await this.getRole(roleId);
        verify(failures, readResponse.status() === 200 && read.Data?.RoleName === renamed && read.Data.IsActive === true, 'read after the rename: name is not the new value or the role is not active');

        const [longEditResponse, longEdit] = await this.attemptUpdateRole(roleId, { RoleName: this.data.createRoleNameOfLength(51) });
        verify(failures, longEditResponse.status() === 400 && longEdit.CodeError === 'VALIDATION_ERROR', `edit with 51 characters: HTTP ${longEditResponse.status()} CodeError=${String(longEdit.CodeError)} (expected 400, VALIDATION_ERROR)`);
        const [longResponse, long] = await this.attemptCreateRole({ RoleName: this.data.createRoleNameOfLength(51) });
        track(long);
        verify(failures, longResponse.status() === 400 && long.CodeError === 'VALIDATION_ERROR', `create with 51 characters: HTTP ${longResponse.status()} CodeError=${String(long.CodeError)} (expected 400, VALIDATION_ERROR)`);
        const [limitResponse, limit] = await this.attemptCreateRole({ RoleName: this.data.createRoleNameOfLength(50) });
        track(limit);
        verify(failures, limitResponse.status() === 200 && limit.Ok === true, `create with 50 characters: HTTP ${limitResponse.status()} ${limit.CodeError ?? 'no error code'} (expected 200)`);
        const [duplicateResponse, duplicate] = await this.attemptCreateRole({ RoleName: renamed });
        track(duplicate);
        verify(failures, duplicateResponse.status() === 400 && duplicate.CodeError === 'ROLE_DUPLICATE', `create with an existing name: HTTP ${duplicateResponse.status()} CodeError=${String(duplicate.CodeError)} (expected 400, ROLE_DUPLICATE)`);
      }
    }
    catch (error) {
      failures.push(`unexpected: ${this.firstLine(error)}`);
    }
    finally {
      for (const id of createdIds) {
        try {
          const [response] = await this.attemptDeleteRole(id);
          if (response.status() !== 200 && response.status() !== 404) {
            failures.push(`deactivate role #${id}: HTTP ${response.status()}`);
          }
        }
        catch (error) {
          failures.push(`deactivate role #${id}: ${this.firstLine(error)}`);
        }
      }
      await this.postLogout().catch(() => undefined);
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} role checks failed. ${failures.join('; ')}`);
    }
  }
}
