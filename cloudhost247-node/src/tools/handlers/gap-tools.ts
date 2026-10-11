/**
 * Tools Center — handlers for the DNS Checker inventory gaps:
 *   minecraft-color-codes, raid-calculator, ipv6-address-generator, ipv6-compatibility-checker.
 *
 * The three calculators are pure and run in-process. The compatibility checker uses the same
 * resolver layer as the DNS Lookup tool, so its answers carry the same resolver evidence.
 */
import { invalidInput } from '../core/errors';
import { dnsLookup } from '../dns/lookup';
import { convertMinecraftCodes, MINECRAFT_CODES, type MinecraftMode } from '../gaming/minecraft';
import { computeRaid, RAID_LEVELS, RaidInputError, type RaidLevel } from '../productivity/raid';
import { classifyIpv6, generateUla } from '../ip/ipv6-tools';
import type { ToolHandler } from './kit';
import { maybeStr, num, oneOf, str, targetLabel } from './kit';

const MINECRAFT_MODES: readonly MinecraftMode[] = ['ampersand-to-section', 'section-to-ampersand', 'strip'];

export const gapHandlers: Record<string, ToolHandler> = {
  'minecraft-color-codes': async (input) => {
    const mode = oneOf(input, 'mode', MINECRAFT_MODES, { default: 'ampersand-to-section' });
    const text = maybeStr(input, 'text', { max: 5000 });
    return {
      codes: MINECRAFT_CODES,
      conversion: text === undefined ? null : convertMinecraftCodes(text, mode),
    };
  },

  'raid-calculator': async (input) => {
    const level = oneOf(input, 'level', RAID_LEVELS, { required: true }) as RaidLevel;
    const drives = num(input, 'drives', { required: true, integer: true, min: 1, max: 1000 });
    const driveSizeTb = num(input, 'driveSizeTb', { required: true, min: 0.001, max: 100_000, integer: false });
    try {
      return computeRaid({ level, drives, driveSizeTb });
    } catch (error) {
      if (error instanceof RaidInputError) throw invalidInput(error.message);
      throw error;
    }
  },

  'ipv6-address-generator': async (input) => {
    const subnetId = maybeStr(input, 'subnetId', { max: 4 }) ?? '0000';
    try {
      return generateUla(subnetId);
    } catch (error) {
      throw invalidInput(error instanceof Error ? error.message : 'Invalid subnet ID.');
    }
  },

  'ipv6-compatibility-checker': async (input, context) => {
    const domain = str(input, 'domain', { required: true, max: 253 });
    const resolverId = maybeStr(input, 'resolverId');
    const timeoutMs = num(input, 'timeoutMs', { default: 6000, min: 500, max: 15_000, integer: true });
    const [aaaa, a] = await Promise.all([
      dnsLookup(context.db, { name: domain, type: 'AAAA', resolverId, timeoutMs }),
      dnsLookup(context.db, { name: domain, type: 'A', resolverId, timeoutMs }),
    ]);
    const classification = classifyIpv6(
      aaaa.records.map((record) => record.value),
      a.records.map((record) => record.value)
    );
    return {
      domain,
      ...classification,
      aaaaQuery: { rcode: aaaa.rcode, resolver: aaaa.resolver, durationMs: aaaa.durationMs, warnings: aaaa.warnings },
      aQuery: { rcode: a.rcode, resolver: a.resolver, durationMs: a.durationMs, warnings: a.warnings },
    };
  },
};

export const gapTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  'ipv6-compatibility-checker': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
};
