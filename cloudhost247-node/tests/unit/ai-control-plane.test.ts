import { describe, expect, it } from 'vitest';
import { AGENT_CATALOG, BOARD_SEATS, getAgentCatalogEntry, validateCatalogIntegrity } from '../../src/ai-os/registry/agent-catalog';
import { AI_PERMISSIONS } from '../../src/ai-os/permissions';
import { TOOL_CATALOG, getToolDefinition, validateToolArguments, redactForStorage } from '../../src/ai-os/registry/tool-catalog';
import { AGENT_HANDLERS } from '../../src/ai-os/agents/handlers';
import { resolveAdminCommand, resolveCustomerMessage } from '../../src/ai-os/copilot/intents';
import { BOARD_SEAT_SLUGS, SEAT_DIGESTS } from '../../src/ai-os/board/departments';

const FORBIDDEN_LEGACY_AGENTS = ['care-navigator', 'claims-copilot', 'intake-attorney', 'citizen-desk', 'tutor', 'dispatch'];
/** Design rule (§20): a policy-gated tool runs without a human only for approvalPolicy 'automatic'.
 *  Contacting customers / changing services always goes through a human regardless of policy. */
const isGatedFor = (toolName: string, policy: string): boolean => {
  const tool = getToolDefinition(toolName);
  if (!tool || !tool.mutating) return false;
  if (tool.approval === 'always') return true;
  if (tool.approval === 'policy') return policy !== 'automatic';
  return false; // approval 'none' — append-only telemetry (record_evaluation only)
};

describe('Agent catalog integrity (§35 workforce utility catalog)', () => {
  it('contains the full workforce with unique slugs', () => {
    expect(AGENT_CATALOG.length).toBeGreaterThanOrEqual(43);
    expect(new Set(AGENT_CATALOG.map((a) => a.slug)).size).toBe(AGENT_CATALOG.length);
  });

  it('never includes legacy non-hosting agent types', () => {
    for (const slug of AGENT_CATALOG.map((a) => a.slug)) {
      expect(FORBIDDEN_LEGACY_AGENTS).not.toContain(slug);
    }
  });

  it('every agent references real tools, declared task types and known permissions', () => {
    const validTools = new Set(TOOL_CATALOG.map((t) => t.name));
    for (const agent of AGENT_CATALOG) {
      expect(agent.taskTypes.length).toBeGreaterThan(0);
      expect(agent.permissions.length).toBeGreaterThan(0);
      for (const tool of agent.tools) {
        expect(validTools.has(tool), `${agent.slug} tool ${tool}`).toBe(true);
      }
      expect(agent.description.length, agent.slug).toBeGreaterThan(20);
      expect(agent.name.length, agent.slug).toBeGreaterThan(2);
      expect(agent.modelTier).toBe('native');
      for (const p of agent.permissions) {
        expect(AI_PERMISSIONS as readonly string[], `${agent.slug} unknown permission ${p}`).toContain(p);
      }
    }
    // Every tool permission is inside the declared permission universe (no orphan tools).
    for (const t of TOOL_CATALOG) {
      expect(AI_PERMISSIONS as readonly string[], `orphan tool permission ${t.permission}`).toContain(t.permission);
    }
  });

  it('catalog self-validation reports zero integrity errors', () => {
    expect(validateCatalogIntegrity(getToolDefinition)).toEqual([]);
  });

  it('every declared task type has at least one owning agent and every handler has an owner', () => {
    const ownersByType = new Map<string, string[]>();
    for (const a of AGENT_CATALOG) {
      for (const tt of a.taskTypes) {
        ownersByType.set(tt, [...(ownersByType.get(tt) ?? []), a.slug]);
      }
    }
    const handlerKeys = Object.keys(AGENT_HANDLERS);
    expect(handlerKeys.length).toBe(ownersByType.size);
    for (const tt of handlerKeys) expect(ownersByType.has(tt), `handler for ${tt} has no catalog owner`).toBe(true);
    // Board digests intentionally run for every seat; internal requests route to the internal family.
    expect(ownersByType.get('board.department_digest')!.length).toBeGreaterThanOrEqual(9);
    for (const [tt, owners] of ownersByType) {
      if (tt === 'board.department_digest' || tt === 'internal.request') continue;
      expect(owners.length, `task type ${tt} owned by [${owners.join(', ')}]`).toBe(1);
    }
  });

  it('board composition matches §6 (CEO + 9 digest-producing seats, 10 permanent seats)', () => {
    const seats = BOARD_SEATS.map((a) => a.boardSeat).sort();
    expect(seats).toEqual(['CCO', 'CEO', 'CFO', 'CISO', 'CMO', 'COO', 'CPO', 'CRO', 'CTO', 'RISK']);
    expect(BOARD_SEAT_SLUGS.length).toBe(9);
    expect([...BOARD_SEAT_SLUGS].sort()).toEqual(Object.keys(SEAT_DIGESTS).sort());
    expect(getAgentCatalogEntry('ai-ceo')?.boardSeat).toBe('CEO');
    for (const slug of BOARD_SEAT_SLUGS) {
      const entry = getAgentCatalogEntry(slug);
      expect(entry, slug).toBeDefined();
      expect(entry!.boardSeat, slug).toBeTruthy();
      expect(entry!.boardSeat).not.toBe('CEO');
    }
  });
});

describe('Sensitive agents and hard gates (§8)', () => {
  const mutatingToolAgents = [
    'security-sentinel', 'fraud-guardian', 'provisioning-agent', 'deployment-agent',
    'resolution-pro', 'incident-commander', 'collector', 'customer-success',
  ];
  it.each(mutatingToolAgents)('%s: every mutating tool is approval-gated (never autonomous)', (slug) => {
    const agent = getAgentCatalogEntry(slug);
    expect(agent, slug).toBeDefined();
    for (const toolName of agent!.tools) {
      const tool = getToolDefinition(toolName)!;
      if (!tool.mutating) continue;
      // record_evaluation is append-only telemetry — exempt from the external-impact gate.
      if (toolName === 'record_evaluation') continue;
      expect(isGatedFor(toolName, agent!.approvalPolicy), `${slug} holds ungated mutating tool ${toolName}`).toBe(true);
    }
  });

  it('across the workforce, every mutating tool is gated — with exactly two designed exceptions', () => {
    for (const agent of AGENT_CATALOG) {
      for (const toolName of agent.tools) {
        const tool = getToolDefinition(toolName)!;
        if (!tool.mutating) continue;
        // Exception 1: record_evaluation is append-only telemetry (same class as the audit log).
        // Exception 2: create_ticket held by customer-cloud-assistant is customer-initiated
        // self-service — it creates a ticket for the caller's own account in their own workspace
        // after an explicit confirmation prompt, identical in authority to clicking
        // "Open ticket" in the dashboard (§8 remains: no staff approval asks for that).
        if (toolName === 'record_evaluation') continue;
        if (toolName === 'create_ticket' && agent.slug === 'customer-cloud-assistant') continue;
        expect(isGatedFor(toolName, agent.approvalPolicy), `${agent.slug} holds ungated mutating tool ${toolName}`).toBe(true);
      }
    }
  });

  it('external-impact tools always require a human, even under automatic agents', () => {
    // Customer-visible effects and service-state changes can never be auto-exercised.
    expect(getToolDefinition('send_notification')?.approval).toBe('always');
    expect(getToolDefinition('restart_installation')?.approval).toBe('always');
    expect(getToolDefinition('suspend_installation')?.approval).toBe('always');
    expect(getToolDefinition('set_agent_enabled')?.approval).toBe('always');
    // The only mutating tool with approval 'none' is append-only evaluation telemetry.
    for (const tool of TOOL_CATALOG) {
      if (tool.mutating && tool.approval === 'none') {
        expect(tool.name).toBe('record_evaluation');
      }
    }
  });

  it('customer-facing agents hold only scoped, customer-usable tooling', () => {
    const assistant = getAgentCatalogEntry('customer-cloud-assistant')!;
    expect(assistant).toBeDefined();
    const writes = assistant.tools.filter((t) => getToolDefinition(t)?.mutating === true);
    // One write only: opening the customer's own support ticket.
    expect(writes).toEqual(['create_ticket']);
    for (const toolName of assistant.tools) {
      expect(getToolDefinition(toolName)!.customerUsable, `${toolName} is not customer-usable`).toBe(true);
    }
  });

  it('strict-policy agents exist, are the highest-risk seats, and route any write through a human', () => {
    const strictAgents = AGENT_CATALOG.filter((a) => a.approvalPolicy === 'strict');
    expect(strictAgents.map((a) => a.slug)).toEqual(['deployment-agent', 'security-sentinel', 'fraud-guardian']);
    for (const agent of strictAgents) {
      for (const toolName of agent.tools) {
        const tool = getToolDefinition(toolName)!;
        if (tool.mutating) expect(['policy', 'always'] as const).toContain(tool.approval);
      }
    }
  });
});

describe('Copilot + assistant intent resolution', () => {
  it('knows the invoice/payment/server/ticket vocabulary of the platform', () => {
    const cases: Array<[string, string, (raw: string) => { intent: string; confidence: string }]> = [
      ["Show today's failed payments", 'billing.failed_payments', resolveAdminCommand],
      ['find customers with overdue invoices', 'billing.overdue_invoices', resolveAdminCommand],
      ['show servers with abnormal cpu', 'infrastructure.server_health', resolveAdminCommand],
      ['summarize unresolved support tickets', 'support.open_tickets', resolveAdminCommand],
      ['show stuck provisioning', 'infrastructure.stuck_provisioning', resolveAdminCommand],
      ['show expiring ssl certificates', 'infrastructure.expiring_ssl', resolveAdminCommand],
      ['platform overview', 'platform.overview', resolveAdminCommand],
      ['show my invoices', 'customer.invoices', resolveCustomerMessage],
      ['my subscriptions and services', 'customer.subscriptions', resolveCustomerMessage],
      ['my domain dns records', 'customer.domains', resolveCustomerMessage],
      ['my ssl certificate status', 'customer.ssl', resolveCustomerMessage],
    ];
    for (const [phrase, expectedIntent, resolver] of cases) {
      const resolution = resolver(phrase);
      expect(resolution.intent, `phrase: ${phrase}`).toBe(expectedIntent);
      expect(resolution.confidence).toBe('exact');
    }
  });

  it('explicit ticket form opens tickets; generic support words stay side-effect-free', () => {
    // Explicit confirmation form → real ticket creation.
    const explicit = resolveCustomerMessage('open ticket: disk full on deploy');
    expect(explicit.intent).toBe('customer.open_ticket');
    expect(explicit.execute).toBeTypeOf('function');
    expect(resolveCustomerMessage('ticket: billing portal shows 500').intent).toBe('customer.open_ticket');
    // Generic "open ticket"-ish words → confirmation prompt, never a side effect.
    const prompt = resolveCustomerMessage('open ticket');
    expect(prompt.intent).toBe('customer.open_ticket_prompt');
    expect(resolveCustomerMessage('contact support').intent).toBe('customer.open_ticket_prompt');
    // Too short after the colon → still no side effect.
    expect(resolveCustomerMessage('ticket: x').intent).not.toBe('customer.open_ticket');
  });

  it('out-of-scope content is honestly unsupported, never guessed', () => {
    expect(resolveAdminCommand('rewrite the whole platform in rust').intent).toBe('unsupported');
    const adminUnsupported = resolveAdminCommand('hack the gibson');
    expect(adminUnsupported.unsupportedReason).toContain('will not guess');
    // Non-question-shaped nonsense cannot match any intent at all.
    expect(resolveCustomerMessage('gibblezonk').intent).toBe('unsupported');
    const customerUnsupported = resolveCustomerMessage('gibblezonk');
    expect(customerUnsupported.unsupportedReason).toContain('will not guess');
    // Question-shaped queries route to the knowledge base, which refuses honestly when undocumented.
    expect(resolveCustomerMessage('how do I join the quantum swarm matrix').intent).toBe('customer.knowledge');
  });
});

describe('Tool argument validation + storage redaction', () => {
  it('rejects invalid arguments deterministically with a clear error', () => {
    const tool = getToolDefinition('create_ticket')!;
    expect(tool).toBeDefined();
    expect(() => validateToolArguments(tool, { subject: 'x' })).toThrow(/userId|required/i);
    expect(() => validateToolArguments(tool, { userId: 'not-a-uuid', subject: 'x' })).toThrow(/uuid/i);
    const cleaned = validateToolArguments(tool, {
      userId: '2ba32e2c-6a4a-4d07-9b9b-2f0e5b0359a1',
      subject: '  Subject with padding  ',
      body: 'please help',
      priority: 'high',
      ignoredExtra: 'dropped',
    });
    expect(cleaned.subject).toBe('Subject with padding');
    expect(cleaned.ignoredExtra).toBeUndefined();
  });

  it('redacts secrets out of anything persisted to audit/tool storage', () => {
    const redacted = redactForStorage({
      apiKey: 'sk-live-123',
      nested: { password: 'hunter2', token: 'abc' },
      publicData: 'visible',
    }) as Record<string, unknown>;
    expect(redacted.apiKey).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).password).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).token).toBe('[redacted]');
    expect(redacted.publicData).toBe('visible');
  });
});
