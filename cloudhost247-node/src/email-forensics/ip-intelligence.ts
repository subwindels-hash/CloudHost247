/**
 * Local IP intelligence adapter for the forensics analyzer.
 *
 * Provides approximate network information from a locally stored IP intelligence database,
 * without any third-party lookup API. The default implementation uses `geoip-lite` (MaxMind
 * GeoLite2-compatible, licensed for local use), but the adapter interface is provider-independent
 * so an administrator can swap in another licensed dataset without rewriting the analyzer.
 *
 * Geolocation is approximate. This adapter never returns a street address or claims to identify
 * a person. Missing/outdated data yields "Location or network information unavailable."
 */

import type geoipType from 'geoip-lite';
import type { Lookup as GeoLookup } from 'geoip-lite';

let cachedGeoIp: typeof geoipType | null = null;
function getGeoIp(): typeof geoipType {
  if (!cachedGeoIp) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedGeoIp = require('geoip-lite') as typeof geoipType;
  }
  return cachedGeoIp;
}

import type { AddressClass, IpIntelligenceLookup } from './types';
import { classifyAddress, type AddressClass as AC } from './ip-classification';

/** The adapter contract. Any replacement implementation must satisfy this shape. */
export interface IpIntelligenceAdapter {
  readonly provider: string;
  readonly databaseName: string;
  /** Look up one IP. Returns null when the address is not in the local database. */
  lookup(ip: string): IpIntelligenceLookup | null;
  /** Current database version/metadata, for display to the user and admin. */
  databaseVersion(): Promise<{ version: string | null; lastUpdatedAt: string | null; status: string }>;
}

/** Default adapter backed by the geoip-lite in-memory database. */
export class GeoIpLiteAdapter implements IpIntelligenceAdapter {
  readonly provider = 'MaxMind GeoLite2 (local, geoip-lite)';
  readonly databaseName = 'GeoLite2-City / GeoLite2-ASN (local copy)';

  lookup(ip: string): IpIntelligenceLookup | null {
    if (typeof ip !== 'string' || ip.trim() === '') return null;

    // Private / reserved / loopback / multicast addresses are not in the public database and do
    // not need a lookup — classify locally and report as computed, not approximate.
    const addressClass = classifyAddress(ip);
    if (addressClass === 'loopback' || addressClass === 'private') {
      return {
        ip,
        ipVersion: this.ipVersion(ip),
        country: null,
        region: null,
        city: null,
        latitude: null,
        longitude: null,
        isp: null,
        asn: null,
        organisation: null,
        hosting: null,
        addressClass,
        source: 'computed',
      };
    }
    if (addressClass === 'unavailable') return null;

    let entry: GeoLookup | null;
    try {
      entry = getGeoIp().lookup(ip);
    } catch {
      return null;
    }
    if (!entry) return null;

    // geoip-lite's type declarations do not expose org/asn, but the runtime object does.
    const e = entry as unknown as Record<string, unknown>;

    return {
      ip,
      ipVersion: this.ipVersion(ip),
      country: entry.country ?? null,
      region: entry.region ?? null,
      city: entry.city ?? null,
      latitude: entry.ll?.[0] ?? null,
      longitude: entry.ll?.[1] ?? null,
      isp: (e.org ?? null) as string | null,
      asn: (e.asn ?? null) as string | null,
      organisation: (e.org ?? null) as string | null,
      hosting: this.looksLikeHosting((e.org as string | undefined), entry.country),
      addressClass: addressClass === 'public' ? 'public' : addressClass,
      source: 'local_database',
    };
  }

  async databaseVersion(): Promise<{
    version: string | null;
    lastUpdatedAt: string | null;
    status: string;
  }> {
    // geoip-lite does not expose a database build timestamp through a stable public API. The
    // authoritative version/status is instead managed by the admin update process and stored in
    // email_forensic_database_versions. This adapter reports "not_configured" until an admin has
    // run the update and a row exists; callers (service layer) overlay the stored row.
    return { version: null, lastUpdatedAt: null, status: 'not_configured' };
  }

  private ipVersion(ip: string): 'ipv4' | 'ipv6' {
    const colon = ip.indexOf(':');
    return colon !== -1 ? 'ipv6' : 'ipv4';
  }

  /**
   * Heuristic hosting/cloud/datacentre classification from the organisation string. This is an
   * approximation only and is labelled as such; it never identifies a person.
   */
  private looksLikeHosting(org: string | undefined, country: string | undefined): boolean | null {
    if (!org) return null;
    const lower = org.toLowerCase();
    const hostingHints = [
      'amazon', 'aws', 'google', 'microsoft', 'azure', 'digitalocean', 'linode', 'vultr',
      'hetzner', 'ovh', 'rackspace', 'datacenter', 'data center', 'hosting', 'cloud',
      'serverius', 'choopa', 'frantech', 'webnx', 'psychz', 'qwords', 'colocrossing',
    ];
    return hostingHints.some((hint) => lower.includes(hint));
  }
}

/** Singleton default adapter instance. */
export const defaultAdapter = new GeoIpLiteAdapter();
