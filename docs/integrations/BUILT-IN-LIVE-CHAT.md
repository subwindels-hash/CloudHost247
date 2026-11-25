# Built-in first-party live chat

Status: implemented in the Node/React platform and the WHMCS legacy theme, AI-first, with a single
visitor entry point. No third-party chat provider (LiveChat, Tawk.to, Zendesk/Zopim) is embedded
anywhere — the chat is built into the project and talks to the platform directly. It requires no
credential; the AI answers as soon as the Node migration runs, and staff/admin operators pick
conversations up from the console (with an audible ring when a visitor needs a human).

## What it is (and is not)

- The **built-in AI support decision layer answers first** (the same engine as the signed-in AI
  support desk: reviewed procedures → website knowledge → escalate on a guardrail or an unanswerable
  question). A human picks the conversation up only when the AI escalates it, when the visitor asks
  for a human, or when staff take it over — from that moment the AI stays silent for the rest of
  the conversation.
- Visitors talk to the Node service over short polling; the service persists conversations and
  messages in PostgreSQL. Staff answer from the platform admin console.
- There is no provider to connect, no widget key to paste, and nothing to fake: the console and the
  visitor widget are the real thing, end to end.
- K03's authenticated customer chat (`live_chat_*` tables, `/api/v1/live-chat/*`) is a separate,
  signed-in surface and is intentionally untouched. This document covers the anonymous public
  chat (`web_chat_*`, `/api/v1/web-chat/*`).

## Authority and surfaces

- Database: migration `0135_create_web_chat.sql` creates `web_chat_conversations` and
  `web_chat_messages`; `0136_web_chat_ai.sql` extends them for AI-first handling —
  `web_chat_messages.author` gains `'ai'`, and conversations gain `ai_handling`
  (`'ai'` = the AI answers · `'human'` = a person owns it, the AI is silent) and `escalated_at`
  (stamped only for an AI/visitor-initiated handoff — not for an ordinary staff reply or take-over).
  `0137_web_chat_ai_envelope.sql` adds the `links` and `follow_ups` JSON columns to
  `web_chat_messages` so AI answers persist the verified links and one-tap suggested follow-ups the
  widgets render (empty defaults for visitor/staff messages). A visitor is identified by an opaque random token; only its sha256 hash is stored
  (`visitor_token_hash`). A database leak cannot impersonate a visitor.
- Node API (`src/routes/web-chat.ts`):
  - Public (no account): `POST /api/v1/web-chat/session` (opens a conversation, or resumes one
    given the `X-Web-Chat-Token` header), `GET /api/v1/web-chat/messages?after=<seq>`,
    `POST /api/v1/web-chat/messages`. Visitor writes are rate-limited (30/min) and a visitor
    message to a closed conversation reopens it. On that POST the AI answers inline when the
    conversation is AI-owned: the reply is persisted as an `author='ai'`
    message (`CloudHost247 AI Support`). If the decision is `ESCALATE` (human request, guardrail, or
    unanswerable), the conversation flips to `ai_handling='human'`, an escalation notification goes
    to every active staff member (`user_notifications`, deduplicated per conversation), and the AI
    never answers again until staff explicitly return the conversation to the AI. If the AI itself
    fails, the conversation fail-closed escalates the same way — the visitor is never met with
    silence.
  - Staff (`staff`/`admin`/`super_admin`, re-verified server-side on every request):
    `GET /api/v1/admin/web-chat/conversations?status=open|closed&handling=ai|human` (escalated
    conversations sort first; `unreadStaff` counts unread *visitor* messages only),
    `GET .../conversations/:id/messages?after=<seq>` (a full-history read marks the visitor side
    read), `POST .../conversations/:id/messages` (reply — 409 CONVERSATION_CLOSED when closed; a
    staff reply hands ownership to the human side),
    `PATCH .../conversations/:id/handling` (`{"handling":"ai"|"human"}` — take over from the AI or
    return the conversation to it; returning to AI clears the `escalated_at` stamp),
    `PATCH .../close`, `PATCH .../reopen`.
- Public site (React SPA): the widget mounts bottom-right on every public page
  (`frontend/src/components/WebChatWidget.tsx`); it is hidden on `/admin/*` routes. The formerly
  separate "AI support assistant" launcher was removed: there is exactly one chat button per page,
  and it is the built-in widget — the AI answers inside it.
- Admin console: **Admin → Live Chat** at `/admin/live-chat`
  (`frontend/src/pages/AdminLiveChatPage.tsx`, `staff`/`admin`/`super_admin`). Open/closed filter,
  "Needs human" filter with a live count badge (escalated-first ordering), unread badge,
  `AI` / `Human` / `Needs human` chips, "Take over from AI" / "Return to AI" toggle, threaded view
  with a reply box and AI messages rendered in a distinct bubble, close/reopen. It is deliberately
  separate from the Unified Inbox (no channel adapter is involved).
- Audible ring + desktop alert for human handoff: when the AI hands a conversation to a human (or
  the visitor asks for one), open admin consoles ring. The console watches for conversations that
  gained `escalated_at` since the first poll — the pre-existing backlog does not ring — and plays a
  synthesized two-tone chime (Web Audio, `frontend/src/lib/web-chat-alert.ts`, no audio asset) three
  times, shows a dismissible "asked for a human" toast with an "Open conversation" shortcut, and
  refreshes the queue. A sound on/off toggle in the console header persists the choice in
  `localStorage` (`ch247_live_chat_sound_v1`, on by default). The console also offers opt-in
  **desktop notifications** (`🖥️ Desktop alerts` toggle in the console header): enabling asks the
  browser for notification permission and sends one test notification; fresh escalations then raise
  a desktop banner — only while the console tab is hidden, so you are never double-pinged while
  watching it — with `tag` deduplication per conversation and click-to-focus on the console.
  Desktop alerts are off by default and persist in `localStorage` (`ch247_live_chat_desktop_v1`).
  Both are best-effort: browsers that block audio before a user gesture will not ring until the
  operator interacts with the page once, and desktop alerts need permission granted (a denied or
  dismissed prompt shows how to allow it in site settings).
- Visitor widgets (SPA + WHMCS theme) render AI messages with a distinct label, show an AI-first
  status line while `ai_handling='ai'`, offer a "Talk to a human" button (the AI's own guardrail
  recognises the phrasing and hands the conversation over), and show a "a support specialist owns
  this conversation" line once a human owns it. AI answers carry their verified `links` (resolved
  server-side against the site registry; the widget never constructs a URL itself) rendered as a
  link list under the answer, and their `followUps` rendered as one-tap suggestion chips that send
  the question as the next visitor message. Both persist on the message row
  (`web_chat_messages.links` / `web_chat_messages.follow_ups`, migration `0137_web_chat_ai_envelope.sql`).
- WHMCS legacy theme: `cloudhost247_legacy_includes/livechatoptions.tpl` renders the built-in
  widget when the theme setting `enable_live_chat_cloudhost247` is `on`. The API origin is the
  theme's verified same-origin Node mount (`platform_base_path`, e.g. `/platform`) unless the
  optional `web_chat_api_base_url` override is set; the widget renders nothing when neither is
  available. Widget assets: `templates/cloudhost247_legacy/js/web-chat.js` and `css/web-chat.css`
  (vanilla JS, no dependencies). The legacy `live-chat-con` placeholder links on the contact page
  now open this widget. If the WHMCS host embeds the Node API under the same origin, no CORS
  surface is needed; for a cross-origin embed, allow the WHMCS origin in the Node service via
  `WEB_CHAT_ALLOWED_ORIGINS` (comma-separated `https://` origins, sees `.env.example`).
- CSP: the WHMCS nginx front-end allows `connect-src 'self' https:` and the Node vhost allows
  `'self'` — no CSP changes are required for the shipped configuration.

## Verification

- `tests/integration/web-chat-api.test.ts` exercises the public surface (open/resume/poll/send,
  hash-only token storage, 401 without a token), the AI-first flow (reviewed-procedure answer with
  `aiHandling='ai'`, human-request handoff with `aiHandling='human'`, AI silence after handoff,
  escalation notification to staff, return-to-AI via the admin endpoint), and the staff surface
  (403 for customer JWTs, 401 unauthenticated, unread marking, reply, 409 on closed, reopen flow,
  visitor-reopen-by-message, escalated-first ordering) against an embedded Postgres (pglite),
  following the repo's live-chat test pattern. 9/9 pass.
- `npm run typecheck` passes; the frontend production build passes; the dev stack (PGlite API on
  :3000 serving the built SPA with `DEV_SERVE_FRONTEND=1`, Vite SPA on :5173) serves the widget and
  the console; the AI-first path was verified end-to-end over HTTP.

## Honest limits

- Short polling every 4 seconds while a panel is open — not instant, and no presence/typing
  indicators. That is the deliberate transport choice; no WebSocket exists to fail behind the
  edge proxy.
- The visitor token lives in the browser's local storage; clearing it starts a new conversation.
- Messages are not end-to-end encrypted; they are stored in the platform database like tickets.
- The AI layer is the same engine as the AI support desk. With an empty website-knowledge index
  (a fresh deployment) every answer fails closed into a human handoff, and the AI says so — the
  index must be built for the AI to answer from the published corpus (see the AI website knowledge
  import in the admin tools). The reviewed operating procedures work regardless.
- Escalation notifications deduplicate per (staff member, conversation); a second escalation on a
  conversation a staff member already saw is not re-sent — the console's unread badge and the
  escalated-first ordering carry that signal instead.
- Nothing about a hosting provider or third-party chat service is verified or required here. If a
  deployment wants an external chat tool later, that is a separate, explicit decision.
