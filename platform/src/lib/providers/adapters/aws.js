/**
 * Amazon EC2 adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/aws-adapter.ts, with the AWS SDK
 * replaced by this build's own SigV4 + query-protocol client (aws-client.js) and XML reader.
 *
 * Required configuration: `<PREFIX>_ACCESS_KEY_ID`, `<PREFIX>_SECRET_ACCESS_KEY`,
 * `<PREFIX>_REGION` (the registry also accepts the global AWS_* fallbacks). Optional:
 * `<PREFIX>_SESSION_TOKEN` for temporary credentials, per-service endpoint overrides for
 * AWS-compatible endpoints (`<PREFIX>_EC2_ENDPOINT`, `<PREFIX>_CLOUDWATCH_ENDPOINT`,
 * `<PREFIX>_INSTANCE_CONNECT_ENDPOINT`, or the provider's api_base_url for EC2), and
 * `<PREFIX>_ALLOW_ROOT_VOLUME_REPLACEMENT=true` to enable the two destructive workflows.
 *
 * The credentials are read from the server-side environment only — there is no instance-profile or
 * SSO chain in this build, so a missing key is reported as a configuration error rather than
 * silently signing with no credentials.
 *
 * Capability notes that come from AWS itself, not from this build:
 *  - EC2 has no rescue system, so `enableRescue` refuses instead of pretending;
 *  - the console is the EC2 Serial Console: an SSH key pushed through EC2 Instance Connect, valid for
 *    60 seconds, on Nitro instances only, with the serial console enabled on the account;
 *  - reinstall and root-volume restore are instance replacement and volume surgery, not API calls
 *    AWS offers directly, so they require explicit operator enablement.
 */
'use strict';

const { ProviderError, asString } = require('../types');
const { requireSecureBaseUrl, unsupportedRescue } = require('../common');
const { root, wrappedItems, wrappedItemsCI, childCI, childTextCI } = require('../aws-xml');
const { AwsQueryClient, endpointFor } = require('./aws-client');
const {
  SERIAL_CONSOLE_KEY_TTL_MS,
  generateSerialConsoleKeyPair,
  serialConsoleCommand,
} = require('./aws-serial-console');
const {
  buildReplacementLaunch,
  replacementEnabled,
  replacementSourceState,
  rootDeviceName,
} = require('./aws-replacement');

const IDEMPOTENCY_TAG = 'cloudhost247:idempotency';

/** A datum that is absent must stay absent: `Number(null)` would invent a zero. */
function metricNumber(value) {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The instance's root EBS volume, which is what a snapshot and a restore operate on. */
function rootVolumeId(instance) {
  const device = instance.RootDeviceName;
  const mapping = device
    ? (instance.BlockDeviceMappings ?? []).find((entry) => entry.DeviceName === device)
    : (instance.BlockDeviceMappings ?? []).find((entry) => entry.Ebs?.VolumeId);
  return mapping?.Ebs?.VolumeId ?? null;
}

/** The AWS SDK's `Instance` shape, as far as this adapter reads it, from the XML document. */
function normalizeInstance(node) {
  return {
    InstanceId: childTextCI(node, 'instanceId'),
    ImageId: childTextCI(node, 'imageId'),
    InstanceType: childTextCI(node, 'instanceType'),
    KeyName: childTextCI(node, 'keyName'),
    SubnetId: childTextCI(node, 'subnetId'),
    PublicIpAddress: childTextCI(node, 'publicIpAddress'),
    PrivateIpAddress: childTextCI(node, 'privateIpAddress'),
    RootDeviceName: childTextCI(node, 'rootDeviceName'),
    State: { Name: childTextCI(childCI(node, 'instanceState'), 'name') },
    Placement: { AvailabilityZone: childTextCI(childCI(node, 'placement'), 'availabilityZone') },
    Tags: wrappedItems(node, 'tagSet').map((tag) => ({
      Key: childTextCI(tag, 'key') ?? '',
      Value: childTextCI(tag, 'value') ?? '',
    })),
    BlockDeviceMappings: wrappedItems(node, 'blockDeviceMapping').map((mapping) => ({
      DeviceName: childTextCI(mapping, 'deviceName'),
      Ebs: { VolumeId: childTextCI(childCI(mapping, 'ebs'), 'volumeId') },
    })),
    SecurityGroups: wrappedItems(node, 'groupSet')
      .map((group) => ({ GroupId: childTextCI(group, 'groupId') }))
      .filter((group) => Boolean(group.GroupId)),
  };
}

/** Flattens `<DescribeInstancesResponse><reservationSet><item><instancesSet><item…`. */
function instancesOf(document) {
  const out = [];
  for (const reservation of wrappedItems(root(document), 'reservationSet')) {
    for (const instance of wrappedItems(reservation, 'instancesSet')) out.push(normalizeInstance(instance));
  }
  return out;
}

function imageOf(node) {
  if (!node) return null;
  const id = childTextCI(node, 'imageId');
  if (!id) return null;
  return {
    id,
    name: childTextCI(node, 'name') ?? childTextCI(node, 'description'),
    architecture: childTextCI(node, 'architecture'),
    available: childTextCI(node, 'imageState') === 'available',
    metadata: {
      creationDate: childTextCI(node, 'creationDate'),
      ownerId: childTextCI(node, 'imageOwnerId'),
      rootDeviceType: childTextCI(node, 'rootDeviceType'),
    },
  };
}

function imagesOf(document) {
  return wrappedItems(root(document), 'imagesSet').map(imageOf).filter((image) => image !== null);
}

function snapshotOf(node) {
  if (!node) return null;
  return {
    SnapshotId: childTextCI(node, 'snapshotId'),
    State: childTextCI(node, 'status'),
    VolumeId: childTextCI(node, 'volumeId'),
    Description: childTextCI(node, 'description'),
  };
}

function toServer(instance) {
  const instanceId = instance.InstanceId;
  if (!instanceId) {
    throw new ProviderError('PROVIDER_ERROR', 'AWS returned an instance without an id', true);
  }
  return {
    id: instanceId,
    status: instance.State?.Name ?? 'unknown',
    name: (instance.Tags ?? []).find((tag) => tag.Key === 'Name')?.Value ?? null,
    ipAddress: instance.PublicIpAddress ?? null,
    imageId: instance.ImageId ?? null,
    metadata: {
      instanceType: instance.InstanceType ?? null,
      availabilityZone: instance.Placement?.AvailabilityZone ?? null,
      rootVolumeId: rootVolumeId(instance),
    },
  };
}

class AwsProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'aws';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || 'AWS';
    this.accessKeyId = source[`${prefix}_ACCESS_KEY_ID`] ?? source.AWS_ACCESS_KEY_ID;
    this.secretAccessKey = source[`${prefix}_SECRET_ACCESS_KEY`] ?? source.AWS_SECRET_ACCESS_KEY;
    this.sessionToken = source[`${prefix}_SESSION_TOKEN`] ?? source.AWS_SESSION_TOKEN;
    this.region = source[`${prefix}_REGION`] ?? source.AWS_REGION;
    this.allowRootVolumeReplacement = replacementEnabled(source, prefix);
    this.endpoints = {
      ec2: provider.api_base_url ?? source[`${prefix}_EC2_ENDPOINT`] ?? source.AWS_EC2_ENDPOINT ?? null,
      monitoring: source[`${prefix}_CLOUDWATCH_ENDPOINT`] ?? source.AWS_CLOUDWATCH_ENDPOINT ?? null,
      'ec2-instance-connect': source[`${prefix}_INSTANCE_CONNECT_ENDPOINT`] ?? source.AWS_INSTANCE_CONNECT_ENDPOINT ?? null,
    };
    this.clients = {};
  }

  /**
   * EC2 signs with the access key pair; without one there is nothing to sign with, so the adapter
   * reports a configuration error instead of issuing an anonymous request AWS would reject.
   */
  configured() {
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'AWS access key id and secret access key must be configured server-side',
        false,
      );
    }
    if (!this.region) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'AWS region is not configured', false);
    }
    return this.region;
  }

  client(service) {
    const region = this.configured();
    if (this.clients[service]) return this.clients[service];
    const configuredEndpoint = this.endpoints[service];
    this.clients[service] = new AwsQueryClient({
      service,
      region,
      endpoint: configuredEndpoint
        ? requireSecureBaseUrl('AWS', configuredEndpoint)
        : endpointFor(service, region),
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        ...(this.sessionToken ? { sessionToken: this.sessionToken } : {}),
      },
      transport: this.transport,
    });
    return this.clients[service];
  }

  requireRootVolumeReplacement() {
    if (!this.allowRootVolumeReplacement) {
      throw new ProviderError(
        'UNSUPPORTED_OPERATION',
        'Replacement-instance and root-volume-restore workflows are disabled; set '
          + 'AWS_ALLOW_ROOT_VOLUME_REPLACEMENT=true (or the provider prefix equivalent) to enable them',
        false,
      );
    }
  }

  /** An EC2 plan naming a different region than the provider is configured for would silently deploy elsewhere. */
  requireConfiguredRegion(regionCode) {
    const configuredRegion = this.configured();
    if (regionCode && regionCode !== configuredRegion) {
      throw new ProviderError(
        'INVALID_CONFIGURATION',
        `EC2 plan region ${regionCode} does not match this provider's configured region ${configuredRegion}`,
        false,
      );
    }
  }

  async validateConfiguration() {
    const region = this.configured();
    await this.client('ec2').call('DescribeRegions', { RegionNames: [region] });
  }

  async createServer(input) {
    this.requireConfiguredRegion(input.regionCode);
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    const instanceType = asString(input.planMetadata?.providerServerType)
      ?? asString(input.planMetadata?.instanceType);
    const imageId = input.image?.providerImageId ?? input.image?.provider_image_id
      ?? input.image?.providerTemplateId ?? input.image?.provider_template_id;
    const keyName = asString(input.planMetadata?.awsKeyName) ?? asString(input.planMetadata?.keyName);

    if (!instanceType) {
      throw new ProviderError('INVALID_CONFIGURATION', 'AWS plan requires providerServerType (EC2 instance type)', false);
    }
    if (!imageId) {
      throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no AWS AMI identifier', false);
    }
    if ((input.sshPublicKeys ?? []).length > 0 && !keyName) {
      throw new ProviderError(
        'INVALID_CONFIGURATION',
        'AWS cannot inject supplied SSH keys without an existing awsKeyName in plan metadata',
        false,
      );
    }

    const document = await this.client('ec2').call('RunInstances', {
      ImageId: imageId,
      InstanceType: instanceType,
      MinCount: 1,
      MaxCount: 1,
      // EC2 is idempotent for a repeated RunInstances with the same token in a short window; the
      // tag lookup below is what covers the rest of the window.
      ClientToken: input.idempotencyKey,
      UserData: Buffer.from(String(input.userData ?? ''), 'utf8').toString('base64'),
      ...(keyName ? { KeyName: keyName } : {}),
      TagSpecifications: [{
        ResourceType: 'instance',
        Tags: [
          { Key: 'Name', Value: input.name },
          { Key: IDEMPOTENCY_TAG, Value: input.idempotencyKey },
        ],
      }],
    });
    const created = wrappedItems(root(document), 'instancesSet')[0];
    if (!created) {
      throw new ProviderError('PROVIDER_ERROR', 'AWS returned no instance for RunInstances', true);
    }
    return toServer(normalizeInstance(created));
  }

  provisionServer(input) { return this.createServer(input); }

  async findServerByIdempotencyKey(idempotencyKey) {
    const document = await this.client('ec2').call('DescribeInstances', {
      Filters: [{ Name: `tag:${IDEMPOTENCY_TAG}`, Values: [idempotencyKey] }],
    });
    const instance = instancesOf(document)[0];
    return instance ? toServer(instance) : null;
  }

  async getServerStatus(providerServerId) {
    const document = await this.client('ec2').call('DescribeInstances', { InstanceIds: [providerServerId] });
    const instance = instancesOf(document)[0];
    if (!instance) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'AWS instance was not found', false);
    }
    return toServer(instance);
  }

  getServer(providerServerId) { return this.getServerStatus(providerServerId); }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async deleteServer(providerServerId) {
    await this.client('ec2').call('TerminateInstances', { InstanceIds: [providerServerId] });
  }

  async rebootServer(providerServerId) {
    await this.client('ec2').call('RebootInstances', { InstanceIds: [providerServerId] });
  }

  async shutdownServer(providerServerId) {
    await this.client('ec2').call('StopInstances', { InstanceIds: [providerServerId] });
  }

  async startServer(providerServerId) {
    await this.client('ec2').call('StartInstances', { InstanceIds: [providerServerId] });
  }

  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId, planMetadata) {
    const instanceType = asString(planMetadata?.providerServerType) ?? asString(planMetadata?.instanceType);
    if (!instanceType) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Target EC2 instance type is missing', false);
    }
    await this.client('ec2').call('ModifyInstanceAttribute', {
      InstanceId: providerServerId,
      InstanceType: { Value: instanceType },
    });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId, description) {
    const server = await this.getServerStatus(providerServerId);
    const volumeId = asString(server.metadata.rootVolumeId);
    if (!volumeId) {
      throw new ProviderError('UNSUPPORTED_OPERATION', 'AWS instance has no discoverable root EBS volume', false);
    }
    const document = await this.client('ec2').call('CreateSnapshot', { VolumeId: volumeId, Description: description });
    const snapshot = snapshotOf(root(document));
    return {
      id: snapshot?.SnapshotId ?? null,
      state: snapshot?.State ?? null,
      volumeId,
      description: snapshot?.Description ?? description,
    };
  }

  async deleteSnapshot(_providerServerId, snapshotId) {
    if (!snapshotId) {
      throw new ProviderError('INVALID_CONFIGURATION', 'A snapshot id is required to delete a snapshot', false);
    }
    await this.client('ec2').call('DeleteSnapshot', { SnapshotId: snapshotId });
  }

  /**
   * Restoring a root volume: create a new volume from the snapshot in the instance's own availability
   * zone, stop the instance, detach the old root volume, attach the new one, start it again if it was
   * running. This is why the workflow is gated behind explicit operator enablement.
   */
  async restoreSnapshot(providerServerId, snapshotId) {
    this.requireRootVolumeReplacement();
    if (!snapshotId) {
      throw new ProviderError('INVALID_CONFIGURATION', 'A snapshot id is required to restore a root volume', false);
    }
    const instances = instancesOf(await this.client('ec2').call('DescribeInstances', { InstanceIds: [providerServerId] }));
    const instance = instances[0];
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
    const snapshots = wrappedItems(root(await this.client('ec2').call('DescribeSnapshots', { SnapshotIds: [snapshotId] })), 'snapshotSet');
    const snapshot = snapshotOf(snapshots[0]);
    if (!snapshot?.SnapshotId) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'The requested EBS snapshot was not found', false);
    }
    if (snapshot.State !== 'completed') {
      throw new ProviderError(
        'IMAGE_UNAVAILABLE',
        `The snapshot is not ready to restore (state ${snapshot.State ?? 'unknown'})`,
        true,
      );
    }
    const created = root(await this.client('ec2').call('CreateVolume', {
      SnapshotId: snapshotId,
      AvailabilityZone: availabilityZone,
      VolumeType: 'gp3',
    }));
    const newVolumeId = childTextCI(created, 'volumeId');
    if (!newVolumeId) {
      throw new ProviderError('PROVIDER_ERROR', 'AWS returned no volume for CreateVolume', true);
    }
    const oldVolumeId = rootVolumeId(instance);
    await this.client('ec2').call('StopInstances', { InstanceIds: [providerServerId] });
    if (oldVolumeId) {
      await this.client('ec2').call('DetachVolume', { VolumeId: oldVolumeId, InstanceId: providerServerId, Force: false });
    }
    await this.client('ec2').call('AttachVolume', { VolumeId: newVolumeId, InstanceId: providerServerId, Device: deviceName });
    if (state === 'running') {
      await this.client('ec2').call('StartInstances', { InstanceIds: [providerServerId] });
    }
  }

  /**
   * EC2 has no rebuild call. Reinstalling means launching a replacement instance from the new AMI and
   * stopping the old one; the returned server carries the replacement provenance in its metadata.
   */
  async reinstallServer(input) {
    this.requireRootVolumeReplacement();
    const imageId = input.image?.providerImageId ?? input.image?.provider_image_id
      ?? input.image?.providerTemplateId ?? input.image?.provider_template_id;
    if (!imageId) {
      throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no AWS AMI identifier', false);
    }
    const instances = instancesOf(await this.client('ec2').call('DescribeInstances', { InstanceIds: [input.providerServerId] }));
    const instance = instances[0];
    if (!instance) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'AWS instance was not found', false);
    }
    const launch = buildReplacementLaunch(instance, {
      imageId,
      name: input.hostname || (instance.Tags ?? []).find((tag) => tag.Key === 'Name')?.Value || input.providerServerId,
      idempotencyKey: input.idempotencyKey,
      userData: input.userData,
      confirm: true,
    });
    const created = root(await this.client('ec2').call('RunInstances', launch));
    const replacement = wrappedItems(created, 'instancesSet')[0];
    if (!replacement) {
      throw new ProviderError('PROVIDER_ERROR', 'AWS returned no instance for the replacement launch', true);
    }
    await this.client('ec2').call('StopInstances', { InstanceIds: [input.providerServerId] });
    const server = toServer(normalizeInstance(replacement));
    return {
      ...server,
      metadata: {
        ...server.metadata,
        replacement: {
          previousServerId: input.providerServerId,
          previousState: instance.State?.Name ?? 'unknown',
          previousAction: 'stopped',
          workflow: 'replacement-instance',
        },
      },
    };
  }

  async getAvailableImages() {
    const document = await this.client('ec2').call('DescribeImages', {
      Owners: ['self', 'amazon'],
      Filters: [{ Name: 'state', Values: ['available'] }],
    });
    return imagesOf(document);
  }

  async getImage(image) {
    const imageId = image?.providerImageId ?? image?.provider_image_id
      ?? image?.providerTemplateId ?? image?.provider_template_id;
    if (!imageId) return null;
    const document = await this.client('ec2').call('DescribeImages', { ImageIds: [imageId] });
    return imagesOf(document)[0] ?? null;
  }

  /** EC2 has no rescue mode: the audited original refuses, and so does this build. */
  async enableRescue() {
    return unsupportedRescue('aws');
  }

  async disableRescue() {
    throw new ProviderError('UNSUPPORTED_OPERATION', 'AWS EC2 rescue mode is not supported', false);
  }

  /**
   * The console is the EC2 Serial Console: a public key pushed through EC2 Instance Connect, valid for
   * 60 seconds, one session per instance, Nitro instance types only — all three conditions come from
   * AWS's documentation and are reported by the client when AWS refuses them.
   */
  async getConsole(providerServerId) {
    const region = this.configured();
    const keyPair = generateSerialConsoleKeyPair();
    const document = await this.client('ec2-instance-connect').call('SendSerialConsoleSSHPublicKey', {
      InstanceId: providerServerId,
      SerialPort: 0,
      SSHPublicKey: keyPair.publicKey,
    });
    if (childTextCI(root(document), 'success') !== 'true') {
      throw new ProviderError('PROVIDER_ERROR', 'AWS did not accept the serial console public key', false);
    }
    return {
      type: 'ec2-serial-console-ssh',
      username: `${providerServerId}.port0`,
      privateKey: keyPair.privateKey,
      expiresAt: new Date(Date.now() + SERIAL_CONSOLE_KEY_TTL_MS).toISOString(),
      notes: 'Save the private key to a file (chmod 600) and connect within 60 seconds: '
        + `${serialConsoleCommand(providerServerId, region)}. AWS removes the key after 60 seconds and `
        + 'allows one serial console session per instance; the console itself then asks for a local '
        + 'operating-system user and password.',
    };
  }

  /**
   * CloudWatch's EC2 metrics, over the last hour at five-minute resolution. A metric the instance has
   * not reported is named in `missing` rather than being invented as zero.
   */
  async getServerMetrics(providerServerId) {
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
    ];

    const metrics = {};
    const missing = [];

    for (const metricName of metricNames) {
      const document = await this.client('monitoring').call('GetMetricStatistics', {
        Namespace: 'AWS/EC2',
        MetricName: metricName,
        Dimensions: [{ Name: 'InstanceId', Value: providerServerId }],
        StartTime: from,
        EndTime: to,
        Period: 300,
        Statistics: ['Average', 'Maximum'],
      });
      const result = childCI(root(document), 'GetMetricStatisticsResult');
      const points = wrappedItemsCI(result, 'Datapoints', 'member').map((point) => ({
        Average: metricNumber(childTextCI(point, 'average')),
        Maximum: metricNumber(childTextCI(point, 'maximum')),
        Unit: childTextCI(point, 'unit'),
      }));
      if (points.length === 0) {
        missing.push(metricName);
        continue;
      }
      const averages = points.map((point) => point.Average).filter((value) => Number.isFinite(value));
      const maxima = points.map((point) => point.Maximum).filter((value) => Number.isFinite(value));
      metrics[metricName] = {
        unit: points[0].Unit ?? null,
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

  async healthCheck(providerServerId, expectedImage) {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage?.providerImageId ?? expectedImage?.provider_image_id
        ?? expectedImage?.providerTemplateId ?? expectedImage?.provider_template_id;
      return {
        exists: true,
        poweredOn: server.status === 'running',
        ipAddress: server.ipAddress,
        imageMatches: !expected || server.imageId === expected,
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

module.exports = {
  AwsProviderAdapter,
  IDEMPOTENCY_TAG,
  normalizeInstance,
  instancesOf,
  imagesOf,
  snapshotOf,
  rootVolumeId,
  toServer,
};
