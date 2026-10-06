/**
 * Tools connectors — Live DNS resolver & outbound HTTP monitor probes.
 *
 * Implements real DNS resolution via `node:dns/promises` and outbound HTTP(S)
 * health check probes with SSRF validation, latency measurement, and error handling.
 */
'use strict';

const dns = require('node:dns/promises');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { ValidationError } = require('../core/errors');

const SUPPORTED_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'PTR', 'SRV'];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata.azure.internal',
]);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true; // loopback
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    return false;
  }
  return false;
}

/**
 * Validates a target URL against SSRF rules.
 * Allows loopback in test mode (NODE_ENV=test) for test-suite verification.
 */
async function validateTargetUrl(rawUrl, options = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError('Invalid URL format. Include the protocol (e.g. https://example.com)');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Only HTTP and HTTPS URLs are permitted');
  }

  const hostname = url.hostname.toLowerCase();
  const allowLoopback = options.allowLoopback || process.env.NODE_ENV === 'test';

  if (!allowLoopback) {
    if (BLOCKED_HOSTNAMES.has(hostname) || !hostname.includes('.')) {
      throw new ValidationError(`Host "${hostname}" is blocked (private or internal host)`);
    }
    if (net.isIP(hostname)) {
      if (isPrivateIp(hostname)) {
        throw new ValidationError(`Address "${hostname}" is blocked (private IP)`);
      }
    } else {
      try {
        const addresses = await dns.lookup(hostname, { all: true });
        for (const addr of addresses) {
          if (isPrivateIp(addr.address)) {
            throw new ValidationError(`Host "${hostname}" resolved to private IP "${addr.address}"`);
          }
        }
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        throw new ValidationError(`Host "${hostname}" could not be resolved`);
      }
    }
  }

  return url;
}

/**
 * Live DNS lookup using node:dns/promises.
 */
async function resolveDns(target, recordType = 'A') {
  const name = String(target || '').trim().replace(/\.+$/, '');
  if (!name) throw new ValidationError('Domain or hostname is required');

  const type = String(recordType || 'A').toUpperCase();
  if (!SUPPORTED_RECORD_TYPES.includes(type)) {
    throw new ValidationError(`Unsupported record type "${type}". Supported: ${SUPPORTED_RECORD_TYPES.join(', ')}`);
  }

  const startedAt = Date.now();
  let records = [];
  let warnings = [];
  let status = 'NOERROR';

  try {
    switch (type) {
      case 'A': {
        const ips = await dns.resolve4(name);
        records = ips.map((ip) => ({ type: 'A', name, value: ip, ttl: 300 }));
        break;
      }
      case 'AAAA': {
        const ips = await dns.resolve6(name);
        records = ips.map((ip) => ({ type: 'AAAA', name, value: ip, ttl: 300 }));
        break;
      }
      case 'CNAME': {
        const cnames = await dns.resolveCname(name);
        records = cnames.map((c) => ({ type: 'CNAME', name, value: c, ttl: 300 }));
        break;
      }
      case 'MX': {
        const mxList = await dns.resolveMx(name);
        records = mxList
          .sort((a, b) => a.priority - b.priority)
          .map((m) => ({ type: 'MX', name, priority: m.priority, value: m.exchange, ttl: 300 }));
        break;
      }
      case 'NS': {
        const nsList = await dns.resolveNs(name);
        records = nsList.map((ns) => ({ type: 'NS', name, value: ns, ttl: 300 }));
        break;
      }
      case 'TXT': {
        const txtEntries = await dns.resolveTxt(name);
        records = txtEntries.map((parts) => ({ type: 'TXT', name, value: parts.join(''), ttl: 300 }));
        break;
      }
      case 'SOA': {
        const soa = await dns.resolveSoa(name);
        records = [{
          type: 'SOA',
          name,
          value: `${soa.nsname} ${soa.hostmaster} (serial ${soa.serial})`,
          detail: soa,
          ttl: 300,
        }];
        break;
      }
      case 'PTR': {
        const ptrs = await dns.resolvePtr(name);
        records = ptrs.map((ptr) => ({ type: 'PTR', name, value: ptr, ttl: 300 }));
        break;
      }
      case 'SRV': {
        const srvs = await dns.resolveSrv(name);
        records = srvs.map((s) => ({
          type: 'SRV',
          name,
          priority: s.priority,
          weight: s.weight,
          port: s.port,
          value: `${s.name}:${s.port}`,
          ttl: 300,
        }));
        break;
      }
    }
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'NODATA' || err.code === 'ENODATA') {
      status = err.code === 'ENOTFOUND' ? 'NXDOMAIN' : 'NODATA';
      warnings.push(`Resolver answered ${status} for ${type} records of ${name}.`);
    } else {
      warnings.push(`DNS query error: ${err.code || err.message}`);
    }
  }

  const durationMs = Date.now() - startedAt;

  return {
    query: { name, type },
    records,
    count: records.length,
    status,
    durationMs,
    warnings,
    summary: records.length ? records.map((r) => r.value).join(', ') : `No ${type} records found`,
  };
}

/**
 * Executes a live outbound HTTP/HTTPS health probe against the target URL.
 */
async function checkHttpMonitor(targetUrl, options = {}) {
  const url = await validateTargetUrl(targetUrl, options);
  const timeoutMs = options.timeoutMs || 10000;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'user-agent': options.userAgent || 'CloudHost247-Monitor/1.0 (+https://cloudhost247.com/monitoring)',
        accept: '*/*',
      },
      timeout: timeoutMs,
    };

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = transport.request(url, reqOptions, (res) => {
      const latencyMs = Date.now() - startedAt;
      const statusCode = res.statusCode || 0;
      const isUp = statusCode >= 200 && statusCode < 400;

      // Drain response body
      res.on('data', () => {});
      res.on('end', () => {
        finish({
          live: true,
          status: isUp ? 'up' : 'down',
          statusCode,
          statusText: res.statusMessage || '',
          latencyMs,
          headers: res.headers,
          lastCheckedAt: new Date().toISOString(),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      finish({
        live: true,
        status: 'down',
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        error: 'TIMEOUT',
        lastCheckedAt: new Date().toISOString(),
      });
    });

    req.on('error', (err) => {
      finish({
        live: true,
        status: 'down',
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        error: err.code || err.message,
        lastCheckedAt: new Date().toISOString(),
      });
    });

    req.end();
  });
}

module.exports = {
  SUPPORTED_RECORD_TYPES,
  BLOCKED_HOSTNAMES,
  isPrivateIp,
  validateTargetUrl,
  resolveDns,
  checkHttpMonitor,
};
