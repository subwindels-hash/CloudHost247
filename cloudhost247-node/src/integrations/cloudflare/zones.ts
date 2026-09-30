/**
 * Zone operations (spec §10–§11, §42). ensureZone is the idempotency core: search Cloudflare by
 * exact name first, reuse an existing zone, only create when genuinely absent — a retried
 * provisioning run can never create a duplicate zone.
 */
import type { CloudflareClient } from './client';
import type { CfZone } from './types';

export async function findZoneByName(client: CloudflareClient, name: string): Promise<CfZone | null> {
  const { result } = await client.request<CfZone[]>('zones.list', 'GET', '/zones', undefined, {
    name: name.toLowerCase(),
    per_page: 5,
  });
  const exact = (result ?? []).find((z) => z.name.toLowerCase() === name.toLowerCase());
  return exact ?? null;
}

export async function getZone(client: CloudflareClient, zoneId: string): Promise<CfZone> {
  const { result } = await client.request<CfZone>('zones.get', 'GET', `/zones/${encodeURIComponent(zoneId)}`);
  return result;
}

export async function createZone(
  client: CloudflareClient,
  accountId: string,
  name: string,
  type: 'full' | 'partial' = 'full'
): Promise<CfZone> {
  const { result } = await client.request<CfZone>('zones.create', 'POST', '/zones', {
    name: name.toLowerCase(),
    account: { id: accountId },
    type,
  });
  return result;
}

/** Search-then-create. Returns the zone plus whether it already existed. */
export async function ensureZone(
  client: CloudflareClient,
  accountId: string,
  name: string,
  type: 'full' | 'partial' = 'full'
): Promise<{ zone: CfZone; reused: boolean }> {
  const existing = await findZoneByName(client, name);
  if (existing) return { zone: existing, reused: true };
  const zone = await createZone(client, accountId, name, type);
  return { zone, reused: false };
}

export async function deleteZone(client: CloudflareClient, zoneId: string): Promise<void> {
  await client.request<{ id: string }>('zones.delete', 'DELETE', `/zones/${encodeURIComponent(zoneId)}`);
}

/** Pause (true) stops Cloudflare from proxying traffic — used by the suspension policy. */
export async function setZonePaused(client: CloudflareClient, zoneId: string, paused: boolean): Promise<CfZone> {
  const { result } = await client.request<CfZone>('zones.set_paused', 'PATCH', `/zones/${encodeURIComponent(zoneId)}`, {
    paused,
  });
  return result;
}
