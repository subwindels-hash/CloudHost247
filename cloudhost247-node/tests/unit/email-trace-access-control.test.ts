/**
 * Tenant scope rules for the Email Trace Centre.
 *
 * These tests exist because every scope decision here is a security decision: `scopeForActor` and
 * `actorMayReadEvent` are the only places that decide whether a customer can see a message that is
 * not theirs, and an empty scope must fail closed rather than accidentally meaning "everything".
 */
import { describe, expect, it } from 'vitest';
import {
  actorMayReadEvent,
  isEmailTraceAdmin,
  scopeForAdminConsole,
  scopeForOwnMail,
  type EmailTraceActor,
} from '../../src/email-trace/access-control';

const CUSTOMER = '11111111-1111-1111-1111-111111111111';
const OTHER_CUSTOMER = '22222222-2222-2222-2222-222222222222';
const HOSTING_ACCOUNT = '33333333-3333-3333-3333-333333333333';

const customer: EmailTraceActor = { userId: CUSTOMER, role: 'customer', supportSessionId: null, actingAdminId: null };
const staff: EmailTraceActor = { userId: CUSTOMER, role: 'staff', supportSessionId: null, actingAdminId: null };
const admin: EmailTraceActor = { userId: 'admin-1', role: 'admin', supportSessionId: null, actingAdminId: null };
const superAdmin: EmailTraceActor = { userId: 'admin-2', role: 'super_admin', supportSessionId: null, actingAdminId: null };
const supportAdmin: EmailTraceActor = {
  userId: CUSTOMER,
  role: 'admin',
  supportSessionId: 'session-1',
  actingAdminId: 'admin-1',
};

describe('scopeForOwnMail', () => {
  it('scopes a customer to their own id', () => {
    expect(scopeForOwnMail(customer)).toEqual({ customerIds: [CUSTOMER] });
  });

  it('scopes staff to their own id rather than granting tenant-wide mail access', () => {
    // Staff are not mail administrators; the role grants nothing on the customer surface.
    expect(scopeForOwnMail(staff)).toEqual({ customerIds: [CUSTOMER] });
  });

  it('never returns an unrestricted scope, even for an administrator', () => {
    // An admin opening the *customer* page must not see the platform's mail history.
    expect(scopeForOwnMail(admin)).toEqual({ customerIds: [admin.userId] });
    expect(scopeForOwnMail(superAdmin)).toEqual({ customerIds: [superAdmin.userId] });
  });

  it('treats a support session as the customer’s own scope, never the admin’s', () => {
    // In a delegated session `userId` is already the customer being supported.
    expect(scopeForOwnMail(supportAdmin)).toEqual({ customerIds: [CUSTOMER] });
  });

  it('never returns an empty scope, which would fail closed but also hide everything', () => {
    for (const actor of [customer, staff, admin, superAdmin, supportAdmin]) {
      const scope = scopeForOwnMail(actor);
      expect(scope.customerIds).toHaveLength(1);
    }
  });
});

describe('scopeForAdminConsole', () => {
  it('is unrestricted, and only exists as its own explicit call', () => {
    expect(scopeForAdminConsole()).toEqual({});
  });
});

describe('isEmailTraceAdmin', () => {
  it('recognises only admin roles', () => {
    expect(isEmailTraceAdmin(admin)).toBe(true);
    expect(isEmailTraceAdmin(superAdmin)).toBe(true);
    expect(isEmailTraceAdmin(customer)).toBe(false);
    expect(isEmailTraceAdmin(staff)).toBe(false);
  });
});

describe('actorMayReadEvent', () => {
  it('lets a customer read their own attributed mail', () => {
    expect(actorMayReadEvent(customer, { customer_id: CUSTOMER, hosting_account_id: null }, [])).toBe(true);
  });

  it('refuses another customer’s mail even when the hosting account matches', () => {
    expect(
      actorMayReadEvent(customer, { customer_id: OTHER_CUSTOMER, hosting_account_id: HOSTING_ACCOUNT }, [HOSTING_ACCOUNT])
    ).toBe(false);
  });

  it('allows a service-attributed event only for a service the customer owns', () => {
    expect(actorMayReadEvent(customer, { customer_id: null, hosting_account_id: HOSTING_ACCOUNT }, [HOSTING_ACCOUNT])).toBe(
      true
    );
    expect(actorMayReadEvent(customer, { customer_id: null, hosting_account_id: HOSTING_ACCOUNT }, [])).toBe(false);
  });

  it('never shows an unattributed event to a customer', () => {
    // Mail the platform could not attribute is not "everyone's mail".
    expect(actorMayReadEvent(customer, { customer_id: null, hosting_account_id: null }, [])).toBe(false);
  });

  it('lets an administrator read any attributed or unattributed event', () => {
    expect(actorMayReadEvent(admin, { customer_id: OTHER_CUSTOMER, hosting_account_id: null }, [])).toBe(true);
    expect(actorMayReadEvent(admin, { customer_id: null, hosting_account_id: null }, [])).toBe(true);
  });
});
