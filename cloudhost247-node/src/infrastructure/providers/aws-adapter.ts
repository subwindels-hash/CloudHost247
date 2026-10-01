import {
  CreateSnapshotCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeRegionsCommand,
  EC2Client,
  GetConsoleOutputCommand,
  ModifyInstanceAttributeCommand,
  RebootInstancesCommand,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import type {
  CreateSnapshotCommandOutput,
  DescribeImagesCommandOutput,
  DescribeInstancesCommandOutput,
  GetConsoleOutputCommandOutput,
  Instance,
} from '@aws-sdk/client-ec2';
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { unsupportedRescue } from './common';
import {
  ProviderError,
  asString,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
  type ProviderHealthResult,
  type ProviderImage,
  type ProviderServer,
  type ReinstallProviderServerInput,
  type RescueRequest,
  type RescueSession,
} from './types';

/** Minimal command transport surface, which also makes command construction unit-testable. */
type Ec2Transport = { send(command: object): Promise<unknown> };

interface AwsError {
  name?: string;
  message?: string;
  code?: string;
  $metadata?: { httpStatusCode?: number };
}

function rootVolumeId(instance: Instance): string | null {
  const rootDevice = instance.RootDeviceName;
  const rootMapping = rootDevice
    ? instance.BlockDeviceMappings?.find((mapping) => mapping.DeviceName === rootDevice)
    : instance.BlockDeviceMappings?.find((mapping) => mapping.Ebs?.VolumeId);
  return rootMapping?.Ebs?.VolumeId ?? null;
}

function toServer(instance: Instance): ProviderServer {
  const instanceId = instance.InstanceId;
  if (!instanceId) {
    throw new ProviderError('PROVIDER_ERROR', 'AWS returned an instance without an id', true);
  }

  return {
    id: instanceId,
    status: instance.State?.Name ?? 'unknown',
    name: instance.Tags?.find((tag) => tag.Key === 'Name')?.Value ?? null,
    ipAddress: instance.PublicIpAddress ?? null,
    imageId: instance.ImageId ?? null,
    metadata: {
      instanceType: instance.InstanceType ?? null,
      availabilityZone: instance.Placement?.AvailabilityZone ?? null,
      rootVolumeId: rootVolumeId(instance),
    },
  };
}

function toImage(image: NonNullable<DescribeImagesCommandOutput['Images']>[number]): ProviderImage | null {
  if (!image.ImageId) return null;
  return {
    id: image.ImageId,
    name: image.Name ?? image.Description ?? null,
    architecture: image.Architecture ?? null,
    available: image.State === 'available',
    metadata: {
      creationDate: image.CreationDate ?? null,
      ownerId: image.OwnerId ?? null,
      rootDeviceType: image.RootDeviceType ?? null,
    },
  };
}

function instances(result: DescribeInstancesCommandOutput): Instance[] {
  return result.Reservations?.flatMap((reservation) => reservation.Instances ?? []) ?? [];
}

function translateError(error: unknown): never {
  const awsError = error as AwsError;
  const name = awsError.name ?? awsError.code ?? '';
  const status = awsError.$metadata?.httpStatusCode;

  if (status === 401 || status === 403 || /AuthFailure|Unauthorized|InvalidClientToken/i.test(name)) {
    throw new ProviderError('AUTHENTICATION_FAILED', 'AWS rejected the configured credentials or IAM permissions', false);
  }
  if (status === 404 || /NotFound/i.test(name)) {
    throw new ProviderError('RESOURCE_NOT_FOUND', 'The requested AWS resource was not found', false);
  }
  if (/InsufficientInstanceCapacity|InsufficientHostCapacity/i.test(name)) {
    throw new ProviderError('INSUFFICIENT_CAPACITY', 'AWS has insufficient capacity for the requested instance type', true);
  }
  if (/RequestLimitExceeded|Throttl/i.test(name) || status === 429) {
    throw new ProviderError('RATE_LIMITED', 'AWS rate limited the request', true);
  }
  if (/Timeout|ETIMEDOUT/i.test(name)) {
    throw new ProviderError('PROVIDER_TIMEOUT', 'AWS request timed out', true);
  }
  if (/ECONNRESET|ENOTFOUND|NetworkingError|Network/i.test(name)) {
    throw new ProviderError('NETWORK_TEMPORARY_FAILURE', 'AWS network request failed', true);
  }

  throw new ProviderError(
    'PROVIDER_ERROR',
    awsError.message ?? 'AWS EC2 request failed',
    status === undefined || status >= 500,
  );
}

/** Native EC2 implementation. IAM access is deliberately scoped by the deployment operator. */
export class AwsProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'aws';
  private readonly client: Ec2Transport;
  private readonly region: string | undefined;

  constructor(
    readonly provider: InfrastructureProviderRow,
    source: NodeJS.ProcessEnv = process.env,
    client?: Ec2Transport,
  ) {
    const prefix = provider.credential_env_prefix || 'AWS';
    const accessKeyId = source[`${prefix}_ACCESS_KEY_ID`] ?? source.AWS_ACCESS_KEY_ID;
    const secretAccessKey = source[`${prefix}_SECRET_ACCESS_KEY`] ?? source.AWS_SECRET_ACCESS_KEY;
    const sessionToken = source[`${prefix}_SESSION_TOKEN`] ?? source.AWS_SESSION_TOKEN;
    this.region = source[`${prefix}_REGION`] ?? source.AWS_REGION;

    this.client = client ?? new EC2Client({
      // The fallback only permits construction: every operation fails closed in configured().
      region: this.region ?? 'us-east-1',
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) } }
        : {}),
    });
  }

  private configured(): string {
    if (!this.region) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'AWS access key, secret access key, and region are required',
        false,
      );
    }
    return this.region;
  }

  private async send<T>(command: object): Promise<T> {
    this.configured();
    try {
      return await this.client.send(command) as T;
    } catch (error) {
      return translateError(error);
    }
  }

  private requireConfiguredRegion(regionCode: string): void {
    const configuredRegion = this.configured();
    if (regionCode && regionCode !== configuredRegion) {
      throw new ProviderError(
        'INVALID_CONFIGURATION',
        `EC2 plan region ${regionCode} does not match this provider's configured region ${configuredRegion}`,
        false,
      );
    }
  }

  async validateConfiguration(): Promise<void> {
    const region = this.configured();
    await this.send(new DescribeRegionsCommand({ RegionNames: [region] }));
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    this.requireConfiguredRegion(input.regionCode);
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    const instanceType = asString(input.planMetadata.providerServerType)
      ?? asString(input.planMetadata.instanceType);
    const imageId = input.image.provider_image_id ?? input.image.provider_template_id;
    const keyName = asString(input.planMetadata.awsKeyName) ?? asString(input.planMetadata.keyName);

    if (!instanceType) {
      throw new ProviderError('INVALID_CONFIGURATION', 'AWS plan requires providerServerType (EC2 instance type)', false);
    }
    if (!imageId) {
      throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no AWS AMI identifier', false);
    }
    if (input.sshPublicKeys.length > 0 && !keyName) {
      throw new ProviderError(
        'INVALID_CONFIGURATION',
        'AWS cannot inject supplied SSH keys without an existing awsKeyName in plan metadata',
        false,
      );
    }

    const output = await this.send<{ Instances?: Instance[] }>(new RunInstancesCommand({
      ImageId: imageId,
      // The SDK model uses a generated string-union. EC2 accepts account/region supported values.
      InstanceType: instanceType as never,
      MinCount: 1,
      MaxCount: 1,
      ClientToken: input.idempotencyKey,
      UserData: Buffer.from(input.userData).toString('base64'),
      ...(keyName ? { KeyName: keyName } : {}),
      TagSpecifications: [{
        ResourceType: 'instance',
        Tags: [
          { Key: 'Name', Value: input.name },
          { Key: 'cloudhost247:idempotency', Value: input.idempotencyKey },
        ],
      }],
    }));
    const created = output.Instances?.[0];
    if (!created) {
      throw new ProviderError('PROVIDER_ERROR', 'AWS returned no instance for RunInstances', true);
    }
    return toServer(created);
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const result = await this.send<DescribeInstancesCommandOutput>(new DescribeInstancesCommand({
      Filters: [{ Name: 'tag:cloudhost247:idempotency', Values: [idempotencyKey] }],
    }));
    const instance = instances(result)[0];
    return instance ? toServer(instance) : null;
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    const result = await this.send<DescribeInstancesCommandOutput>(new DescribeInstancesCommand({
      InstanceIds: [providerServerId],
    }));
    const instance = instances(result)[0];
    if (!instance) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'AWS instance was not found', false);
    }
    return toServer(instance);
  }

  getServer(providerServerId: string): Promise<ProviderServer> {
    return this.getServerStatus(providerServerId);
  }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async deleteServer(providerServerId: string): Promise<void> {
    await this.send(new TerminateInstancesCommand({ InstanceIds: [providerServerId] }));
  }

  async rebootServer(providerServerId: string): Promise<void> {
    await this.send(new RebootInstancesCommand({ InstanceIds: [providerServerId] }));
  }

  async shutdownServer(providerServerId: string): Promise<void> {
    await this.send(new StopInstancesCommand({ InstanceIds: [providerServerId] }));
  }

  async startServer(providerServerId: string): Promise<void> {
    await this.send(new StartInstancesCommand({ InstanceIds: [providerServerId] }));
  }

  powerOnServer(providerServerId: string): Promise<void> {
    return this.startServer(providerServerId);
  }

  powerOffServer(providerServerId: string): Promise<void> {
    return this.shutdownServer(providerServerId);
  }

  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    return this.reinstallServer(input);
  }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    const instanceType = asString(planMetadata.providerServerType) ?? asString(planMetadata.instanceType);
    if (!instanceType) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Target EC2 instance type is missing', false);
    }
    await this.send(new ModifyInstanceAttributeCommand({
      InstanceId: providerServerId,
      InstanceType: { Value: instanceType },
    }));
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    const server = await this.getServerStatus(providerServerId);
    const volumeId = asString(server.metadata.rootVolumeId);
    if (!volumeId) {
      throw new ProviderError('UNSUPPORTED_OPERATION', 'AWS instance has no discoverable root EBS volume', false);
    }
    const snapshot = await this.send<CreateSnapshotCommandOutput>(new CreateSnapshotCommand({
      VolumeId: volumeId,
      Description: description,
    }));
    return {
      id: snapshot.SnapshotId ?? null,
      state: snapshot.State ?? null,
      volumeId,
      description: snapshot.Description ?? description,
    };
  }

  async deleteSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Deleting EBS snapshots is not enabled by this adapter', false);
  }

  async restoreSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'Restoring an EC2 root volume from a snapshot requires a replacement-instance workflow',
      false,
    );
  }

  async reinstallServer(_input: ReinstallProviderServerInput): Promise<ProviderServer> {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'EC2 cannot safely reinstall an in-place root image; provision a replacement instance instead',
      false,
    );
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const result = await this.send<DescribeImagesCommandOutput>(new DescribeImagesCommand({
      Owners: ['self', 'amazon'],
      Filters: [{ Name: 'state', Values: ['available'] }],
    }));
    return (result.Images ?? []).map(toImage).filter((image): image is ProviderImage => image !== null);
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const imageId = image.provider_image_id ?? image.provider_template_id;
    if (!imageId) return null;
    const result = await this.send<DescribeImagesCommandOutput>(new DescribeImagesCommand({
      ImageIds: [imageId],
    }));
    const found = result.Images?.[0];
    return found ? toImage(found) : null;
  }

  enableRescue(_providerServerId: string, _input: RescueRequest): Promise<RescueSession> {
    return unsupportedRescue('aws');
  }

  disableRescue(_providerServerId: string): Promise<void> {
    return Promise.reject(new ProviderError('UNSUPPORTED_OPERATION', 'AWS EC2 rescue mode is not supported', false));
  }

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    const output = await this.send<GetConsoleOutputCommandOutput>(new GetConsoleOutputCommand({
      InstanceId: providerServerId,
      Latest: true,
    }));
    return {
      output: output.Output ?? null,
      timestamp: output.Timestamp?.toISOString() ?? null,
      instanceId: output.InstanceId ?? providerServerId,
    };
  }

  async getServerMetrics(_providerServerId: string): Promise<Record<string, unknown>> {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'CloudWatch metrics require a separately scoped CloudWatch integration',
      false,
    );
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expectedImageId = expectedImage.provider_image_id ?? expectedImage.provider_template_id;
      return {
        exists: true,
        poweredOn: server.status === 'running',
        ipAddress: server.ipAddress,
        imageMatches: !expectedImageId || server.imageId === expectedImageId,
        providerStatus: server.status,
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        return { exists: false, poweredOn: false, ipAddress: null, imageMatches: false, providerStatus: 'missing' };
      }
      throw error;
    }
  }
}
