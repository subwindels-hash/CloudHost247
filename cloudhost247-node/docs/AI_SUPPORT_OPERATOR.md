# CloudHost247 embedded AI Support Operator

The AI Support Operator is a native, deterministic support workflow. It does not call an AI provider
and has no API-key or external billing requirement.

## Runtime flow

```text
AiSupportWidget
  -> /api/v1/ai-support/conversations
  -> /api/v1/ai-support/conversations/:id/messages
  -> services/ai-support-operator.ts
  -> ai/knowledge.ts + published catalog reads
  -> ai_support_conversations / ai_support_messages
  -> human queue or existing support_tickets
```

- Visitors receive an opaque, hashed conversation token. The browser sends it in
  `X-AI-Conversation-Token`; the raw token is never stored in the database.
- Authenticated users' conversations are scoped to their existing `users.id`. Account-specific
  requests do not read or disclose billing, server, credentials, or another customer's data.
- The knowledge file is reviewed application data with a source for each topic. Unknown questions,
  security requests, complaints, refunds, server incidents, and explicit human requests escalate.
- Published catalog pricing is queried from `products`, `product_plans`, and `plan_pricing`. No
  unpublished or placeholder price is returned.

## Human handoff

`support_agent_presence` stores `ONLINE`, `BUSY`, or `OFFLINE` and a capacity. A conversation is
assigned only to an active staff/admin/super-admin account with `ONLINE` presence and available
capacity. Once assigned, the AI endpoint accepts the customer's message into the transcript but
does not generate another AI response.

If nobody is available:

- the conversation becomes `WAITING_FOR_HUMAN`;
- authenticated customers also receive a linked record in the existing `support_tickets` system;
- visitor conversations remain queue records until contact details are captured;
- the full AI transcript stays in `ai_support_messages`;
- in-app notifications and the existing notification email outbox alert the support queue.

Support operators use `/admin/ai-support` to view the full transcript, accept/reassign, reply,
resolve, close, reopen, or explicitly return a conversation to AI. The return-to-AI transition is
recorded as a system message and audit event.

## Newsletter

Newsletter subscription is separate from support escalation. It uses the existing conversation
access boundary, validates `name` and `email`, and inserts into `newsletter_subscriptions` with
`source = 'ai_assistant'`. A unique case-insensitive email index prevents duplicates. Admins can
view the latest subscriptions from the AI Support Desk.

## Important API routes

- `POST /api/v1/ai-support/conversations`
- `GET /api/v1/ai-support/conversations/:id`
- `POST /api/v1/ai-support/conversations/:id/messages`
- `PATCH /api/v1/ai-support/conversations/:id/contact`
- `POST /api/v1/ai-support/conversations/:id/newsletter`
- `GET /api/v1/ai-support/availability`
- `GET /api/v1/admin/ai-support/conversations`
- `GET /api/v1/admin/ai-support/conversations/:id`
- `POST /api/v1/admin/ai-support/conversations/:id/reply`
- `PATCH /api/v1/admin/ai-support/conversations/:id`
- `PUT /api/v1/admin/ai-support/presence`
- `GET /api/v1/admin/ai-support/overview`
- `GET /api/v1/admin/ai-support/knowledge`
- `GET /api/v1/admin/newsletter-subscriptions`

All routes use relative URLs in the frontend and existing authentication/RBAC on the backend.
