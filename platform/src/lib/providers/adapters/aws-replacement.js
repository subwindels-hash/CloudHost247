/**
 * EC2 instance replacement and root-volume restore.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/aws-replacement.ts. The original took an
 * SDK `Instance`; this build passes the same shape, produced by the adapter from the XML document
 * (see ../aws-xml.js), so the logic is unchanged.
 *
 * These are the only two EC2 operations that can destroy a customer's instance, so they are off
 * unless an operator turns them on with `<PREFIX>_ALLOW_ROOT_VOLUME_REPLACEMENT=true`, and the launch
 * plan refuses to build unless the caller passes `confirm: true`.
 */
'use strict';

const { ProviderError, asString } = require('../types');

function rootDeviceName(source) {
  if (source.RootDeviceName) return source.RootDeviceName;
  const mapping = (source.BlockDeviceMappings ?? []).find((entry) => entry.Ebs?.VolumeId);
  return mapping?.DeviceName ?? null;
}

/**
 * A replacement keeps the source's identity tags and copies every other tag across, except the
 * idempotency tag (the replacement is a new resource under a new job key) and Name (which the caller
 * supplies).
 */
function replacementTags(source, name, idempotencyKey) {
  const tags = [
    { Key: 'Name', Value: name },
    { Key: 'cloudhost247:idempotency', Value: idempotencyKey },
    { Key: 'cloudhost247:replacement-for', Value: source.InstanceId ?? 'unknown' },
  ];
  for (const tag of source.Tags ?? []) {
    if (!tag.Key || tag.Key === 'Name' || tag.Key === 'cloudhost247:idempotency') continue;
    if (tags.some((existing) => existing.Key === tag.Key)) continue;
    tags.push({ Key: tag.Key, Value: tag.Value ?? '' });
  }
  return tags;
}

/**
 * Builds the RunInstances parameters for a replacement. Exactly one root device source is required:
 * an AMI, or a snapshot of the source's root volume.
 */
function buildReplacementLaunch(source, options) {
  if (!options.confirm) {
    throw new ProviderError(
      'INVALID_CONFIGURATION',
      'A replacement instance is destructive: pass confirm=true after explicit operator confirmation',
      false,
    );
  }
  const sourceId = source.InstanceId;
  if (!sourceId) {
    throw new ProviderError('RESOURCE_NOT_FOUND', 'AWS returned no source instance to replace', false);
  }
  const hasImage = Boolean(options.imageId);
  const hasSnapshot = Boolean(options.snapshotId);
  if (hasImage === hasSnapshot) {
    throw new ProviderError(
      'INVALID_CONFIGURATION',
      'A replacement instance requires exactly one of an AMI or a snapshot for its root device',
      false,
    );
  }
  const availabilityZone = source.Placement?.AvailabilityZone;
  if (!availabilityZone) {
    throw new ProviderError(
      'INVALID_CONFIGURATION',
      'The source instance has no availability zone, so a replacement cannot be placed predictably',
      false,
    );
  }
  const instanceType = options.instanceType ?? source.InstanceType ?? null;
  if (!instanceType) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Target EC2 instance type is missing', false);
  }
  const keyName = options.keyName ?? source.KeyName ?? null;

  const launch = {
    MinCount: 1,
    MaxCount: 1,
    InstanceType: instanceType,
    ClientToken: options.idempotencyKey,
    UserData: Buffer.from(String(options.userData ?? ''), 'utf8').toString('base64'),
    Placement: { AvailabilityZone: availabilityZone },
    TagSpecifications: [{ ResourceType: 'instance', Tags: replacementTags(source, options.name, options.idempotencyKey) }],
  };
  if (source.SubnetId) launch.SubnetId = source.SubnetId;
  const securityGroupIds = (source.SecurityGroups ?? [])
    .map((group) => group.GroupId)
    .filter((groupId) => Boolean(groupId));
  if (securityGroupIds.length) launch.SecurityGroupIds = securityGroupIds;
  if (keyName) launch.KeyName = keyName;

  if (hasSnapshot) {
    const deviceName = rootDeviceName(source);
    if (!deviceName) {
      throw new ProviderError(
        'UNSUPPORTED_OPERATION',
        'The source instance has no discoverable root device name for a snapshot-backed launch',
        false,
      );
    }
    launch.BlockDeviceMappings = [{
      DeviceName: deviceName,
      Ebs: {
        SnapshotId: options.snapshotId,
        ...(options.volumeType ? { VolumeType: options.volumeType } : {}),
      },
    }];
  } else {
    launch.ImageId = options.imageId;
  }

  return launch;
}

/** A root volume can only be swapped while the instance is running or stopped. */
function replacementSourceState(state) {
  const normalised = String(state ?? '').toLowerCase();
  return normalised === 'running' || normalised === 'stopped' ? normalised : null;
}

/** Off by default: the environment variable must be set — and set truthy — to enable the workflows. */
function replacementEnabled(source, prefix) {
  const raw = asString(source[`${prefix}_ALLOW_ROOT_VOLUME_REPLACEMENT`]);
  return raw !== null && /^(1|true|yes|on)$/i.test(raw);
}

module.exports = {
  rootDeviceName,
  replacementTags,
  buildReplacementLaunch,
  replacementSourceState,
  replacementEnabled,
};
