import type { Queryable } from '../db/types';
import { dispatchCustomerIntent } from '../ai-os/runtime/customer-orchestrator';
import type { OperatorDecision } from './ai-support-operator';
import type { LaunchServiceKey } from '../whmcs/agent-orderability';

const PROMPT_INTENT = 'website_launch_requirements';
const CHOICES = ['WordPress site', 'Business site', 'General website'];

/** Narrow, deterministic intake. Unrelated or sensitive questions retain normal support handling. */
export function isLaunchRequest(message: string): boolean {
  return /\b(?:launch|start|build|create|set\s*up)\b/i.test(message) && /\b(?:website|web\s*site)\b/i.test(message);
}

export function launchChoice(message: string): LaunchServiceKey | null {
  const normalized = message.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (['wordpress', 'wordpress site', 'wordpress website'].includes(normalized)) return 'hosting-wordpress';
  if (['business', 'business site', 'business website'].includes(normalized)) return 'hosting-business';
  if (['general', 'general website', 'general site'].includes(normalized)) return 'hosting-web-hosting';
  return null;
}

export function requirementsPrompt(): OperatorDecision {
  return {
    kind: 'CLARIFY', intent: PROMPT_INTENT, confidence: 1, sources: [],
    body: 'I can help you explore hosting for your website. What kind of site are you planning: a WordPress site, a business site, or a general website? You can also ask for a human at any time.',
    followUps: CHOICES,
  };
}

export function waitingForLaunchChoice(previous: Array<{ author_type: string; intent?: string | null }>): boolean {
  return previous.find((message) => message.author_type === 'AI')?.intent === PROMPT_INTENT;
}

/** Uses the existing AI-OS task executor and its gated, audited read-only WHMCS tool. */
export async function checkLaunchOption(
  db: Queryable,
  input: { serviceKey: LaunchServiceKey; conversationId: string; workflowId: string; userId: string | null },
): Promise<OperatorDecision> {
  const unavailable: OperatorDecision = {
    kind: 'ANSWER', intent: 'website_launch_unavailable', confidence: 1, sources: [],
    body: 'I cannot verify online ordering and current pricing for that category right now. Please ask for a human if you would like help choosing a plan. No order has been placed.',
    followUps: ['Talk to a human'],
  };
  try {
    const outcome = await dispatchCustomerIntent(db, {
      operation: 'website_launch', actorUserId: input.userId, conversationId: input.conversationId,
      workflowId: input.workflowId, serviceKey: input.serviceKey,
    });
    if (!outcome || outcome.runStatus !== 'succeeded' || outcome.pendingApprovals.length) return unavailable;
    const result = outcome.task.result as { verdict?: { orderable?: boolean; productName?: string | null; cycles?: Array<{ cycle: string; price: string; setupFee: string; currency: string; cartUrl: string }> }; checkedAt?: string } | null;
    const verdict = result?.verdict;
    if (!verdict?.orderable || !verdict.productName || !verdict.cycles?.length || !result?.checkedAt) return unavailable;
    const cycles = verdict.cycles.slice(0, 3);
    const lines = cycles.map((cycle) => `${cycle.currency} ${cycle.price} (${cycle.cycle.replace(/_/g, ' ')}; setup ${cycle.currency} ${cycle.setupFee})`);
    return {
      kind: 'ANSWER', intent: 'website_launch_options', confidence: 1,
      body: `For the category you selected, the WHMCS catalogue lists ${verdict.productName}: ${lines.join('; ')}. This lookup may use cached catalogue data; its age is not verified. Prices and availability can change and must be checked in the WHMCS cart. Choosing a link does not place an order. No payment or provisioning has been verified.`,
      sources: [`WHMCS orderability lookup ${result.checkedAt} (catalogue may be cached; age not verified)`],
      links: cycles.map((cycle) => ({ label: `Open WHMCS cart (${cycle.cycle.replace(/_/g, ' ')})`, url: cycle.cartUrl, kind: 'whmcs_cart' })),
      followUps: ['How do I register a domain?', 'Talk to a human'],
    };
  } catch {
    return unavailable;
  }
}
