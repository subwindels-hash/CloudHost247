import { describe, expect, it } from 'vitest';
import {
  listControlPanelAdapters,
  getControlPanelAdapter,
  requireControlPanelAdapter,
  buildServerCloudInitWithControlPanel,
} from '../../src/control-panels/registry';
import { ControlPanelOperationError } from '../../src/control-panels/errors';
import type { ControlPanelAdapter, ControlPanelInstallOptions } from '../../src/control-panels/types';

describe('Control Panel Adapters & Registry (Phase 4)', () => {
  const ALL_18_SLUGS = [
    'dokploy',
    'coolify',
    'cloudpanel',
    'cpanel',
    'plesk',
    'directadmin',
    'cyberpanel',
    'hestiacp',
    'fastpanel',
    'aapanel',
    'easypanel',
    'cosmos',
    'cloudron',
    'webuzo',
    'webmin',
    'tinycp',
    'kusanagi',
    'adminbolt',
  ];

  it('registers all 18 control panel adapters', () => {
    const adapters = listControlPanelAdapters();
    expect(adapters.length).toBe(18);

    for (const slug of ALL_18_SLUGS) {
      const adapter = getControlPanelAdapter(slug);
      expect(adapter, `Adapter for slug '${slug}' should exist`).not.toBeNull();
      expect(adapter?.slug).toBe(slug);
      expect(adapter?.name).toBeDefined();
    }
  });

  it('throws descriptive error on unknown slug for requireControlPanelAdapter', () => {
    expect(() => requireControlPanelAdapter('unknown-slug')).toThrow(/Unsupported control panel platform/);
  });

  it('generates valid shell install scripts for all adapters', () => {
    for (const slug of ALL_18_SLUGS) {
      const adapter = requireControlPanelAdapter(slug);
      const script = adapter.generateInstallScript({
        hostname: 'srv1.example.com',
        serverIp: '198.51.100.10',
        adminEmail: 'admin@example.com',
        adminPassword: 'SecretPassword123!',
        licenseKey: 'LIC-TEST-12345',
        osSlug: 'ubuntu',
        osVersion: '24.04',
        architecture: 'x86_64',
      });

      expect(script).toContain('#!/bin/bash');
      expect(script).toContain('set -euo pipefail');
      expect(script).toContain(slug);
    }
  });

  it('generates access info and URLs with proper port formatting', () => {
    const cpanel = requireControlPanelAdapter('cpanel');
    const access = cpanel.getAccessInfo('203.0.113.50');
    expect(access.url).toBe('https://203.0.113.50:2087');
    expect(access.firewallPorts.some((p) => p.port === 2087)).toBe(true);

    const dokploy = requireControlPanelAdapter('dokploy');
    const dokployAccess = dokploy.getAccessInfo('203.0.113.50');
    expect(dokployAccess.url).toBe('http://203.0.113.50:3000');
    expect(dokployAccess.firewallPorts.some((p) => p.port === 3000)).toBe(true);

    const cloudron = requireControlPanelAdapter('cloudron');
    const cloudronAccess = cloudron.getAccessInfo('srv.example.com');
    expect(cloudronAccess.url).toBe('https://srv.example.com');
  });

  it('validates hardware and OS compatibility accurately', () => {
    const dokploy = requireControlPanelAdapter('dokploy');

    // Valid Ubuntu 2GB / 2 Cores / 30GB disk
    const valid = dokploy.validateCompatibility('ubuntu', 2048, 2, 30);
    expect(valid.compatible).toBe(true);
    expect(valid.reasons.length).toBe(0);

    // Incompatible OS (e.g. archlinux) and insufficient RAM (512MB < 2048MB)
    const invalid = dokploy.validateCompatibility('archlinux', 512, 1, 10);
    expect(invalid.compatible).toBe(false);
    expect(invalid.reasons.length).toBeGreaterThanOrEqual(2);
    expect(invalid.reasons.some((r) => r.includes('archlinux'))).toBe(true);
    expect(invalid.reasons.some((r) => r.includes('RAM'))).toBe(true);
  });

  it('buildServerCloudInitWithControlPanel embeds agent and panel bootstrap in user-data', () => {
    const cloudInit = buildServerCloudInitWithControlPanel({
      hostname: 'node-01.cloudhost247.net',
      sshKeys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGo4w test@cloudhost247'],
      agentId: 'agent-12345',
      agentSecret: 'secret-token-abc',
      controlUrl: 'https://control.cloudhost247.com',
      installerUrl: 'https://control.cloudhost247.com/agent-install.sh',
      controlPanelSlug: 'coolify',
    });

    expect(cloudInit).toContain('#cloud-config');
    expect(cloudInit).toContain('hostname: node-01.cloudhost247.net');
    expect(cloudInit).toContain('CH247_AGENT_ID=\'agent-12345\'');
    expect(cloudInit).toContain('CH247_AGENT_SECRET=\'secret-token-abc\'');
    expect(cloudInit).toContain('coolify');
    expect(cloudInit).toContain('/var/lib/cloudhost247/install-panel.sh');
  });
});

describe('Control panel management operations fail closed (P0-2)', () => {
  const ALL_18_SLUGS = [
    'dokploy',
    'coolify',
    'cloudpanel',
    'cpanel',
    'plesk',
    'directadmin',
    'cyberpanel',
    'hestiacp',
    'fastpanel',
    'aapanel',
    'easypanel',
    'cosmos',
    'cloudron',
    'webuzo',
    'webmin',
    'tinycp',
    'kusanagi',
    'adminbolt',
  ];

  const installOptions: ControlPanelInstallOptions = {
    hostname: 'srv1.example.com',
    serverIp: '198.51.100.10',
    adminEmail: 'admin@example.com',
    adminPassword: 'SecretPassword123!',
    osSlug: 'ubuntu',
    osVersion: '24.04',
    architecture: 'x86_64',
  };

  /**
   * Every management operation the adapter contract exposes. None of them is wired to a real panel
   * upstream, so each must refuse rather than return `{ success: true }`, `ACTIVE` or
   * `healthy: true` — a fabricated result a caller would read as a real account/domain/certificate.
   */
  const OPERATIONS: Array<{ name: string; run: (adapter: ControlPanelAdapter) => Promise<unknown> }> = [
    { name: 'install', run: (a) => a.install!(installOptions) },
    { name: 'uninstall', run: (a) => a.uninstall!({ serverIp: '198.51.100.10' }) },
    { name: 'configure', run: (a) => a.configure!({}) },
    { name: 'getStatus', run: (a) => a.getStatus!({ serverIp: '198.51.100.10' }) },
    { name: 'healthCheck', run: (a) => a.healthCheck!({ serverIp: '198.51.100.10' }) },
    { name: 'createAccount', run: (a) => a.createAccount!({}) },
    { name: 'suspendAccount', run: (a) => a.suspendAccount!({}) },
    { name: 'unsuspendAccount', run: (a) => a.unsuspendAccount!({}) },
    { name: 'terminateAccount', run: (a) => a.terminateAccount!({}) },
    { name: 'createDomain', run: (a) => a.createDomain!({ domain: 'example.com' }) },
    { name: 'deleteDomain', run: (a) => a.deleteDomain!({ domain: 'example.com' }) },
    { name: 'createSubdomain', run: (a) => a.createSubdomain!({ domain: 'example.com', subdomain: 'www' }) },
    { name: 'createDatabase', run: (a) => a.createDatabase!({ databaseName: 'db1' }) },
    { name: 'deleteDatabase', run: (a) => a.deleteDatabase!({ databaseName: 'db1' }) },
    { name: 'createEmailAccount', run: (a) => a.createEmailAccount!({ email: 'a@example.com' }) },
    { name: 'deleteEmailAccount', run: (a) => a.deleteEmailAccount!({ email: 'a@example.com' }) },
    { name: 'createDNSRecord', run: (a) => a.createDNSRecord!({}) },
    { name: 'deleteDNSRecord', run: (a) => a.deleteDNSRecord!({}) },
    { name: 'issueSSL', run: (a) => a.issueSSL!({ domain: 'example.com' }) },
    { name: 'renewSSL', run: (a) => a.renewSSL!({ domain: 'example.com' }) },
    { name: 'getUsage', run: (a) => a.getUsage!({ serverIp: '198.51.100.10' }) },
    { name: 'restartService', run: (a) => a.restartService!('httpd') },
  ];

  it('refuses every management operation on every adapter with a typed, non-retryable error', async () => {
    for (const slug of ALL_18_SLUGS) {
      const adapter = requireControlPanelAdapter(slug);
      for (const operation of OPERATIONS) {
        let caught: unknown;
        try {
          await operation.run(adapter);
        } catch (error) {
          caught = error;
        }

        expect(caught, `${slug}.${operation.name} should refuse`).toBeInstanceOf(ControlPanelOperationError);
        const error = caught as ControlPanelOperationError;
        expect(error.code, `${slug}.${operation.name} code`).toBe('NOT_IMPLEMENTED');
        expect(error.retryable, `${slug}.${operation.name} must not be retryable`).toBe(false);
        expect(error.panelSlug).toBe(slug);
        expect(error.operation).toBe(operation.name);
        expect(error.message).toContain(slug);
        expect(error.message).toContain(operation.name);
        expect(error.message).toMatch(/no real upstream control-panel adapter is wired/);
      }
    }
  });

  it('never resolves a management operation with a fabricated success payload', async () => {
    for (const slug of ALL_18_SLUGS) {
      const adapter = requireControlPanelAdapter(slug);
      for (const operation of OPERATIONS) {
        const resolved = await operation
          .run(adapter)
          .then(() => 'resolved')
          .catch(() => 'refused');
        expect(resolved, `${slug}.${operation.name} must not resolve`).toBe('refused');
      }
    }
  });

  it('keeps the local capability catalogue read-only and usable', () => {
    for (const slug of ALL_18_SLUGS) {
      const adapter = requireControlPanelAdapter(slug);
      expect(adapter.getAccessInfo('203.0.113.50').url).toMatch(/^https?:\/\//);
      const compatibility = adapter.validateCompatibility('ubuntu', 8192, 4, 100);
      expect(typeof compatibility.compatible).toBe('boolean');
      expect(Array.isArray(compatibility.reasons)).toBe(true);
      // AdminBolt deliberately requires no inbound ports; the catalogue itself must stay readable.
      expect(Array.isArray(adapter.getRequiredFirewallPorts())).toBe(true);
      expect(adapter.generateInstallScript(installOptions)).toContain('#!/bin/bash');
    }
  });

  it('gates a capability-disabled operation with UNSUPPORTED_OPERATION, not a fabricated success', () => {
    const cpanel = requireControlPanelAdapter('cpanel') as unknown as {
      assertCapability(capability: 'docker', operationName: string): void;
    };

    let caught: unknown;
    try {
      cpanel.assertCapability('docker', 'runContainer');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ControlPanelOperationError);
    const error = caught as ControlPanelOperationError;
    expect(error.code).toBe('UNSUPPORTED_OPERATION');
    expect(error.retryable).toBe(false);
    expect(error.operation).toBe('runContainer');
    expect(error.message).toContain('docker');
  });
});
