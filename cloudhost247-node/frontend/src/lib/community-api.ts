import { apiFetch } from './api';

/**
 * Typed client for the Community Forum API.
 *
 * Everything goes through `apiFetch`, so a signed-in member's bearer token is attached by the same
 * code path as the rest of the app, and a 401 clears the local session exactly once (lib/api.ts).
 * These types mirror src/community/community-service.ts — the server is the source of truth; the
 * client never decides what a member is allowed to do, it only hides controls that would 403.
 */

export type CommunityStanding = 'staff' | 'moderator' | 'developer' | 'member';

export interface CommunityAuthor {
  id: string;
  username: string;
  displayName: string;
  standing: CommunityStanding;
  reputation: number;
  joinedAt: string;
}

export interface CommunityCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  purpose: 'discussion' | 'question' | 'announcement' | 'showcase';
  acceptsSolutions: boolean;
  staffOnlyPosting: boolean;
  isEnabled: boolean;
  position: number;
  discussionCount: number;
  replyCount: number;
  solvedCount: number;
  lastActivityAt: string | null;
}

export interface DiscussionSummary {
  id: string;
  slug: string;
  title: string;
  preview: string;
  tags: string[];
  category: { id: string; slug: string; name: string };
  author: CommunityAuthor;
  isPinned: boolean;
  isLocked: boolean;
  isSolved: boolean;
  replyCount: number;
  reactionCount: number;
  viewCount: number;
  lastActivityAt: string;
  createdAt: string;
}

export interface AttachmentSummary {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  url: string;
}

export interface ReplyView {
  id: string;
  body: string;
  isAccepted: boolean;
  reactionCount: number;
  viewerReacted: boolean;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  author: CommunityAuthor;
  attachments: AttachmentSummary[];
  quotedReply: { id: string; author: CommunityAuthor; preview: string } | null;
  children: ReplyView[];
}

export interface DiscussionDetail {
  discussion: DiscussionSummary & {
    body: string;
    updatedAt: string;
    editedAt: string | null;
    canBeSolved: boolean;
    aiPublishedAt: string | null;
  };
  category: CommunityCategory;
  attachments: AttachmentSummary[];
  replies: ReplyView[];
  acceptedReplyId: string | null;
  viewer: {
    canEdit: boolean;
    canModerate: boolean;
    canAcceptSolution: boolean;
    isBookmarked: boolean;
    isSubscribed: boolean;
    isAuthor: boolean;
  } | null;
  related: Array<{ id: string; slug: string; title: string; replyCount: number }>;
}

export interface CommunityHome {
  stats: { members: number; discussions: number; replies: number; solved: number; activeToday: number };
  categories: CommunityCategory[];
  latest: DiscussionSummary[];
  popular: DiscussionSummary[];
  trending: DiscussionSummary[];
  unanswered: DiscussionSummary[];
  solved: DiscussionSummary[];
  contributors: Array<CommunityAuthor & { acceptedAnswers: number }>;
  canParticipate: boolean;
}

export interface MemberSummary extends CommunityAuthor {
  acceptedAnswers: number;
  discussionCount: number;
  replyCount: number;
  badges: Array<{ slug: string; name: string; icon: string }>;
}

export interface MemberProfile {
  member: MemberSummary & {
    bio: string;
    location: string | null;
    websiteUrl: string | null;
    isDeveloper: boolean;
    isStaff: boolean;
    isModerator: boolean;
    isSelf: boolean;
    solvedCount: number;
  };
  discussions: DiscussionSummary[];
  replies: Array<{
    id: string;
    discussionId: string;
    discussionSlug: string;
    discussionTitle: string;
    preview: string;
    isAccepted: boolean;
    createdAt: string;
  }>;
}

export interface NotificationPreference {
  type: string;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
  isDefault: boolean;
}

export interface CommunityIdentity {
  userId: string;
  username: string;
  displayName: string;
  standing: CommunityStanding;
  designations: string[];
  reputation: number;
  acceptedAnswers: number;
  joinedAt: string;
  bio: string;
  location: string | null;
  websiteUrl: string | null;
  directoryListed: boolean;
  restrictedUntil: string | null;
  restrictionReason: string | null;
  canModerate: boolean;
  isSuperAdmin: boolean;
  badges: Array<{ slug: string; name: string; description: string; kind: string; icon: string }>;
  notificationPreferences: NotificationPreference[];
}

export interface CommunityNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const communityApi = {
  home: () => apiFetch<CommunityHome>('/api/v1/community/home'),
  categories: () => apiFetch<{ categories: CommunityCategory[] }>('/api/v1/community/categories'),
  category: (slug: string) =>
    apiFetch<{ category: CommunityCategory; discussions: Page<DiscussionSummary> }>(
      `/api/v1/community/categories/${encodeURIComponent(slug)}`
    ),
  discussions: (params: { category?: string; sort?: string; tag?: string; page?: number } = {}) =>
    apiFetch<Page<DiscussionSummary>>(`/api/v1/community/discussions${query(params)}`),
  discussion: (slug: string) =>
    apiFetch<DiscussionDetail>(`/api/v1/community/discussions/${encodeURIComponent(slug)}`),
  recordView: (slug: string) =>
    apiFetch<{ recorded: boolean }>(`/api/v1/community/discussions/${encodeURIComponent(slug)}/view`, { method: 'POST' }),
  search: (q: string, page?: number) => apiFetch<{ discussions: DiscussionSummary[]; total: number; page: number; pageSize: number }>(
    `/api/v1/community/search${query({ q, page })}`
  ),
  createDiscussion: (input: { categoryId: string; title: string; body: string; tags?: string[] }) =>
    apiFetch<{ id: string; slug: string }>('/api/v1/community/discussions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateDiscussion: (id: string, input: { title?: string; body?: string; tags?: string[] }) =>
    apiFetch<{ updated: boolean }>(`/api/v1/community/discussions/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteDiscussion: (id: string) =>
    apiFetch<{ deleted: boolean }>(`/api/v1/community/discussions/${id}`, { method: 'DELETE' }),
  createReply: (discussionId: string, input: { body: string; parentId?: string | null }) =>
    apiFetch<{ id: string }>(`/api/v1/community/discussions/${discussionId}/replies`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateReply: (id: string, body: string) =>
    apiFetch<{ updated: boolean }>(`/api/v1/community/replies/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteReply: (id: string) => apiFetch<{ deleted: boolean }>(`/api/v1/community/replies/${id}`, { method: 'DELETE' }),
  acceptSolution: (discussionId: string, replyId: string) =>
    apiFetch<{ accepted: boolean }>(`/api/v1/community/discussions/${discussionId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ replyId }),
    }),
  removeSolution: (discussionId: string) =>
    apiFetch<{ accepted: boolean }>(`/api/v1/community/discussions/${discussionId}/accept`, { method: 'DELETE' }),
  react: (targetType: 'discussion' | 'reply', targetId: string, kind: 'like' | 'helpful' | 'insightful' = 'like') =>
    apiFetch<{ reacted: boolean; count: number }>('/api/v1/community/reactions', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId, kind }),
    }),
  bookmark: (discussionId: string) =>
    apiFetch<{ bookmarked: boolean }>(`/api/v1/community/discussions/${discussionId}/bookmark`, { method: 'POST' }),
  subscribe: (discussionId: string) =>
    apiFetch<{ subscribed: boolean }>(`/api/v1/community/discussions/${discussionId}/subscribe`, { method: 'POST' }),
  report: (input: { targetType: 'discussion' | 'reply' | 'member'; targetId: string; reason: string; detail?: string }) =>
    apiFetch<{ id: string }>('/api/v1/community/reports', { method: 'POST', body: JSON.stringify(input) }),
  uploadAttachment: (input: { discussionId: string; replyId?: string | null; fileName: string; mimeType: string; dataBase64: string }) =>
    apiFetch<AttachmentSummary>('/api/v1/community/attachments', { method: 'POST', body: JSON.stringify(input) }),
  members: (params: { sort?: string; page?: number; q?: string } = {}) => apiFetch<Page<MemberSummary>>(`/api/v1/community/members${query(params)}`),
  member: (username: string) => apiFetch<MemberProfile>(`/api/v1/community/members/${encodeURIComponent(username)}`),
  developers: () =>
    apiFetch<{ categories: CommunityCategory[]; discussions: DiscussionSummary[]; developers: MemberSummary[]; members: MemberSummary[] }>(
      '/api/v1/community/developers'
    ),
  me: () => apiFetch<CommunityIdentity>('/api/v1/community/me'),
  settings: () =>
    apiFetch<{
      bio: string;
      location: string | null;
      websiteUrl: string | null;
      directoryListed: boolean;
      notificationPreferences: NotificationPreference[];
    }>('/api/v1/community/settings'),
  saveSettings: (input: {
    bio?: string;
    location?: string | null;
    websiteUrl?: string | null;
    directoryListed?: boolean;
    notificationPreferences?: Array<{ type: string; inApp: boolean; email: boolean }>;
  }) => apiFetch<{ saved: boolean; notificationPreferences: NotificationPreference[] }>('/api/v1/community/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  }),
  bookmarks: (page?: number) => apiFetch<Page<DiscussionSummary>>(`/api/v1/community/bookmarks${query({ page })}`),
  notifications: () => apiFetch<{ notifications: CommunityNotification[] }>('/api/v1/community/notifications'),
  markNotificationsRead: (ids?: string[]) =>
    apiFetch<{ marked: number }>('/api/v1/community/notifications/read', {
      method: 'POST',
      body: JSON.stringify(ids ? { ids } : {}),
    }),

  // ---------------------------------------------------------------------------------------
  // Administration (staff). The server re-verifies the role on every call.
  // ---------------------------------------------------------------------------------------
  admin: {
    overview: () =>
      apiFetch<{
        totals: {
          discussions: number;
          replies: number;
          members: number;
          solved: number;
          openReports: number;
          restricted: number;
          publishedSolutions: number;
        };
        categories: Array<{ id: string; slug: string; name: string; isEnabled: boolean; discussionCount: number }>;
        recentReports: Array<{
          id: string;
          targetType: string;
          targetId: string;
          reason: string;
          detail: string;
          createdAt: string;
          reporter: string;
          status: string;
        }>;
        recentActions: Array<{
          id: string;
          action: string;
          resourceType: string;
          resourceId: string | null;
          actorId: string | null;
          createdAt: string;
          metadata: Record<string, unknown>;
        }>;
        staff: Array<{ userId: string; username: string; displayName: string; designations: string[] }>;
      }>('/api/v1/admin/community/overview'),
    categories: () => apiFetch<{ categories: CommunityCategory[] }>('/api/v1/admin/community/categories'),
    createCategory: (input: Record<string, unknown>) =>
      apiFetch<{ id: string }>('/api/v1/admin/community/categories', { method: 'POST', body: JSON.stringify(input) }),
    updateCategory: (id: string, input: Record<string, unknown>) =>
      apiFetch<{ updated: boolean }>(`/api/v1/admin/community/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    disableCategory: (id: string) =>
      apiFetch<{ disabled: boolean }>(`/api/v1/admin/community/categories/${id}`, { method: 'DELETE' }),
    setFlags: (id: string, flags: { pinned?: boolean; locked?: boolean }) =>
      apiFetch<{ updated: boolean }>(`/api/v1/admin/community/discussions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(flags),
      }),
    removeDiscussion: (id: string, reason: string) =>
      apiFetch<{ removed: boolean }>(`/api/v1/admin/community/discussions/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      }),
    removeReply: (id: string, reason: string) =>
      apiFetch<{ removed: boolean }>(`/api/v1/admin/community/replies/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      }),
    reports: (status: 'open' | 'actioned' | 'dismissed' | 'all' = 'open') =>
      apiFetch<{ reports: Array<{ id: string; targetType: string; targetId: string; reason: string; detail: string; status: string; createdAt: string; reporter: string }> }>(
        `/api/v1/admin/community/reports${query({ status })}`
      ),
    resolveReport: (id: string, action: 'actioned' | 'dismissed', note: string) =>
      apiFetch<{ resolved: boolean }>(`/api/v1/admin/community/reports/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action, note }),
      }),
    restrictMember: (id: string, restrictedUntil: string | null, reason: string) =>
      apiFetch<{ saved: boolean }>(`/api/v1/admin/community/members/${id}/restriction`, {
        method: 'POST',
        body: JSON.stringify({ restrictedUntil, reason }),
      }),
    setRole: (id: string, role: 'moderator' | 'developer' | 'staff', grant: boolean) =>
      apiFetch<{ saved: boolean }>(`/api/v1/admin/community/members/${id}/roles`, {
        method: 'POST',
        body: JSON.stringify({ role, grant }),
      }),
    setBadge: (id: string, badge: string, grant: boolean) =>
      apiFetch<{ saved: boolean }>(`/api/v1/admin/community/members/${id}/badges`, {
        method: 'POST',
        body: JSON.stringify({ badge, grant }),
      }),
    publishSolution: (discussionId: string) =>
      apiFetch<{ published: boolean; chunkCount: number; url: string }>(
        `/api/v1/admin/community/discussions/${discussionId}/publish-solution`,
        { method: 'POST' }
      ),
    revokeSolution: (discussionId: string, reason: string) =>
      apiFetch<{ revoked: boolean }>(`/api/v1/admin/community/discussions/${discussionId}/publish-solution`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      }),
    solutions: () =>
      apiFetch<{ solutions: Array<{ id: string; title: string; url: string | null; sync_status: string; approval_status: string; authority_tier: number; chunk_count: number; last_synced_at: string | null; excluded: boolean }> }>(
        '/api/v1/admin/community/solutions'
      ),
  },
};
