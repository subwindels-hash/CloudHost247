'use strict';

/**
 * Audit-log screen contract (AdminAuditLogPage).
 *
 * Walks the exact HTTP sequence the screen issues — the full admin view with actor/resource/action
 * filters, limit/offset pagination and the actor join plus recorded metadata — over the real app,
 * generating real audit rows through the security-number console actions the previous screen
 * performs. Also pins the two audit views' role split (admin full view vs the narrower staff
 * console view). Pins the page source to the response keys it renders.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminAuditLogPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

async function tokenFor(base, app, email, role) {
  await register(base, email, 'SuperSecret123!');
  if (role) {
    const user = await app.store.table('users').findOne({ email });
    await app.store.table('users').updateById(user.id, { role });
  }
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('audit-log screen: endpoint contracts', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  try {
    const superAdmin = await tokenFor(base, app, 'audit-screen-super@example.com', 'super_admin');
    const staff = await tokenFor(base, app, 'audit-screen-staff@example.com', 'staff');
    const customer = await tokenFor(base, app, 'audit-screen-cust@example.com');

    // -- generate real audit rows through the security-number console actions --
    await jsonFetch(base, {
      method: 'PUT', path: '/api/v1/admin/security-number/policy', body: { rotationHours: 700 },
    }, superAdmin);
    const target = await app.store.table('users').findOne({ email: 'audit-screen-cust@example.com' });
    await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/users/${target.id}/security-number/rotate`, body: {},
    }, superAdmin);

    // -- full admin view (the route the screen reads) --
    const first = await jsonFetch(base, { method: 'GET', path: '/api/v1/audit-logs' }, superAdmin);
    assert.strictEqual(first.status, 200);
    assert.ok(Array.isArray(first.data.logs) && first.data.logs.length >= 2, 'log rows are returned');
    for (const key of ['id', 'actorId', 'actorEmail', 'actorName', 'action', 'resourceType', 'resourceId', 'ipAddress', 'userAgent', 'metadata', 'createdAt']) {
      assert.ok(key in first.data.logs[0], `log row reads ${key}`);
    }
    for (const key of ['total', 'limit', 'offset']) {
      assert.ok(key in first.data, `page envelope reads ${key}`);
    }

    // -- action filter is a case-insensitive substring --
    const byAction = await jsonFetch(base, { method: 'GET', path: '/api/v1/audit-logs?action=SECURITY_NUMBER' }, superAdmin);
    assert.strictEqual(byAction.status, 200);
    assert.ok(byAction.data.logs.length >= 2, 'both security-number actions matched');
    assert.ok(byAction.data.logs.every((r) => String(r.action).toUpperCase().includes('SECURITY_NUMBER')),
      'action filter applied');

    // -- actor + resource filters (upstream parameter names map onto entity columns) --
    const superUser = await app.store.table('users').findOne({ email: 'audit-screen-super@example.com' });
    const byActor = await jsonFetch(base, { method: 'GET', path: `/api/v1/audit-logs?actorId=${superUser.id}` }, superAdmin);
    assert.strictEqual(byActor.status, 200);
    assert.ok(byActor.data.logs.length >= 2, 'the actor filter finds their actions');
    assert.ok(byActor.data.logs.every((r) => r.actorId === superUser.id), 'actor filter applied');
    const rotateRow = first.data.logs.find((r) => r.action === 'security_number_force_rotated');
    assert.ok(rotateRow, 'the force-rotate action is recorded');
    const byResource = await jsonFetch(base, {
      method: 'GET', path: `/api/v1/audit-logs?resourceType=user&resourceId=${target.id}`,
    }, superAdmin);
    assert.strictEqual(byResource.status, 200);
    assert.ok(byResource.data.logs.some((r) => r.action === 'security_number_force_rotated'),
      'resourceType/resourceId filters find the row');
    assert.ok(byResource.data.logs.every((r) => r.resourceType === 'user' && r.resourceId === target.id),
      'resource filters applied');

    // -- pagination --
    const page1 = await jsonFetch(base, { method: 'GET', path: '/api/v1/audit-logs?limit=1&offset=0' }, superAdmin);
    const page2 = await jsonFetch(base, { method: 'GET', path: '/api/v1/audit-logs?limit=1&offset=1' }, superAdmin);
    assert.strictEqual(page1.data.logs.length, 1);
    assert.strictEqual(page2.data.logs.length, 1);
    assert.notStrictEqual(page1.data.logs[0].id, page2.data.logs[0].id, 'offset pages differ');
    assert.strictEqual(page1.data.total, page2.data.total, 'total is the untruncated match count');

    // -- staff console view is narrower but exists for the staff role --
    const staffView = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/audit-logs' }, staff);
    assert.strictEqual(staffView.status, 200);
    assert.ok(Array.isArray(staffView.data.auditLogs), 'staff view reads auditLogs');
    for (const key of ['id', 'actorId', 'actorRole', 'action', 'entityType', 'entityId', 'ipAddress', 'createdAt']) {
      assert.ok(key in staffView.data.auditLogs[0], `staff log row reads ${key}`);
    }

    // -- role split: the full view is admin+, both views refuse customers --
    const staffFull = await jsonFetch(base, { method: 'GET', path: '/api/v1/audit-logs' }, staff);
    assert.strictEqual(staffFull.status, 403, 'the full view is admin+ only');
    for (const route of ['/api/v1/audit-logs', '/api/v1/admin/audit-logs']) {
      const denied = await jsonFetch(base, { method: 'GET', path: route }, customer);
      assert.strictEqual(denied.status, 403, `customer cannot read ${route}`);
    }

    // -- page pins --
    for (const key of ['resourceType', 'resourceId', 'actorEmail', 'metadata', 'createdAt', 'JSON.stringify']) {
      assert.ok(PAGE_SRC.includes(key), `AdminAuditLogPage renders '${key}'`);
    }
    assert.ok(PAGE_SRC.includes('append-only'), 'the page states the log is read-only here');
    for (const pathPart of ['/api/v1/audit-logs', '/api/v1/admin/audit-logs']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
