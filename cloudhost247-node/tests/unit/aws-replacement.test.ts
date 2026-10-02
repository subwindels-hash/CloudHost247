import { describe, expect, it, vi } from 'vitest';
import { AwsProviderAdapter } from '../../src/infrastructure/providers/aws-adapter';
import { buildReplacementLaunch, replacementTags } from '../../src/infrastructure/providers/aws-replacement';
import { ProviderError, type ReinstallProviderServerInput } from '../../src/infrastructure/providers/types';
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../src/db/infrastructure-providers';

function provider(): InfrastructureProviderRow {
  return {
    id: 'provider-1', name: 'AWS', slug: 'aws', provider_type: 'AWS', adapter: 'aws', status: 'ACTIVE',
    api_base_url: null, credential_env_prefix: 'AWS', capabilities: {}, metadata: {},
    last_health_check_at: null, last_health_status: null, created_at: '', updated_at: '',
  };
}

const baseEnv = { AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'us-east-1' };
const enabledEnv = { ...baseEnv, AWS_ALLOW_ROOT_VOLUME_REPLACEMENT: 'true' };
const image = { provider_image_id: 'ami-123', provider_template_id: null } as ServerOsImageRow;

function adapter(responses: unknown[], env: Record<string, string> = baseEnv) {
  const send = vi.fn(async () => responses.shift());
  const instance = new AwsProviderAdapter(provider(), env, { send });
  return { instance, send };
}

function instanceFixture(overrides: Record<string, unknown> = {}) {
  return {
    InstanceId: 'i-old',
    State: { Name: 'running' },
    InstanceType: 't3.micro',
    ImageId: 'ami-old',
    KeyName: 'provisioning-key',
    SubnetId: 'subnet-1',
    Placement: { AvailabilityZone: 'us-east-1a' },
    SecurityGroups: [{ GroupId: 'sg-1' }, { GroupId: 'sg-2' }],
    RootDeviceName: '/dev/sda1',
    BlockDeviceMappings: [{ DeviceName: '/dev/sda1', Ebs: { VolumeId: 'vol-old' } }],
    Tags: [{ Key: 'Name', Value: 'host-one' }, { Key: 'cloudhost247:idempotency', Value: 'previous-key' }, { Key: 'owner', Value: 'ops' }],
    ...overrides,
  };
}

function commands(send: ReturnType<typeof vi.fn>): string[] {
  return send.mock.calls.map((call) => (call[0] as { constructor: { name: string } }).constructor.name);
}

function inputOf(command: unknown): Record<string, unknown> {
  return (command as { input: Record<string, unknown> }).input;
}

function reinstallInput(overrides: Partial<ReinstallProviderServerInput> = {}): ReinstallProviderServerInput {
  return {
    providerServerId: 'i-old', idempotencyKey: 'op-2', isRetry: false, image, architecture: 'x86_64',
    hostname: 'host-one', sshPublicKeys: [], userData: '#cloud-config\n', ...overrides,
  };
}

describe('EC2 replacement workflows', () => {
  it('keeps both workflows unavailable until the deployment opts in', async () => {
    const { instance, send } = adapter([]);
    await expect(instance.reinstallServer(reinstallInput())).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    await expect(instance.restoreSnapshot('i-old', 'snap-1')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(send).not.toHaveBeenCalled();
  });

  it('deletes a snapshot by id without needing the replacement opt-in', async () => {
    const { instance, send } = adapter([{}]);
    await instance.deleteSnapshot('i-old', 'snap-9');
    expect(commands(send)).toEqual(['DeleteSnapshotCommand']);
    expect(inputOf(send.mock.calls[0][0])).toEqual({ SnapshotId: 'snap-9' });
    await expect(adapter([{}]).instance.deleteSnapshot('i-old', '')).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
  });

  it('reinstalls by launching a replacement and only stopping the previous instance', async () => {
    const { instance, send } = adapter([
      { Reservations: [{ Instances: [instanceFixture()] }] },
      { Instances: [instanceFixture({ InstanceId: 'i-new', State: { Name: 'pending' }, Tags: [{ Key: 'Name', Value: 'host-one' }, { Key: 'cloudhost247:idempotency', Value: 'op-2' }] })] },
      {},
    ], enabledEnv);
    const result = await instance.reinstallServer(reinstallInput());

    expect(commands(send)).toEqual(['DescribeInstancesCommand', 'RunInstancesCommand', 'StopInstancesCommand']);
    const launch = inputOf(send.mock.calls[1][0]);
    expect(launch.ImageId).toBe('ami-123');
    expect(launch.InstanceType).toBe('t3.micro');
    expect(launch.SubnetId).toBe('subnet-1');
    expect(launch.SecurityGroupIds).toEqual(['sg-1', 'sg-2']);
    expect(launch.Placement).toEqual({ AvailabilityZone: 'us-east-1a' });
    expect(launch.KeyName).toBe('provisioning-key');
    expect(launch.ClientToken).toBe('op-2');
    expect(launch.UserData).toBe(Buffer.from('#cloud-config\n').toString('base64'));
    const tags = (launch.TagSpecifications as Array<{ Tags: Array<{ Key: string; Value: string }> }>)[0].Tags;
    expect(tags).toContainEqual({ Key: 'cloudhost247:replacement-for', Value: 'i-old' });
    expect(tags).toContainEqual({ Key: 'owner', Value: 'ops' });
    // The previous idempotency key must not be carried forward, or two instances
    // would answer the same lookup.
    expect(tags.filter((tag) => tag.Key === 'cloudhost247:idempotency')).toEqual([{ Key: 'cloudhost247:idempotency', Value: 'op-2' }]);
    expect(inputOf(send.mock.calls[2][0])).toEqual({ InstanceIds: ['i-old'] });
    // Never terminated: the old instance stays recoverable.
    expect(commands(send)).not.toContain('TerminateInstancesCommand');
    expect(result.id).toBe('i-new');
    expect(result.metadata.replacement).toMatchObject({ previousServerId: 'i-old', previousState: 'running', previousAction: 'stopped', workflow: 'replacement-instance' });
  });

  it('restores a snapshot onto the root volume in place and restarts a running instance', async () => {
    const { instance, send } = adapter([
      { Reservations: [{ Instances: [instanceFixture()] }] },
      { Snapshots: [{ SnapshotId: 'snap-1', State: 'completed' }] },
      { VolumeId: 'vol-new' },
      {},
      {},
      {},
      {},
    ], enabledEnv);
    await instance.restoreSnapshot('i-old', 'snap-1');

    expect(commands(send)).toEqual([
      'DescribeInstancesCommand', 'DescribeSnapshotsCommand', 'CreateVolumeCommand',
      'StopInstancesCommand', 'DetachVolumeCommand', 'AttachVolumeCommand', 'StartInstancesCommand',
    ]);
    expect(inputOf(send.mock.calls[2][0])).toEqual({ SnapshotId: 'snap-1', AvailabilityZone: 'us-east-1a', VolumeType: 'gp3' });
    expect(inputOf(send.mock.calls[4][0])).toEqual({ VolumeId: 'vol-old', InstanceId: 'i-old', Force: false });
    expect(inputOf(send.mock.calls[5][0])).toEqual({ VolumeId: 'vol-new', InstanceId: 'i-old', Device: '/dev/sda1' });
    // The pre-restore root volume is detached, never deleted.
    expect(commands(send)).not.toContain('DeleteVolumeCommand');
  });

  it('leaves a stopped instance stopped after a restore', async () => {
    const { instance, send } = adapter([
      { Reservations: [{ Instances: [instanceFixture({ State: { Name: 'stopped' } })] }] },
      { Snapshots: [{ SnapshotId: 'snap-1', State: 'completed' }] },
      { VolumeId: 'vol-new' },
      {}, {}, {},
    ], enabledEnv);
    await instance.restoreSnapshot('i-old', 'snap-1');
    expect(commands(send)).not.toContain('StartInstancesCommand');
  });

  it('refuses a snapshot that is not ready and changes nothing', async () => {
    const { instance, send } = adapter([
      { Reservations: [{ Instances: [instanceFixture()] }] },
      { Snapshots: [{ SnapshotId: 'snap-1', State: 'pending' }] },
    ], enabledEnv);
    await expect(instance.restoreSnapshot('i-old', 'snap-1')).rejects.toMatchObject({ code: 'IMAGE_UNAVAILABLE', retryable: true });
    expect(commands(send)).toEqual(['DescribeInstancesCommand', 'DescribeSnapshotsCommand']);
  });

  it('refuses a restore on an instance that cannot be stopped cleanly', async () => {
    const { instance, send } = adapter([{ Reservations: [{ Instances: [instanceFixture({ State: { Name: 'terminated' } })] }] }], enabledEnv);
    await expect(instance.restoreSnapshot('i-old', 'snap-1')).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(commands(send)).toEqual(['DescribeInstancesCommand']);
  });
});

describe('replacement launch construction', () => {
  it('requires an explicit confirmation', () => {
    expect(() => buildReplacementLaunch(instanceFixture() as never, {
      imageId: 'ami-1', name: 'n', idempotencyKey: 'k', userData: '', confirm: false,
    })).toThrow(ProviderError);
  });

  it('requires exactly one root device source', () => {
    const options = { name: 'n', idempotencyKey: 'k', userData: '', confirm: true };
    expect(() => buildReplacementLaunch(instanceFixture() as never, { ...options })).toThrow(/exactly one/i);
    expect(() => buildReplacementLaunch(instanceFixture() as never, { ...options, imageId: 'ami-1', snapshotId: 'snap-1' })).toThrow(/exactly one/i);
  });

  it('boots a snapshot-backed launch from the source root device', () => {
    const launch = buildReplacementLaunch(instanceFixture() as never, {
      snapshotId: 'snap-7', volumeType: 'gp3', name: 'n', idempotencyKey: 'k', userData: '', confirm: true,
    });
    expect(launch.BlockDeviceMappings).toEqual([{ DeviceName: '/dev/sda1', Ebs: { SnapshotId: 'snap-7', VolumeType: 'gp3' } }]);
    expect(launch.ImageId).toBeUndefined();
  });

  it('refuses a snapshot-backed launch without a discoverable root device', () => {
    const source = instanceFixture({ RootDeviceName: undefined, BlockDeviceMappings: [] });
    expect(() => buildReplacementLaunch(source as never, {
      snapshotId: 'snap-7', name: 'n', idempotencyKey: 'k', userData: '', confirm: true,
    })).toThrow(/root device/i);
  });

  it('carries ownership tags forward but never the previous idempotency key', () => {
    const tags = replacementTags(instanceFixture() as never, 'host-two', 'op-3');
    expect(tags).toContainEqual({ Key: 'owner', Value: 'ops' });
    expect(tags).toContainEqual({ Key: 'Name', Value: 'host-two' });
    expect(tags).toEqual(expect.arrayContaining([{ Key: 'cloudhost247:idempotency', Value: 'op-3' }]));
    expect(tags.map((tag) => tag.Value)).not.toContain('previous-key');
  });
});
