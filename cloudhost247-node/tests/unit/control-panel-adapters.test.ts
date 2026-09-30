import { describe, expect, it } from 'vitest';
import {
  listControlPanelAdapters,
  getControlPanelAdapter,
  requireControlPanelAdapter,
  buildServerCloudInitWithControlPanel,
} from '../../src/control-panels/registry';

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
