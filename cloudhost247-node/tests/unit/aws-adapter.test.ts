import { createPrivateKey, createPublicKey } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AwsProviderAdapter } from '../../src/infrastructure/providers/aws-adapter';
import { ProviderError, type CreateProviderServerInput } from '../../src/infrastructure/providers/types';
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../src/db/infrastructure-providers';
// eslint-disable-next-line import/first
import { decodeSshRsaPublicKey } from '../helpers/ssh-public-key';

function provider(): InfrastructureProviderRow {
  return {
    id: 'provider-1', name: 'AWS', slug: 'aws', provider_type: 'AWS', adapter: 'aws', status: 'ACTIVE',
    api_base_url: null, credential_env_prefix: 'AWS', capabilities: {}, metadata: {},
    last_health_check_at: null, last_health_status: null, created_at: '', updated_at: '',
  };
}

const image = { provider_image_id: 'ami-123', provider_template_id: null } as ServerOsImageRow;

function createInput(overrides: Partial<CreateProviderServerInput> = {}): CreateProviderServerInput {
  return {
    idempotencyKey: 'operation-123', name: 'host-one', hostname: 'host-one', architecture: 'x86_64',
    image, regionCode: 'us-east-1', datacenterCode: null,
    planMetadata: { providerServerType: 't3.micro', awsKeyName: 'provisioning-key' },
    sshPublicKeys: ['ssh-ed25519 AAAA customer@example'], userData: '#cloud-config\nusers: []',
    ...overrides,
  };
}

function adapter(responses: unknown[]) {
  const send = vi.fn(async () => responses.shift());
  const instance = new AwsProviderAdapter(provider(), {
    AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'us-east-1',
  }, { send });
  return { instance, send };
}

function commandInput(command: unknown): Record<string, unknown> {
  return (command as { input: Record<string, unknown> }).input;
}

/** The serial console is a third AWS service, so it gets its own fake transport. */
function consoleAdapter(serialConsoleResponses: unknown[]) {
  const serialConsoleSend = vi.fn(async () => {
    const next = serialConsoleResponses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const instance = new AwsProviderAdapter(provider(), {
    AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'us-east-1',
  }, { send: vi.fn(async () => ({})) }, { send: vi.fn(async () => ({})) }, { send: serialConsoleSend });
  return { instance, serialConsoleSend };
}

function serialConsoleError(name: string): Error {
  return Object.assign(new Error('the serial console service refused'), { name, $metadata: { httpStatusCode: 400 } });
}

describe('AwsProviderAdapter', () => {
  it('uses an idempotency lookup before constructing a RunInstances request', async () => {
    const { instance, send } = adapter([
      { Reservations: [] },
      { Instances: [{ InstanceId: 'i-123', ImageId: 'ami-123', State: { Name: 'pending' } }] },
    ]);

    const created = await instance.createServer(createInput());

    expect(created).toMatchObject({ id: 'i-123', status: 'pending', imageId: 'ami-123' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]?.constructor.name).toBe('DescribeInstancesCommand');
    expect(send.mock.calls[1]?.[0]?.constructor.name).toBe('RunInstancesCommand');
    expect(commandInput(send.mock.calls[1]?.[0])).toMatchObject({
      ImageId: 'ami-123', InstanceType: 't3.micro', MinCount: 1, MaxCount: 1,
      ClientToken: 'operation-123', KeyName: 'provisioning-key',
    });
    expect(commandInput(send.mock.calls[1]?.[0]).TagSpecifications).toEqual([{
      ResourceType: 'instance',
      Tags: [
        { Key: 'Name', Value: 'host-one' },
        { Key: 'cloudhost247:idempotency', Value: 'operation-123' },
      ],
    }]);
    expect(commandInput(send.mock.calls[1]?.[0]).UserData).toBe(Buffer.from('#cloud-config\nusers: []').toString('base64'));
  });

  it('does not silently discard supplied public keys when no EC2 key pair is configured', async () => {
    const { instance, send } = adapter([{ Reservations: [] }]);

    await expect(instance.createServer(createInput({ planMetadata: { providerServerType: 't3.micro' } })))
      .rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(send).toHaveBeenCalledTimes(1); // idempotency lookup; no billable create request
  });

  it('discovers the root EBS volume before creating a snapshot', async () => {
    const { instance, send } = adapter([
      { Reservations: [{ Instances: [{
        InstanceId: 'i-123', ImageId: 'ami-123', State: { Name: 'running' }, RootDeviceName: '/dev/xvda',
        BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { VolumeId: 'vol-root' } }],
      }] }] },
      { SnapshotId: 'snap-123', State: 'pending', Description: 'before maintenance' },
    ]);

    await expect(instance.createSnapshot('i-123', 'before maintenance')).resolves.toEqual({
      id: 'snap-123', state: 'pending', volumeId: 'vol-root', description: 'before maintenance',
    });
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'DescribeInstancesCommand', 'CreateSnapshotCommand',
    ]);
    expect(commandInput(send.mock.calls[1]?.[0])).toMatchObject({ VolumeId: 'vol-root', Description: 'before maintenance' });
  });

  it('maps AWS authentication failures to the platform provider error contract', async () => {
    const { instance } = adapter([]);
    const failingAdapter = new AwsProviderAdapter(provider(), {
      AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'us-east-1',
    }, { send: vi.fn(async () => { throw { name: 'AuthFailure', $metadata: { httpStatusCode: 403 } }; }) });

    await expect(failingAdapter.validateConfiguration()).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED', retryable: false,
    } satisfies Partial<ProviderError>);
  });

  describe('CloudWatch metrics', () => {
    /** Builds an adapter whose metrics transport answers one GetMetricStatistics call at a time. */
    function metricsAdapter(datapoints: Array<Array<{ Average?: number; Maximum?: number; Unit?: string }>>) {
      const send = vi.fn(async () => ({ Datapoints: datapoints.shift() ?? [] }));
      const instance = new AwsProviderAdapter(provider(), {
        AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'us-east-1',
      }, { send: vi.fn(async () => ({})) }, { send });
      return { instance, send };
    }

    it('reads EC2 metrics from CloudWatch with the documented namespace, dimension and period', async () => {
      const { instance, send } = metricsAdapter([
        [{ Average: 12.5, Maximum: 40, Unit: 'Percent' }],
        [{ Average: 1024, Maximum: 2048, Unit: 'Bytes' }],
        [{ Average: 512, Maximum: 900, Unit: 'Bytes' }],
        [{ Average: 3, Maximum: 7, Unit: 'Count' }],
        [{ Average: 1, Maximum: 2, Unit: 'Count' }],
        [{ Average: 0, Maximum: 0, Unit: 'Count' }],
      ]);

      const result = await instance.getServerMetrics('i-0abc123');

      const first = commandInput(send.mock.calls[0]?.[0]);
      expect(first).toMatchObject({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [{ Name: 'InstanceId', Value: 'i-0abc123' }],
        Period: 300,
        Statistics: ['Average', 'Maximum'],
      });
      expect(send).toHaveBeenCalledTimes(6);
      expect(result).toMatchObject({
        instanceId: 'i-0abc123', region: 'us-east-1', namespace: 'AWS/EC2', periodSeconds: 300, missing: [],
      });
      expect(result.metrics).toMatchObject({
        CPUUtilization: { unit: 'Percent', average: 12.5, maximum: 40, samples: 1 },
        NetworkIn: { unit: 'Bytes', average: 1024, maximum: 2048, samples: 1 },
      });
    });

    it('reports metrics with no datapoints as missing rather than zero-filling them', async () => {
      const { instance } = metricsAdapter([
        [{ Average: 5, Maximum: 9, Unit: 'Percent' }],
        [], [], [], [], [],
      ]);

      const result = await instance.getServerMetrics('i-0abc123');

      // A stopped instance has no samples; reporting 0 would read as a real idle measurement.
      expect(Object.keys(result.metrics as object)).toEqual(['CPUUtilization']);
      expect(result.missing).toEqual([
        'NetworkIn', 'NetworkOut', 'DiskReadOps', 'DiskWriteOps', 'StatusCheckFailed',
      ]);
    });

    it('fails closed before any CloudWatch call when no region is configured', async () => {
      const send = vi.fn(async () => ({ Datapoints: [] }));
      const instance = new AwsProviderAdapter(provider(), {
        AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret',
      }, { send: vi.fn(async () => ({})) }, { send });

      await expect(instance.getServerMetrics('i-0abc123')).rejects.toMatchObject({
        code: 'PROVIDER_NOT_CONFIGURED', retryable: false,
      } satisfies Partial<ProviderError>);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('serial console (EC2 Instance Connect)', () => {
    it('pushes a public key and hands over the private half with the 60-second API deadline', async () => {
      const { instance, serialConsoleSend } = consoleAdapter([{ Success: true }]);
      const before = Date.now();

      const session = await instance.getConsole('i-0abc123');

      expect(session).toMatchObject({ type: 'ec2-serial-console-ssh', username: 'i-0abc123.port0' });
      expect(session.privateKey).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
      const expiresAt = Date.parse(String(session.expiresAt));
      expect(expiresAt - before).toBeGreaterThanOrEqual(59_000);
      expect(expiresAt - before).toBeLessThanOrEqual(61_000);
      expect(String(session.notes)).toContain(
        'ssh -i <saved-key-file> i-0abc123.port0@serial-console.ec2-instance-connect.us-east-1.aws'
      );
      // This is a session, not the read-only console output text the adapter used to return.
      expect(session.output).toBeUndefined();

      expect(serialConsoleSend).toHaveBeenCalledTimes(1);
      const command = serialConsoleSend.mock.calls[0]?.[0];
      expect((command as { constructor: { name: string } }).constructor.name).toBe('SendSerialConsoleSSHPublicKeyCommand');
      expect(commandInput(command)).toMatchObject({ InstanceId: 'i-0abc123', SerialPort: 0 });

      // The public key AWS receives is the public half of the private key the customer receives.
      const parsed = decodeSshRsaPublicKey(String(commandInput(command).SSHPublicKey));
      const jwk = createPublicKey(createPrivateKey(String(session.privateKey))).export({ format: 'jwk' }) as { n?: string; e?: string };
      expect(parsed.modulus.toString('hex')).toBe(Buffer.from(jwk.n ?? '', 'base64url').toString('hex'));
      expect(parsed.exponent.toString('hex')).toBe(Buffer.from(jwk.e ?? '', 'base64url').toString('hex'));
    });

    it('refuses a 200 that did not actually start a session instead of handing over a dead key', async () => {
      const { instance } = consoleAdapter([{ Success: false }]);

      await expect(instance.getConsole('i-0abc123')).rejects.toMatchObject({
        code: 'PROVIDER_ERROR', retryable: false,
      } satisfies Partial<ProviderError>);
    });

    it.each([
      ['SerialConsoleAccessDisabledException', 'UNSUPPORTED_OPERATION', false],
      ['EC2InstanceTypeInvalidException', 'UNSUPPORTED_OPERATION', false],
      ['EC2InstanceStateInvalidException', 'SERVICE_UNAVAILABLE', true],
      ['SerialConsoleSessionLimitExceededException', 'SERVICE_UNAVAILABLE', true],
      ['AuthException', 'AUTHENTICATION_FAILED', false],
      ['EC2InstanceNotFoundException', 'RESOURCE_NOT_FOUND', false],
    ])('maps the service error %s to %s', async (name, code, retryable) => {
      const { instance } = consoleAdapter([serialConsoleError(name)]);

      await expect(instance.getConsole('i-0abc123')).rejects.toMatchObject({ code, retryable });
    });

    it('fails closed before generating or pushing a key when no region is configured', async () => {
      const serialConsoleSend = vi.fn(async () => ({ Success: true }));
      const instance = new AwsProviderAdapter(provider(), {
        AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret',
      }, { send: vi.fn(async () => ({})) }, { send: vi.fn(async () => ({})) }, { send: serialConsoleSend });

      await expect(instance.getConsole('i-0abc123')).rejects.toMatchObject({
        code: 'PROVIDER_NOT_CONFIGURED', retryable: false,
      } satisfies Partial<ProviderError>);
      expect(serialConsoleSend).not.toHaveBeenCalled();
    });
  });
});
