import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import { getControlPanelAdapter } from '../control-panels/registry';

export interface FirewallRuleRow {
  id: string;
  server_id: string;
  protocol: 'tcp' | 'udp' | 'icmp' | 'any';
  port_range_start: number;
  port_range_end: number;
  direction: 'INBOUND' | 'OUTBOUND';
  source_cidr: string;
  action: 'ALLOW' | 'DROP' | 'REJECT';
  description: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'APPLYING' | 'FAILED';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateFirewallRuleInput {
  serverId: string;
  protocol?: 'tcp' | 'udp' | 'icmp' | 'any';
  portRangeStart: number;
  portRangeEnd?: number;
  direction?: 'INBOUND' | 'OUTBOUND';
  sourceCidr?: string;
  action?: 'ALLOW' | 'DROP' | 'REJECT';
  description?: string | null;
  status?: 'ACTIVE' | 'DISABLED' | 'APPLYING' | 'FAILED';
}

export async function listFirewallRulesForServer(db: Queryable, serverId: string): Promise<FirewallRuleRow[]> {
  const { rows } = await db.query<FirewallRuleRow>(
    `SELECT * FROM firewall_rules WHERE server_id = $1 ORDER BY direction ASC, port_range_start ASC`,
    [serverId]
  );
  return rows;
}

export async function findFirewallRuleById(db: Queryable, id: string): Promise<FirewallRuleRow | null> {
  const { rows } = await db.query<FirewallRuleRow>(
    `SELECT * FROM firewall_rules WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function createFirewallRule(
  db: Queryable,
  input: CreateFirewallRuleInput
): Promise<FirewallRuleRow> {
  const id = randomUUID();
  const protocol = input.protocol ?? 'tcp';
  const portRangeEnd = input.portRangeEnd ?? input.portRangeStart;
  const direction = input.direction ?? 'INBOUND';
  const sourceCidr = input.sourceCidr ?? '0.0.0.0/0';
  const action = input.action ?? 'ALLOW';
  const status = input.status ?? 'ACTIVE';

  const { rows } = await db.query<FirewallRuleRow>(
    `INSERT INTO firewall_rules (
      id, server_id, protocol, port_range_start, port_range_end,
      direction, source_cidr, action, description, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      id,
      input.serverId,
      protocol,
      input.portRangeStart,
      portRangeEnd,
      direction,
      sourceCidr,
      action,
      input.description ?? null,
      status,
    ]
  );
  return rows[0]!;
}

export async function deleteFirewallRule(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM firewall_rules WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

/**
 * Automatically provisions baseline security rules (SSH 22, ping/ICMP) plus all required ports
 * declared by the server's control panel adapter.
 */
export async function applyBaselineFirewallForServer(
  db: Queryable,
  serverId: string,
  controlPanelSlug?: string | null
): Promise<FirewallRuleRow[]> {
  // Always include SSH (22)
  const baseRules: CreateFirewallRuleInput[] = [
    {
      serverId,
      protocol: 'tcp',
      portRangeStart: 22,
      portRangeEnd: 22,
      description: 'SSH Remote Administration',
    },
  ];

  if (controlPanelSlug) {
    const adapter = getControlPanelAdapter(controlPanelSlug);
    if (adapter) {
      for (const rule of adapter.getRequiredFirewallPorts()) {
        baseRules.push({
          serverId,
          protocol: rule.protocol,
          portRangeStart: rule.port,
          portRangeEnd: rule.port,
          description: `${adapter.name}: ${rule.description}`,
        });
      }
    }
  }

  const created: FirewallRuleRow[] = [];
  for (const rule of baseRules) {
    created.push(await createFirewallRule(db, rule));
  }
  return created;
}
