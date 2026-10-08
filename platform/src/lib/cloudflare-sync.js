/**
 * Cloudflare service cache reconciliation — one implementation, two callers.
 *
 * Both the customer route (`POST /api/v1/cloudflare/services/:id/sync`) and the admin lifecycle route
 * (`POST /api/v1/admin/cloudflare/services/:id/sync`) need to bring the local `cloudflare_*` tables in
 * line with the account. Writing that reconciliation twice would let the two drift exactly the way
 * the capability flags in this repository drifted before `tests/unit/adapter-capability-matrix` pinned
 * them, so it lives here and both domains call it.
 *
 * Four rules this module enforces, each one a defect the previous "synchronized cache" design had:
 *
 *  1. **Cloudflare is authoritative, and its own record id is the key.** Records are matched on
 *     `cloudflare_record_id`. The old code wrote a *fabricated* `cf-rec-<uuid>` into that column, so
 *     nothing could ever match a real record; here an id only ever comes from Cloudflare.
 *  2. **Absence is data.** A record that existed locally and no longer exists upstream is deleted
 *     locally, because the alternative is a phantom record the customer can see and cannot delete.
 *  3. **System-managed records stay system-managed.** Ownership is read from Cloudflare's own answer,
 *     never inferred from the fact that a row happens to exist locally.
 *  4. **A truncated read is reported, not hidden.** The provider read is paginated with a bound; if
 *     the bound is hit the caller is told, so a partial mirror is never presented as the whole zone.
 *
 * Settings are merged rather than replaced: keys this platform owns are stored under a `__` prefix
 * (Cloudflare's setting ids never begin with an underscore), so a sync cannot delete platform state
 * that never existed upstream.
 */
'use strict';

const { uuidv7 } = require('./ids');

/** The platform's own settings-document keys, which a provider sync must never overwrite. */
const PLATFORM_SETTING_PREFIX = '__';

/**
 * Bring one service's local cache in line with Cloudflare.
 *
 * @param {object} args
 * @param {object} args.store    the platform store
 * @param {object} args.client   a `createCloudflareClient` instance bound to the owning account
 * @param {object} args.service  the `cloudflare_services` row (must carry `zone_id`)
 * @returns {Promise<object>}    a summary that states exactly what changed
 */
async function syncServiceCache({ store, client, service }) {
  const zone = await client.getZone(service.zone_id);
  const records = await client.listDnsRecords(service.zone_id);
  const settings = await client.listZoneSettings(service.zone_id);

  const existing = (await store.table('cloudflare_dns_records').all()).filter((r) => r.service_id === service.id);
  const byProviderId = new Map(existing.filter((r) => r.cloudflare_record_id).map((r) => [r.cloudflare_record_id, r]));

  let created = 0;
  let updated = 0;
  const seen = new Set();
  for (const record of records.items) {
    // A record with no id is not a record: skipping it is the only honest option, because inserting
    // it would mean inventing the one field that identifies it upstream.
    if (!record.id) continue;
    seen.add(record.id);
    const fields = {
      service_id: service.id,
      cloudflare_record_id: record.id,
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl ?? 1,
      proxied: record.proxied === true,
      priority: record.priority ?? null,
      comment: record.comment ?? null,
      ownership: record.ownership,
    };
    const local = byProviderId.get(record.id);
    if (local) {
      await store.table('cloudflare_dns_records').updateById(local.id, fields);
      updated += 1;
    } else {
      await store.table('cloudflare_dns_records').insert({ id: uuidv7(), ...fields });
      created += 1;
    }
  }

  let removed = 0;
  for (const local of existing) {
    if (local.cloudflare_record_id && !seen.has(local.cloudflare_record_id)) {
      await store.table('cloudflare_dns_records').deleteById(local.id);
      removed += 1;
    }
    // A local row with NO provider id is a leftover from the era when ids were fabricated. It cannot
    // be reconciled against anything, so it is kept and reported rather than silently deleted.
  }
  const unreconcilable = existing.filter((r) => !r.cloudflare_record_id).length;

  const settingsRow = await store.table('cloudflare_zone_settings').findOne({ service_id: service.id });
  const currentSettings = settingsRow?.settings ?? {};
  const merged = { ...currentSettings };
  let settingsApplied = 0;
  for (const [settingId, setting] of Object.entries(settings)) {
    if (settingId.startsWith(PLATFORM_SETTING_PREFIX)) continue;
    if (merged[settingId] !== setting.value) settingsApplied += 1;
    merged[settingId] = setting.value;
  }
  if (settingsRow) await store.table('cloudflare_zone_settings').updateById(settingsRow.id, { settings: merged });
  else await store.table('cloudflare_zone_settings').insert({ id: uuidv7(), service_id: service.id, settings: merged });

  // Two service columns mirror provider settings because other routes read them directly. Keeping
  // the mirror here means a sync and a settings write cannot disagree about them.
  const patch = {
    activation_status: zone.activationStatus,
    last_synced_at: new Date().toISOString(),
  };
  if (zone.nameServers[0]) patch.name_server_1 = zone.nameServers[0];
  if (zone.nameServers[1]) patch.name_server_2 = zone.nameServers[1];
  if (typeof merged.ssl === 'string') patch.ssl_mode = merged.ssl;
  patch.development_mode_until = merged.development_mode === 'on'
    ? new Date(Date.now() + 3 * 3600000).toISOString()
    : null;
  // A service that was marked `sync_failed` is healthy again the moment a sync really succeeds.
  if (service.status === 'sync_failed') patch.status = 'active';
  await store.table('cloudflare_services').updateById(service.id, patch);

  return {
    zone: {
      id: zone.id,
      status: zone.status,
      activationStatus: zone.activationStatus,
      paused: zone.paused,
      type: zone.type,
      nameservers: zone.nameServers,
    },
    records: {
      total: records.items.length,
      created,
      updated,
      removed,
      unreconcilable,
      truncated: records.truncated,
    },
    settings: { applied: settingsApplied, mirrored: Object.keys(settings).length },
  };
}

module.exports = { syncServiceCache, PLATFORM_SETTING_PREFIX };
