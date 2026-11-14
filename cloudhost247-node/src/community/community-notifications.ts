import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { createNotification } from '../services/notification-service';

/**
 * Community notifications ride on the platform's existing notification pipeline: the same
 * `user_notifications` table, the same `/api/v1/account/notifications` feed, the same outbox and the
 * same bell in the header. There is no second inbox.
 *
 * The one thing the community adds is a per-member, per-type delivery choice. Community activity is
 * not a billing event, so **e-mail is off unless the member turns it on**: a reply in a thread must
 * never arrive as unsolicited mail. When e-mail is off the row is written directly (in-app only),
 * and only a member who opted in reaches `createNotification`, which queues the outbox copy. That
 * keeps the existing "one insert = one e-mail" guarantee intact and never sends both.
 */

export const COMMUNITY_NOTIFICATION_TYPES = [
  'COMMUNITY_REPLY',
  'COMMUNITY_MENTION',
  'COMMUNITY_REACTION',
  'COMMUNITY_SOLUTION_ACCEPTED',
  'COMMUNITY_SOLUTION_VERIFIED',
  'COMMUNITY_MODERATION',
  'COMMUNITY_ANNOUNCEMENT',
] as const;

export type CommunityNotificationType = (typeof COMMUNITY_NOTIFICATION_TYPES)[number];

export interface NotificationPreference {
  type: CommunityNotificationType;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
  /** True when the stored defaults still apply (the member has never changed this row). */
  isDefault: boolean;
}

interface PreferenceLabels {
  label: string;
  description: string;
  emailDefault?: boolean;
}

const PREFERENCE_LABELS: Record<CommunityNotificationType, PreferenceLabels> = {
  COMMUNITY_REPLY: {
    label: 'Replies to my discussions',
    description: 'Someone answers a discussion you started.',
  },
  COMMUNITY_MENTION: {
    label: 'Mentions',
    description: 'Someone writes @yourname in a post.',
  },
  COMMUNITY_REACTION: {
    label: 'Reactions',
    description: 'Someone reacts to your discussion or reply.',
  },
  COMMUNITY_SOLUTION_ACCEPTED: {
    label: 'My answer was accepted',
    description: 'An author marks your reply as the solution to their question.',
  },
  COMMUNITY_SOLUTION_VERIFIED: {
    label: 'Answer verified for the knowledge base',
    description: 'A moderator approved an answer of yours for the AI support knowledge base.',
    emailDefault: false,
  },
  COMMUNITY_MODERATION: {
    label: 'Moderation',
    description: 'A moderator acts on your content or your posting access.',
  },
  COMMUNITY_ANNOUNCEMENT: {
    label: 'Official announcements',
    description: 'CloudHost247 posts an announcement in the community.',
  },
};

export function isCommunityNotificationType(value: string): value is CommunityNotificationType {
  return (COMMUNITY_NOTIFICATION_TYPES as readonly string[]).includes(value);
}

interface PreferenceRow {
  notification_type: string;
  in_app: boolean;
  email: boolean;
}

/** Delivery choice for one type: a stored row wins, otherwise the documented default applies. */
export async function getDeliveryChoice(
  db: Queryable,
  userId: string,
  type: CommunityNotificationType
): Promise<{ inApp: boolean; email: boolean; isDefault: boolean }> {
  const { rows } = await db.query<PreferenceRow>(
    `SELECT notification_type, in_app, email FROM community_notification_preferences
      WHERE user_id = $1 AND notification_type = $2 LIMIT 1`,
    [userId, type]
  );
  const row = rows[0];
  if (!row) {
    return { inApp: true, email: PREFERENCE_LABELS[type].emailDefault === true, isDefault: true };
  }
  return { inApp: row.in_app, email: row.email, isDefault: false };
}

export async function listPreferences(db: Queryable, userId: string): Promise<NotificationPreference[]> {
  const { rows } = await db.query<PreferenceRow>(
    `SELECT notification_type, in_app, email FROM community_notification_preferences WHERE user_id = $1`,
    [userId]
  );
  const stored = new Map(rows.map((row) => [row.notification_type, row]));
  return COMMUNITY_NOTIFICATION_TYPES.map((type) => {
    const row = stored.get(type);
    const meta = PREFERENCE_LABELS[type];
    return {
      type,
      label: meta.label,
      description: meta.description,
      inApp: row ? row.in_app : true,
      email: row ? row.email : meta.emailDefault === true,
      isDefault: !row,
    };
  });
}

export async function setPreference(
  db: Queryable,
  userId: string,
  type: CommunityNotificationType,
  choice: { inApp: boolean; email: boolean }
): Promise<void> {
  await db.query(
    `INSERT INTO community_notification_preferences (user_id, notification_type, in_app, email, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (user_id, notification_type)
     DO UPDATE SET in_app = EXCLUDED.in_app, email = EXCLUDED.email, updated_at = now()`,
    [userId, type, choice.inApp, choice.email]
  );
}

export interface CommunityNotificationInput {
  userId: string;
  type: CommunityNotificationType;
  title: string;
  message: string;
  resourceType?: string | null;
  resourceId?: string | null;
  /** The member who caused it — they are never notified about their own action. */
  actorId?: string | null;
}

/**
 * Delivers one community notification according to the recipient's choice. Returns the notification
 * id when a row was created, null when the member switched this type off or is the actor.
 */
export async function notifyCommunity(
  db: Queryable,
  input: CommunityNotificationInput
): Promise<string | null> {
  if (input.actorId && input.actorId === input.userId) return null;
  if (input.resourceId) {
    // A member who can no longer see the item must not keep receiving notifications for it.
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE id = $1 AND status = $2 LIMIT 1', [
      input.userId,
      'active',
    ]);
    if (!rows[0]) return null;
  }
  const choice = await getDeliveryChoice(db, input.userId, input.type);
  if (!choice.inApp && !choice.email) return null;

  if (choice.email) {
    return createNotification(db, {
      userId: input.userId,
      type: input.type,
      title: input.title.slice(0, 255),
      message: input.message,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
    });
  }

  const id = randomUUID();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO user_notifications (id, user_id, type, title, message, resource_type, resource_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, type, resource_type, resource_id) WHERE resource_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      id,
      input.userId,
      input.type,
      input.title.slice(0, 255),
      input.message,
      input.resourceType ?? null,
      input.resourceId ?? null,
    ]
  );
  return rows[0]?.id ?? null;
}
