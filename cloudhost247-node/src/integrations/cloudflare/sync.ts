/**
 * Zone/DNS synchronization (spec §40, §44, §56).
 *
 * Cloudflare is the provider-side source of truth; the local cache is a synchronized
 * representation. Sync updates zone status/nameservers/plan and reconciles the DNS cache by
 * Cloudflare record id — ownership labels (SYSTEM_MANAGED / CUSTOMER_MANAGED) on surviving rows
 * are preserved, and records that disappeared upstream are removed locally.
 */
import type { Queryable } from '../../db/types';
import type { CloudflareClient } from './client';
import { getZone } from './zones';
import { listDnsRecords } from './dns';
import { tierFromZonePlan } from './types';
import {
  deleteCachedDnsRecordsNotIn,
  findCachedDnsRecord,
  updateCloudflareService,
  upsertCachedDnsRecord,
  type CloudflareServiceRow,
} from '../../db/cloudflare';

export interface SyncReport {
  zoneStatus: string;
  activationStatus: string;
  recordsUpserted: number;
  recordsRemoved: number;
  planTier: string;
}

export function activationStatusFromZone(zoneStatus: string, paused: boolean): string {
  if (paused) return 'pending';
  if (zoneStatus === 'active') return 'active';
  if (zoneStatus === 'pending' || zoneStatus === 'initializing') return 'pending_nameserver_update';
  return 'error';
}

export async function syncZoneState(db: Queryable, client: CloudflareClient, service: CloudflareServiceRow): Promise<SyncReport> {
  if (!service.zone_id) throw new Error('Service has no zone to sync');
  const zone = await getZone(client, service.zone_id);
  const activation = activationStatusFromZone(zone.status, zone.paused);
  const tier = tierFromZonePlan(zone);

  const upstreamRecords = await listDnsRecords(client, service.zone_id);
  let upserted = 0;
  for (const record of upstreamRecords) {
    const existing = await findCachedDnsRecord(db, service.id, record.id);
    await upsertCachedDnsRecord(db, {
      serviceId: service.id,
      cloudflareRecordId: record.id,
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      proxied: record.proxied ?? false,
      priority: record.priority ?? null,
      comment: record.comment ?? null,
      // Preserve local ownership labels; unseen upstream records default to customer-managed —
      // automation must never claim (and later overwrite) a record it did not create.
      ownership: existing?.ownership ?? 'CUSTOMER_MANAGED',
    });
    upserted += 1;
  }
  const removed = await deleteCachedDnsRecordsNotIn(db, service.id, upstreamRecords.map((r) => r.id));

  await updateCloudflareService(db, service.id, {
    activationStatus: activation,
    cloudflarePlan: tier,
    nameServer1: zone.name_servers?.[0] ?? service.name_server_1,
    nameServer2: zone.name_servers?.[1] ?? service.name_server_2,
    lastSyncedAt: new Date(),
    lastErrorCode: null,
    lastErrorMessage: null,
  });

  return {
    zoneStatus: zone.status,
    activationStatus: activation,
    recordsUpserted: upserted,
    recordsRemoved: removed,
    planTier: tier,
  };
}
