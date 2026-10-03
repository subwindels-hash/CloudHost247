/**
 * Tools Center — IP and Network category handlers (spec §15–§29).
 *
 * These tools are the ones where honesty about the environment matters most: `ping` reports whether
 * it really used ICMP or fell back to a TCP handshake, `traceroute` refuses to invent hops when the
 * binary is unavailable, and `my-ip` only echoes what the edge observed. None of that is smoothed
 * over here — the handlers pass the service result through unchanged.
 */
import { ipLookup, ispLookup, lookupAsn, myIp, domainToIpTool } from '../ip/ip-service';
import { ipWhois, asnWhois } from '../ip/whois';
import { reverseDnsLookup } from '../dns/lookup';
import {
  cidrToRange,
  compressIpv6,
  decimalToIpv4,
  decimalToIpv6,
  expandIpv6,
  ipv4ToDecimal,
  ipv4ToIpv6Forms,
  ipv6ToDecimal,
  ipv6ToIpv4,
  rangeToCidr,
  splitSubnet,
  subnetInfo,
} from '../ip/ip-utils';
import { ping, traceroute } from '../network/reachability';
import { portCheck } from '../network/ports';
import { generateMac, macLookup } from '../network/mac';
import { speedTestConfig } from '../network/speed-test';
import { invalidInput } from '../core/errors';
import type { ToolHandler } from './kit';
import { bool, maybeNum, maybeStr, num, oneOf, str, strArray, targetLabel } from './kit';

const CONVERTER_MODES = [
  'ipv4-to-decimal',
  'decimal-to-ipv4',
  'ipv6-to-decimal',
  'decimal-to-ipv6',
  'ipv4-to-ipv6',
  'ipv6-to-ipv4',
  'expand-ipv6',
  'compress-ipv6',
  'cidr-to-range',
  'range-to-cidr',
] as const;

export const ipNetworkHandlers: Record<string, ToolHandler> = {
  'ip-lookup': async (input, context) =>
    ipLookup(context.db, {
      address: str(input, 'address', { max: 60 }) || str(input, 'ip', { required: true, max: 60 }),
      includeReverse: maybeBoolInput(input, 'includeReverse'),
      resolverId: maybeStr(input, 'resolverId'),
    }),

  'my-ip': async (_input, context) => {
    const socket = context.request.raw.socket as unknown as {
      encrypted?: boolean;
      getPeerCertificate?: (detailed?: boolean) => Record<string, unknown>;
      getProtocol?: () => string | null;
      getCipher?: () => { name?: string } | null;
    } | null;
    return myIp({
      ip: context.request.ip,
      headers: context.request.headers as Record<string, string | string[] | undefined>,
      protocol: context.request.protocol,
      socket: socket ?? null,
    });
  },

  'ip-whois': async (input, context) =>
    ipWhois(context.db, str(input, 'address', { max: 60 }) || str(input, 'ip', { required: true, max: 60 })),

  'domain-to-ip': async (input, context) =>
    domainToIpTool(context.db, {
      domain: str(input, 'domain', { required: true, max: 253 }),
      resolverId: maybeStr(input, 'resolverId'),
      userId: context.caller.userId,
    }),

  'ip-to-hostname': async (input, context) =>
    reverseDnsLookup(context.db, {
      address: str(input, 'address', { max: 60 }) || str(input, 'ip', { required: true, max: 60 }),
      resolverId: maybeStr(input, 'resolverId'),
    }),

  'isp-lookup': async (input, context) =>
    ispLookup(context.db, { address: str(input, 'address', { max: 60 }) || str(input, 'ip', { required: true, max: 60 }) }),

  'ip-converters': async (input) => {
    const mode = oneOf(input, 'mode', CONVERTER_MODES, { required: true });
    const value = str(input, 'value', { required: true, max: 200 });
    switch (mode) {
      case 'ipv4-to-decimal':
        return { mode, input: value, ...ipv4ToDecimal(value) };
      case 'decimal-to-ipv4':
        return { mode, input: value, ...decimalToIpv4(value) };
      case 'ipv6-to-decimal':
        return { mode, input: value, ...ipv6ToDecimal(value) };
      case 'decimal-to-ipv6':
        return { mode, input: value, ...decimalToIpv6(value) };
      case 'ipv4-to-ipv6':
        return { mode, input: value, ...ipv4ToIpv6Forms(value) };
      case 'ipv6-to-ipv4':
        return { mode, input: value, ...ipv6ToIpv4(value) };
      case 'expand-ipv6':
        return { mode, input: value, ...expandIpv6(value) };
      case 'compress-ipv6':
        return { mode, input: value, ...compressIpv6(value) };
      case 'cidr-to-range':
        return { mode, input: value, ...cidrToRange(value) };
      case 'range-to-cidr': {
        const [start, end] = value.split(/[\s,]+/).filter(Boolean);
        if (!start || !end) throw invalidInput('Provide the start and end address, separated by a space or comma.');
        return { mode, input: value, ...rangeToCidr(start, end) };
      }
      default:
        throw invalidInput('Unsupported converter mode.');
    }
  },

  'subnet-calculator': async (input) => {
    let cidr = str(input, 'cidr', { max: 60 });
    if (cidr.length === 0) {
      const address = str(input, 'address', { required: true, max: 60 });
      const prefix = maybeNum(input, 'prefix', { min: 0, max: 128 });
      cidr = prefix === undefined ? address : `${address}/${prefix}`;
    }
    const info = subnetInfo(cidr);
    if (input.newPrefix === undefined && input.newPrefixLength === undefined) return info;
    const target = num(input, input.newPrefix !== undefined ? 'newPrefix' : 'newPrefixLength', { min: info.prefixLength, max: info.version === 4 ? 32 : 128 });
    return { ...info, split: splitSubnet(cidr, target) };
  },

  ping: async (input) =>
    ping({
      target: str(input, 'target', { max: 253 }) || str(input, 'host', { required: true, max: 253 }),
      count: maybeNum(input, 'count', { min: 1, max: 10 }),
      tcpPort: maybeNum(input, 'tcpPort', { min: 1, max: 65535 }),
      forceTcp: maybeBoolInput(input, 'forceTcp'),
    }),

  traceroute: async (input) =>
    traceroute({
      target: str(input, 'target', { max: 253 }) || str(input, 'host', { required: true, max: 253 }),
      maxHops: maybeNum(input, 'maxHops', { min: 1, max: 30 }),
    }),

  'port-checker': async (input) => {
    const ports = strArray(input, 'ports', { max: 20 });
    const port = maybeNum(input, 'port', { min: 1, max: 65535 });
    const from = maybeNum(input, 'from', { min: 1, max: 65535 });
    const to = maybeNum(input, 'to', { min: 1, max: 65535 });
    const parts = strArray(input, 'portList', { max: 20 });
    return portCheck({
      host: str(input, 'host', { max: 253 }) || str(input, 'address', { required: true, max: 253 }),
      ...(port !== undefined ? { port } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(ports ? { ports: ports.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry)) } : {}),
      ...(parts ? { ports: parts.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry)) } : {}),
    });
  },

  'mac-lookup': async (input, context) => macLookup(context.db, { mac: str(input, 'mac', { required: true, max: 40 }) }),

  'mac-generator': async (input) =>
    generateMac({
      count: maybeNum(input, 'count', { min: 1, max: 20 }),
      mode: input.mode === undefined || input.mode === '' ? undefined : oneOf(input, 'mode', ['random', 'locally-administered', 'universally-administered'] as const, { default: 'random' }),
    }),

  'asn-whois': async (input, context) => {
    const asn = str(input, 'asn', { max: 30 });
    if (asn.length > 0) return asnWhois(context.db, asn);
    const address = str(input, 'address', { max: 60 }) || str(input, 'ip', { required: true, max: 60 });
    const origin = await lookupAsn(context.db, address);
    if (!origin.record) {
      throw invalidInput(`No ASN origin could be determined for ${address}. The Team Cymru lookup returned no origin AS.`);
    }
    const detail = await asnWhois(context.db, `AS${origin.record.asn}`);
    return { origin: origin.record, ...detail };
  },

  'speed-test': async (input, context) =>
    speedTestConfig(context.db, { measureServerEgress: bool(input, 'measureServerEgress', false) }),
};

function maybeBoolInput(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

export const ipNetworkTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  'ip-lookup': (input) => targetLabel(typeof input.address === 'string' ? input.address : typeof input.ip === 'string' ? input.ip : null),
  'my-ip': () => null,
  'ip-whois': (input) => targetLabel(typeof input.address === 'string' ? input.address : typeof input.ip === 'string' ? input.ip : null),
  'domain-to-ip': (input) => targetLabel(typeof input.domain === 'string' ? input.domain : null),
  'ip-to-hostname': (input) => targetLabel(typeof input.address === 'string' ? input.address : null),
  'isp-lookup': (input) => targetLabel(typeof input.address === 'string' ? input.address : null),
  'ip-converters': (input) => targetLabel(typeof input.value === 'string' ? input.value : null),
  'subnet-calculator': (input) => targetLabel(typeof input.cidr === 'string' ? input.cidr : typeof input.address === 'string' ? input.address : null),
  ping: (input) => targetLabel(typeof input.target === 'string' ? input.target : typeof input.host === 'string' ? input.host : null),
  traceroute: (input) => targetLabel(typeof input.target === 'string' ? input.target : typeof input.host === 'string' ? input.host : null),
  'port-checker': (input) => targetLabel(typeof input.host === 'string' ? input.host : null),
  'mac-lookup': (input) => targetLabel(typeof input.mac === 'string' ? input.mac : null),
  'mac-generator': () => null,
  'asn-whois': (input) => targetLabel(typeof input.asn === 'string' ? input.asn : typeof input.address === 'string' ? input.address : null),
  'speed-test': () => null,
};
