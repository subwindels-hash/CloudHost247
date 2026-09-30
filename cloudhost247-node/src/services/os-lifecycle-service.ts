/**
 * Operating-system version lifecycle (spec §6, §10).
 *
 * A distribution release moves ACTIVE → MAINTENANCE → EOL_WARNING → EOL → ARCHIVED. The
 * transition is driven by the operator-entered `end_of_life_date`, never by guesswork, and it
 * only ever changes *catalog* rows:
 *
 *  - servers already running the version are untouched and keep working; their dashboard simply
 *    gains a lifecycle notice,
 *  - EOL and ARCHIVED versions disappear from ordering and reinstall because every public query
 *    already restricts selection to ACTIVE / MAINTENANCE / EOL_WARNING,
 *  - a version is only ARCHIVED once no server references it any more, so history is never lost
 *    and no customer record points at a vanished row,
 *  - affected customers are notified once per server and transition (the notification unique
 *    index makes the sweep safe to run repeatedly).
 *
 * Nothing here deletes data, and MAINTENANCE remains a manual operator decision.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { recordAuditBestEffort } from '../lib/audit';

/** Statuses of servers that no longer exist for the customer and need no EOL warning. */
const INACTIVE_SERVER_STATUSES = ['retired', 'deleting'];

export interface OsLifecycleOptions {
  /** How many days before end of life a version enters EOL_WARNING. Default 90. */
  warningDays?: number;
  /** How long a version stays EOL before it may be archived (only when unused). Default 180. */
  archiveAfterDays?: number;
  now?: Date;
}

export interface OsLifecycleTransition {
  versionId: string;
  displayName: string;
  from: string;
  to: string;
  endOfLifeDate: string | null;
  notifiedServers: number;
}

interface VersionRow {
  id: string;
  display_name: string;
  end_of_life_date: string | null;
  previous_status: string;
}

async function notifyAffectedCustomers(
  db: Queryable,
  version: VersionRow,
  to: 'EOL_WARNING' | 'EOL'
): Promise<number> {
  const { rows } = await db.query<{ id: string; customer_id: string; name: string }>(
    `SELECT id,customer_id,name FROM servers
     WHERE operating_system_version_id=$1 AND status <> ALL($2::text[])`,
    [version.id, INACTIVE_SERVER_STATUSES]
  );
  const deadline = version.end_of_life_date ?? 'the published end-of-life date';
  const title = to === 'EOL_WARNING'
    ? `${version.display_name} is approaching end of life`
    : `${version.display_name} has reached end of life`;
  let notified = 0;
  for (const server of rows) {
    const message = [
      `Server: ${server.name}`,
      `Operating system: ${version.display_name}`,
      to === 'EOL_WARNING'
        ? `End of life: ${deadline}. Your server keeps running, but this version will stop receiving vendor security updates.`
        : `End of life: ${deadline}. Your server keeps running, but this version no longer receives vendor security updates.`,
      'Reinstall the server with a supported version from your dashboard when you are ready. Reinstalling erases all data on the server.',
    ].join('\n');
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO user_notifications (id,user_id,type,title,message,resource_type,resource_id)
       VALUES ($1,$2,$3,$4,$5,'server',$6)
       ON CONFLICT (user_id,type,resource_type,resource_id) WHERE resource_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [randomUUID(), server.customer_id, `OS_${to}`, title, message, server.id]
    );
    if (inserted.rows[0]) notified += 1;
  }
  return notified;
}

async function transition(
  db: Queryable,
  rows: VersionRow[],
  to: 'EOL_WARNING' | 'EOL' | 'ARCHIVED'
): Promise<OsLifecycleTransition[]> {
  const results: OsLifecycleTransition[] = [];
  for (const row of rows) {
    const notifiedServers = to === 'ARCHIVED' ? 0 : await notifyAffectedCustomers(db, row, to);
    await recordAuditBestEffort(db, {
      actorId: null,
      action: `OS_VERSION_${to}`,
      resourceType: 'operating_system_version',
      resourceId: row.id,
      metadata: {
        from: row.previous_status,
        to,
        endOfLifeDate: row.end_of_life_date,
        notifiedServers,
        source: 'os-lifecycle-sweep',
      },
    });
    results.push({
      versionId: row.id,
      displayName: row.display_name,
      from: row.previous_status,
      to,
      endOfLifeDate: row.end_of_life_date,
      notifiedServers,
    });
  }
  return results;
}

/**
 * Advances every version whose operator-entered end-of-life date has come due. Idempotent: a
 * second run finds nothing to change and creates no duplicate notification.
 */
export async function sweepOperatingSystemLifecycle(
  db: Queryable,
  options: OsLifecycleOptions = {}
): Promise<OsLifecycleTransition[]> {
  const warningDays = options.warningDays ?? 90;
  const archiveAfterDays = options.archiveAfterDays ?? 180;
  const now = (options.now ?? new Date()).toISOString().slice(0, 10);

  // Past end of life: no longer selectable for new deployments or reinstalls.
  const expired = await db.query<VersionRow>(
    `UPDATE operating_system_versions v SET status='EOL',updated_at=now()
     FROM (SELECT id,status FROM operating_system_versions
           WHERE status IN ('ACTIVE','MAINTENANCE','EOL_WARNING')
             AND end_of_life_date IS NOT NULL AND end_of_life_date <= $1::date
           FOR UPDATE) prev
     WHERE v.id=prev.id
     RETURNING v.id,v.display_name,v.end_of_life_date,prev.status previous_status`,
    [now]
  );

  // Approaching end of life: still selectable, but customers are warned.
  const warning = await db.query<VersionRow>(
    `UPDATE operating_system_versions v SET status='EOL_WARNING',updated_at=now()
     FROM (SELECT id,status FROM operating_system_versions
           WHERE status IN ('ACTIVE','MAINTENANCE')
             AND end_of_life_date IS NOT NULL
             AND end_of_life_date > $1::date
             AND end_of_life_date <= $1::date + ($2::int * INTERVAL '1 day')
           FOR UPDATE) prev
     WHERE v.id=prev.id
     RETURNING v.id,v.display_name,v.end_of_life_date,prev.status previous_status`,
    [now, warningDays]
  );

  // Long past end of life and unused by any server: archive so the catalog stays readable.
  const archived = await db.query<VersionRow>(
    `UPDATE operating_system_versions v SET status='ARCHIVED',updated_at=now()
     FROM (SELECT id,status FROM operating_system_versions ov
           WHERE ov.status='EOL'
             AND ov.end_of_life_date IS NOT NULL
             AND ov.end_of_life_date <= $1::date - ($2::int * INTERVAL '1 day')
             AND NOT EXISTS (SELECT 1 FROM servers s WHERE s.operating_system_version_id=ov.id)
           FOR UPDATE) prev
     WHERE v.id=prev.id
     RETURNING v.id,v.display_name,v.end_of_life_date,prev.status previous_status`,
    [now, archiveAfterDays]
  );

  return [
    ...(await transition(db, expired.rows, 'EOL')),
    ...(await transition(db, warning.rows, 'EOL_WARNING')),
    ...(await transition(db, archived.rows, 'ARCHIVED')),
  ];
}
