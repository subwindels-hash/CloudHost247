/**
 * CloudHost247 Server Agent — provisioning attestation tests.
 *
 * The control plane's provisioning gate refuses to hand a server to a customer until it has seen
 * `securityConfigured === true` AND `monitoringRunning === true` in a fresh, authenticated agent
 * report (cloudhost247-node/src/infrastructure/services/health-checker.ts). Both fields were therefore
 * load-bearing, and `monitoringRunning` was the literal `true` on every host — including a host with
 * no monitoring whatsoever, because nothing in this repository installs any. A gate satisfied by a
 * constant is not a gate, so this suite pins the rule that each field is *evidence*: it must be able
 * to come back false, and it must come back false when the evidence is absent.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';

import { SECURITY_MARKER, monitoringIsRunning, provisioningAttestation } from '../src/attestation.js';
import { systemReport } from '../src/backups.js';

const OS_RELEASE = [
  'NAME="Ubuntu"',
  'VERSION="24.04.1 LTS (Noble Numbat)"',
  'ID=ubuntu',
  'VERSION_ID="24.04"',
  '',
].join('\n');

const deps = (overrides = {}) => ({
  readFile: (file) => {
    if (file !== '/etc/os-release') throw new Error(`unexpected read of ${file}`);
    return OS_RELEASE;
  },
  exists: () => true,
  hostname: () => 'srv-1.example.test',
  ...overrides,
});

const liveReport = { dockerContainers: 3, dockerContainersHealthy: 2, cpuPercent: 12.5 };

// --- the field that used to be a constant --------------------------------------------------------

test('monitoring is reported as running only when the agent really produced the readings', () => {
  assert.equal(monitoringIsRunning(liveReport), true);
  // Every way the evidence can be absent must read as "not monitored".
  assert.equal(monitoringIsRunning({ ...liveReport, dockerContainers: null }), false, 'docker unreachable');
  assert.equal(monitoringIsRunning({ ...liveReport, cpuPercent: null }), false, '/proc/stat unreadable');
  assert.equal(monitoringIsRunning(undefined), false, 'a missing report is not evidence of monitoring');
  // A report that omits the keys entirely (older agent, crashed collection) must not read as true:
  // `undefined !== null` is true, which is exactly how a constant reappears by accident.
  assert.equal(monitoringIsRunning({}), false);
  assert.equal(monitoringIsRunning({ dockerContainers: undefined, cpuPercent: undefined }), false);
});

test('a host with no monitoring reading is reported as not monitored, never as true', () => {
  // The previous implementation returned the literal `true` here.
  const attestation = provisioningAttestation({ dockerContainers: null, cpuPercent: null }, deps());
  assert.equal(attestation.monitoringRunning, false);
});

test('the attestation carries the report it was given, so the field cannot drift from the readings', () => {
  assert.equal(provisioningAttestation(liveReport, deps()).monitoringRunning, true);
  assert.equal(provisioningAttestation({ ...liveReport, cpuPercent: null }, deps()).monitoringRunning, false);
});

test('this sandbox has no docker, so the live report proves the field is not hardcoded', async () => {
  // Executes the real systemReport(): there is no docker binary here, so the docker reading is null
  // and the attestation built from that very report must say monitoring is not running. A literal
  // `true` could not survive this test.
  const report = await systemReport();
  assert.equal(report.dockerContainers, null, 'expected no docker in this environment');
  assert.equal(provisioningAttestation(report, deps()).monitoringRunning, false);
});

// --- security marker (unchanged behaviour, now pinned) --------------------------------------------

test('securityConfigured reports the marker file, and its absence is not papered over', () => {
  assert.equal(provisioningAttestation(liveReport, deps()).securityConfigured, true);
  assert.equal(provisioningAttestation(liveReport, deps({ exists: () => false })).securityConfigured, false);
  const asked = [];
  provisioningAttestation(liveReport, deps({ exists: (file) => (asked.push(file), true) }));
  assert.deepEqual(asked, [SECURITY_MARKER], 'the marker path is part of the control-plane contract');
});

// --- os release parsing ---------------------------------------------------------------------------

test('os-release fields are parsed for the control plane OS/hostname match', () => {
  const attestation = provisioningAttestation(liveReport, deps());
  assert.equal(attestation.osId, 'ubuntu');
  assert.equal(attestation.osVersion, '24.04');
  assert.equal(attestation.hostname, 'srv-1.example.test');
});

test('an unreadable or partial os-release never fabricates fields', () => {
  const unreadable = provisioningAttestation(liveReport, deps({
    readFile: () => {
      throw new Error('ENOENT');
    },
  }));
  assert.equal(unreadable.osId, undefined);
  assert.equal(unreadable.osVersion, undefined);
  // A build-id OS (not a version-id one) still reports a version.
  const buildId = provisioningAttestation(liveReport, deps({
    readFile: () => 'ID=coreos\nBUILD_ID=3815.2.0\n',
  }));
  assert.equal(buildId.osId, 'coreos');
  assert.equal(buildId.osVersion, '3815.2.0');
});

test('the real /etc/os-release on this host parses, so the parser is not only fed fixtures', () => {
  if (!existsSync('/etc/os-release')) return; // not Linux — nothing to read
  const attestation = provisioningAttestation(liveReport);
  assert.equal(typeof attestation.osId, 'string');
  assert.ok(attestation.osId.length > 0, 'a real os-release must yield an ID');
  assert.equal(typeof attestation.hostname, 'string');
});
