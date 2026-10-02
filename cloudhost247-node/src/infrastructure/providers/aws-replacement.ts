import type { Instance } from '@aws-sdk/client-ec2';
import { ProviderError, asString } from './types';

/**
 * Pure helpers for the two EC2 workflows that cannot be done in place.
 *
 * EC2 has no "reinstall this instance" call: a reinstall is a replacement
 * instance launched from the target AMI, and restoring a root volume from a
 * snapshot is a new instance whose root device is backed by that snapshot.
 * Both are destructive-looking operations, so the request is built here as a
 * plain object that can be asserted in a unit test without an AWS client — and
 * every guard lives in one place rather than being spread through the adapter.
 *
 * The old instance is never terminated by either workflow. A replacement
 * launch always carries `cloudhost247:replacement-for`, so an operator can see
 * which instance supersedes which, and the previous instance is stopped (not
 * deleted) so its volumes remain available for recovery.
 */

export interface ReplacementLaunchOptions {
  /** Target AMI for a reinstall. Exactly one of imageId/snapshotId is required. */
  imageId?: string | null;
  /** Snapshot to boot the replacement root volume from. */
  snapshotId?: string | null;
  name: string;
  idempotencyKey: string;
  userData: string;
  instanceType?: string | null;
  keyName?: string | null;
  /** Root volume type for a snapshot-backed launch. */
  volumeType?: string | null;
  /** Must be true: the caller is asserting the replacement was requested explicitly. */
  confirm: boolean;
}

/** The device name AWS expects for the root volume of a replacement launch. */
export function rootDeviceName(source: Instance): string | null {
  const rootDevice = source.RootDeviceName;
  if (rootDevice) return rootDevice;
  const mapping = source.BlockDeviceMappings?.find((entry) => entry.Ebs?.VolumeId);
  return mapping?.DeviceName ?? null;
}

export function replacementTags(source: Instance, name: string, idempotencyKey: string): Array<{ Key: string; Value: string }> {
  const tags = [
    { Key: 'Name', Value: name },
    { Key: 'cloudhost247:idempotency', Value: idempotencyKey },
    { Key: 'cloudhost247:replacement-for', Value: source.InstanceId ?? 'unknown' },
  ];
  for (const tag of source.Tags ?? []) {
    // Carry ownership/accounting tags forward, but never the previous
    // idempotency key: two instances must not answer the same lookup.
    if (!tag.Key || tag.Key === 'Name' || tag.Key === 'cloudhost247:idempotency') continue;
    if (tags.some((existing) => existing.Key === tag.Key)) continue;
    tags.push({ Key: tag.Key, Value: tag.Value ?? '' });
  }
  return tags;
}

/**
 * Build the RunInstances input for a replacement instance in the same
 * availability zone, subnet and security groups as the source.
 */
export function buildReplacementLaunch(source: Instance, options: ReplacementLaunchOptions): Record<string, unknown> {
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

  const launch: Record<string, unknown> = {
    MinCount: 1,
    MaxCount: 1,
    InstanceType: instanceType,
    ClientToken: options.idempotencyKey,
    UserData: Buffer.from(options.userData).toString('base64'),
    Placement: { AvailabilityZone: availabilityZone },
    TagSpecifications: [{ ResourceType: 'instance', Tags: replacementTags(source, options.name, options.idempotencyKey) }],
  };
  if (source.SubnetId) launch.SubnetId = source.SubnetId;
  const securityGroupIds = (source.SecurityGroups ?? [])
    .map((group) => group.GroupId)
    .filter((groupId): groupId is string => Boolean(groupId));
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

/** The instance state a replacement may start from. */
export function replacementSourceState(state: string | undefined): 'running' | 'stopped' | null {
  const normalised = (state ?? '').toLowerCase();
  return normalised === 'running' || normalised === 'stopped' ? normalised : null;
}

/** Read the opt-in flag that gates the replacement workflows. */
export function replacementEnabled(source: NodeJS.ProcessEnv, prefix: string): boolean {
  const raw = asString(source[`${prefix}_ALLOW_ROOT_VOLUME_REPLACEMENT`]);
  return raw !== null && /^(1|true|yes|on)$/i.test(raw);
}
