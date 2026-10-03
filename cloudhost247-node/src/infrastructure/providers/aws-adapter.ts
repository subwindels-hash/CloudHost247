import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import {
  EC2InstanceConnectClient,
  SendSerialConsoleSSHPublicKeyCommand,
} from '@aws-sdk/client-ec2-instance-connect';
import {
  AttachVolumeCommand,
  CreateSnapshotCommand,
  CreateVolumeCommand,
  DeleteSnapshotCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeRegionsCommand,
  DescribeSnapshotsCommand,
  DetachVolumeCommand,
  EC2Client,
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
  DescribeSnapshotsCommandOutput,
  Instance,
} from '@aws-sdk/client-ec2';
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { unsupportedRescue } from './common';
import {
  SERIAL_CONSOLE_KEY_TTL_MS,
  generateSerialConsoleKeyPair,
  serialConsoleCommand,
} from './aws-serial-console';
import {
  buildReplacementLaunch,
  replacementEnabled,
  replacementSourceState,
  rootDeviceName,
} from './aws-replacement';
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
  // EC2 Instance Connect's serial console errors (the service's own exception names, so they cannot
  // be confused with an EC2 API error). Each one says something an operator or customer can act on.
  if (/^AuthException$/i.test(name)) {
    throw new ProviderError('AUTHENTICATION_FAILED', 'AWS rejected the configured credentials for EC2 Instance Connect', false);
  }
  if (/SerialConsoleAccessDisabled/i.test(name)) {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'EC2 Serial Console access is disabled for this AWS account; an operator must enable it with EnableSerialConsoleAccess',
      false,
    );
  }
  if (/EC2InstanceTypeInvalid/i.test(name)) {
    throw new ProviderError(
      'UNSUPPORTED_OPERATION',
      'AWS offers the serial console only on Nitro instance types',
      false,
    );
  }
  if (/EC2InstanceStateInvalid/i.test(name)) {
    throw new ProviderError(
      'SERVICE_UNAVAILABLE',
      'The instance is not in a state that supports the serial console; start it and try again',
      true,
    );
  }
  if (/SerialConsoleSessionLimitExceeded/i.test(name)) {
    throw new ProviderError(
      'SERVICE_UNAVAILABLE',
      'The instance already has an open serial console session; only one is supported at a time',
      true,
    );
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
  /** CloudWatch transport, kept separate because metrics are a different service and scope. */
  private readonly metricsClient: Ec2Transport;
  /** Instance Connect transport: the serial console is a different service from EC2 itself. */
  private readonly serialConsoleClient: Ec2Transport;
  private readonly region: string | undefined;
  /** Replacement workflows stay unavailable until the deployment opts in. */
  private readonly allowRootVolumeReplacement: boolean;

  constructor(
    readonly provider: InfrastructureProviderRow,
    source: NodeJS.ProcessEnv = process.env,
    client?: Ec2Transport,
    metricsClient?: Ec2Transport,
    serialConsoleClient?: Ec2Transport,
  ) {
    const prefix = provider.credential_env_prefix || 'AWS';
    const accessKeyId = source[`${prefix}_ACCESS_KEY_ID`] ?? source.AWS_ACCESS_KEY_ID;
    const secretAccessKey = source[`${prefix}_SECRET_ACCESS_KEY`] ?? source.AWS_SECRET_ACCESS_KEY;
    const sessionToken = source[`${prefix}_SESSION_TOKEN`] ?? source.AWS_SESSION_TOKEN;
    this.region = source[`${prefix}_REGION`] ?? source.AWS_REGION;
    this.allowRootVolumeReplacement = replacementEnabled(source, prefix);

    this.client = client ?? new EC2Client({
      // The fallback only permits construction: every operation fails closed in configured().
      region: this.region ?? 'us-east-1',
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) } }
        : {}),
    });
    this.metricsClient = metricsClient ?? new CloudWatchClient({
      region: this.region ?? 'us-east-1',
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) } }
        : {}),
    });
    this.serialConsoleClient = serialConsoleClient ?? new EC2InstanceConnectClient({
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

  private requireRootVolumeReplacement(): void {
    if (!this.allowRootVolumeReplacement) {
      throw new ProviderError(
        'UNSUPPORTED_OPERATION',
        'Replacement-instance and root-volume-restore workflows are disabled; set '
          + 'AWS_ALLOW_ROOT_VOLUME_REPLACEMENT=true (or the provider prefix equivalent) to enable them',
        false,
      );
    }
  }

  private async send<T>(command: object): Promise<T> {
    this.configured();
    try {
      return await this.client.send(command) as T;
    } catch (error) {
      return translateError(error);
    }
  }

  /** Instance Connect is a separate service, so it needs its own transport and error translation. */
  private async sendSerialConsole<T>(command: object): Promise<T> {
    try {
      return await this.serialConsoleClient.send(command) as T;
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

  async deleteSnapshot(_providerServerId: string, snapshotId: string): Promise<void> {
    if (!snapshotId) {
      throw new ProviderError('INVALID_CONFIGURATION', 'A snapshot id is required to delete a snapshot', false);
    }
    await this.send(new DeleteSnapshotCommand({ SnapshotId: snapshotId }));
  }

  /**
   * Restore a snapshot onto this instance's root volume.
   *
   * EC2 has no in-place root restore call, so the workflow is: create a volume
   * from the snapshot in the instance's own availability zone, stop the
   * instance, detach the old root volume, attach the new one at the same device
   * name, and start the instance again if it was running. The previous root
   * volume is detached, not deleted, so the pre-restore data stays recoverable.
   */
  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    this.requireRootVolumeReplacement();
    if (!snapshotId) {
      throw new ProviderError('INVALID_CONFIGURATION', 'A snapshot id is required to restore a root volume', false);
    }
    const source = (await this.send<DescribeInstancesCommandOutput>(new DescribeInstancesCommand({
      InstanceIds: [providerServerId],
    })));
    const instance = instances(source)[0];
    if (!instance) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'AWS instance was not found', false);
    }
    const state = replacementSourceState(instance.State?.Name);
    if (!state) {
      throw new ProviderError(
        'INVALID_CONFIGURATION',
        `A root volume can only be restored on a running or stopped instance (instance is ${instance.State?.Name ?? 'unknown'})`,
        false,
      );
    }
    const deviceName = rootDeviceName(instance);
    const availabilityZone = instance.Placement?.AvailabilityZone;
    if (!deviceName || !availabilityZone) {
      throw new ProviderError(
        'UNSUPPORTED_OPERATION',
        'The instance has no discoverable root device or availability zone, so its root volume cannot be restored',
        false,
      );
    }
    const snapshot = await this.send<DescribeSnapshotsCommandOutput>(new DescribeSnapshotsCommand({
      SnapshotIds: [snapshotId],
    }));
    const found = snapshot.Snapshots?.[0];
    if (!found) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'The requested EBS snapshot was not found', false);
    }
    if ((found.State ?? '') !== 'completed') {
      throw new ProviderError(
        'IMAGE_UNAVAILABLE',
        `The snapshot is not ready to restore (state ${found.State ?? 'unknown'})`,
        true,
      );
    }
    const volume = await this.send<{ VolumeId?: string }>(new CreateVolumeCommand({
      SnapshotId: snapshotId,
      AvailabilityZone: availabilityZone,
      VolumeType: 'gp3',
    }));
    const newVolumeId = volume?.VolumeId;
    if (!newVolumeId) {
      throw new ProviderError('PROVIDER_ERROR', 'AWS returned no volume for CreateVolume', true);
    }
    const oldVolumeId = rootVolumeId(instance);
    await this.send(new StopInstancesCommand({ InstanceIds: [providerServerId] }));
    if (oldVolumeId) {
      await this.send(new DetachVolumeCommand({ VolumeId: oldVolumeId, InstanceId: providerServerId, Force: false }));
    }
    await this.send(new AttachVolumeCommand({ VolumeId: newVolumeId, InstanceId: providerServerId, Device: deviceName }));
    if (state === 'running') {
      await this.send(new StartInstancesCommand({ InstanceIds: [providerServerId] }));
    }
  }

  /**
   * Reinstall by replacement: a new instance from the requested AMI in the same
   * zone, subnet and security groups, with the previous instance stopped (never
   * terminated) once the replacement exists.
   */
  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    this.requireRootVolumeReplacement();
    const imageId = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!imageId) {
      throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no AWS AMI identifier', false);
    }
    const source = await this.send<DescribeInstancesCommandOutput>(new DescribeInstancesCommand({
      InstanceIds: [input.providerServerId],
    }));
    const instance = instances(source)[0];
    if (!instance) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'AWS instance was not found', false);
    }
    const launch = buildReplacementLaunch(instance, {
      imageId,
      name: input.hostname || instance.Tags?.find((tag) => tag.Key === 'Name')?.Value || input.providerServerId,
      idempotencyKey: input.idempotencyKey,
      userData: input.userData,
      confirm: true,
    });
    const created = await this.send<{ Instances?: Instance[] }>(new RunInstancesCommand(launch as never));
    const replacement = created.Instances?.[0];
    if (!replacement) {
      throw new ProviderError('PROVIDER_ERROR', 'AWS returned no instance for the replacement launch', true);
    }
    await this.send(new StopInstancesCommand({ InstanceIds: [input.providerServerId] }));
    return {
      ...toServer(replacement),
      metadata: {
        ...toServer(replacement).metadata,
        replacement: {
          previousServerId: input.providerServerId,
          previousState: instance.State?.Name ?? 'unknown',
          previousAction: 'stopped',
          workflow: 'replacement-instance',
        },
      },
    };
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

  // `async` on purpose: an unreachable rescue must reject, not throw
  // synchronously, so a caller using `.catch()` handles it like every other
  // provider failure.
  async enableRescue(_providerServerId: string, _input: RescueRequest): Promise<RescueSession> {
    return unsupportedRescue('aws');
  }

  disableRescue(_providerServerId: string): Promise<void> {
    return Promise.reject(new ProviderError('UNSUPPORTED_OPERATION', 'AWS EC2 rescue mode is not supported', false));
  }

  /**
   * Starts a real interactive serial console session. EC2 has no console URL and no console session
   * token: the interactive console is reached over SSH by pushing a public key through Instance
   * Connect and connecting with the matching private key, which is what the platform does here —
   * generate the pair, push the public half, hand the private half back once.
   *
   * `GetConsoleOutput` returned the serial console's output *text*, which is a diagnostic, not a
   * session: the console route hands the caller a session and the customer UI renders a session, so
   * the previous implementation advertised a capability and then gave the customer nothing usable.
   *
   * Conditions the AWS API itself reports, mapped to messages a caller can act on: serial console
   * access must be enabled for the account (`EnableSerialConsoleAccess`), the instance must be a
   * Nitro type (the API states this), it must be running, and only one session may be open at a
   * time. The 60-second key lifetime is the API's, not a platform choice, so the session carries it
   * as `expiresAt`.
   */
  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    const region = this.configured();
    const keyPair = generateSerialConsoleKeyPair();
    const result = await this.sendSerialConsole<{ Success?: boolean }>(
      new SendSerialConsoleSSHPublicKeyCommand({
        InstanceId: providerServerId,
        SerialPort: 0,
        SSHPublicKey: keyPair.publicKey,
      }),
    );
    if (result.Success !== true) {
      // A 200 without `Success` means the serial console service did not start a session; handing
      // over the private half anyway would send the customer to a key the service never registered.
      throw new ProviderError('PROVIDER_ERROR', 'AWS did not accept the serial console public key', false);
    }
    return {
      type: 'ec2-serial-console-ssh',
      username: `${providerServerId}.port0`,
      privateKey: keyPair.privateKey,
      expiresAt: new Date(Date.now() + SERIAL_CONSOLE_KEY_TTL_MS).toISOString(),
      notes: `Save the private key to a file (chmod 600) and connect within 60 seconds: `
        + `${serialConsoleCommand(providerServerId, region)}. AWS removes the key after 60 seconds and `
        + `allows one serial console session per instance; the console itself then asks for a local `
        + `operating-system user and password.`,
    };
  }

  /**
   * Reads instance metrics from CloudWatch (`GetMetricStatistics`, namespace `AWS/EC2`,
   * dimension `InstanceId`).
   *
   * These are the metrics EC2 publishes with basic monitoring, so no CloudWatch agent and no
   * detailed monitoring are required. The period is 300s because basic monitoring reports at
   * five-minute granularity; a shorter period would return holes rather than data.
   *
   * A metric with no datapoints is reported in `missing` instead of being zero-filled: a stopped
   * or freshly launched instance genuinely has no samples, and `0` would read as a real
   * measurement of an idle machine.
   */
  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    const region = this.configured();
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    const metricNames = [
      'CPUUtilization',
      'NetworkIn',
      'NetworkOut',
      'DiskReadOps',
      'DiskWriteOps',
      'StatusCheckFailed',
    ] as const;

    const metrics: Record<string, unknown> = {};
    const missing: string[] = [];

    for (const metricName of metricNames) {
      const result = (await this.metricsClient.send(
        new GetMetricStatisticsCommand({
          Namespace: 'AWS/EC2',
          MetricName: metricName,
          Dimensions: [{ Name: 'InstanceId', Value: providerServerId }],
          StartTime: from,
          EndTime: to,
          Period: 300,
          Statistics: ['Average', 'Maximum'],
        })
      )) as { Datapoints?: Array<{ Average?: number; Maximum?: number; Unit?: string }> };

      const points = Array.isArray(result?.Datapoints) ? result.Datapoints : [];
      if (points.length === 0) {
        missing.push(metricName);
        continue;
      }
      const averages = points.map((p) => p.Average).filter((v): v is number => typeof v === 'number');
      const maxima = points.map((p) => p.Maximum).filter((v): v is number => typeof v === 'number');
      metrics[metricName] = {
        unit: typeof points[0]?.Unit === 'string' ? points[0].Unit : null,
        average: averages.length > 0 ? Math.max(...averages) : null,
        maximum: maxima.length > 0 ? Math.max(...maxima) : null,
        samples: points.length,
      };
    }

    return {
      provider: 'aws',
      instanceId: providerServerId,
      region,
      namespace: 'AWS/EC2',
      periodSeconds: 300,
      window: { from: from.toISOString(), to: to.toISOString() },
      metrics,
      missing,
    };
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
