/**
 * First-party live chat client.
 *
 * Visitor calls go through a RAW fetch with no Authorization header on purpose: the chat token is
 * carried in `X-Web-Chat-Token`, and a 401 from the chat endpoints means "chat session unknown"
 * — it must never clear the visitor's first-party sign-in (apiFetch's 401 handling would).
 *
 * Staff calls use the shared apiFetch wrapper like every other admin surface.
 */
import { apiFetch } from './api';

export type WebChatStatus = 'open' | 'closed';
export type WebChatSource = 'spa' | 'whmcs' | 'unknown';

export type WebChatAiHandling = 'ai' | 'human';

export interface WebChatConversation {
  id: string;
  status: WebChatStatus;
  source: WebChatSource;
  visitorName: string | null;
  visitorEmail: string | null;
  lastMessageAt: string | null;
  /** 'ai' = the AI support layer answers visitor messages; 'human' = a person owns the conversation. */
  aiHandling: WebChatAiHandling;
  /** Set only when the AI/visitor triggered a handoff to a human — not for ordinary staff activity. */
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AdminWebChatConversation extends WebChatConversation {
  messageCount: number;
  unreadStaff: number;
  lastMessageBody: string | null;
  lastMessageAuthor: 'visitor' | 'staff' | 'ai' | null;
}
export interface WebChatAnswerLink {
  label: string;
  url: string;
  kind?: string;
}

export interface WebChatMessage {
  id: string;
  seq: number;
  author: 'visitor' | 'staff' | 'ai';
  authorName: string | null;
  body: string;
  links: WebChatAnswerLink[];
  followUps: string[];
  createdAt: string;
}

export class WebChatError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'WebChatError';
  }
}

async function rawJson<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Web-Chat-Token': token } : {}),
      ...(init.headers ?? {}),
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body as { error?: string; message?: string } | null;
    throw new WebChatError(res.status, err?.error ?? 'WEB_CHAT_ERROR', err?.message ?? `Chat request failed (HTTP ${res.status})`);
  }
  return body as T;
}

const SESSION = '/api/v1/web-chat/session';
const MESSAGES = '/api/v1/web-chat/messages';

export function visitorOpenOrResumeSession(
  input: { name?: string; email?: string; source: WebChatSource },
  token?: string | null,
): Promise<{ conversation: WebChatConversation; token: string | null }> {
  return rawJson(SESSION, { method: 'POST', body: JSON.stringify(input) }, token ?? undefined);
}

export function visitorGetMessagesAfter(
  token: string,
  after: number,
): Promise<{ conversation: WebChatConversation; messages: WebChatMessage[] }> {
  return rawJson(`${MESSAGES}?after=${encodeURIComponent(String(after))}`, { method: 'GET' }, token);
}

export function visitorSendMessage(
  token: string,
  body: string,
): Promise<{ message: WebChatMessage; aiHandling: WebChatAiHandling }> {
  return rawJson(MESSAGES, { method: 'POST', body: JSON.stringify({ body }) }, token);
}

// --- Staff surface (Admin → Live Chat) ---------------------------------------

const ADMIN = '/api/v1/admin/web-chat';

export function adminListConversations(
  status?: WebChatStatus,
  handling?: WebChatAiHandling,
): Promise<{ conversations: AdminWebChatConversation[] }> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (handling) params.set('handling', handling);
  const query = params.toString();
  return apiFetch(`${ADMIN}/conversations${query ? `?${query}` : ''}`);
}

export function adminGetMessagesAfter(
  id: string,
  after: number,
): Promise<{ conversation: WebChatConversation; messages: WebChatMessage[] }> {
  return apiFetch(`${ADMIN}/conversations/${encodeURIComponent(id)}/messages?after=${encodeURIComponent(String(after))}`);
}

export function adminSendMessage(id: string, body: string): Promise<{ message: WebChatMessage }> {
  return apiFetch(`${ADMIN}/conversations/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function adminSetHandling(
  id: string,
  handling: WebChatAiHandling,
): Promise<{ conversation: WebChatConversation }> {
  return apiFetch(`${ADMIN}/conversations/${encodeURIComponent(id)}/handling`, {
    method: 'PATCH',
    body: JSON.stringify({ handling }),
  });
}

export function adminCloseConversation(id: string): Promise<{ conversation: WebChatConversation }> {
  return apiFetch(`${ADMIN}/conversations/${encodeURIComponent(id)}/close`, { method: 'PATCH', body: '{}' });
}

export function adminReopenConversation(id: string): Promise<{ conversation: WebChatConversation }> {
  return apiFetch(`${ADMIN}/conversations/${encodeURIComponent(id)}/reopen`, { method: 'PATCH', body: '{}' });
}
