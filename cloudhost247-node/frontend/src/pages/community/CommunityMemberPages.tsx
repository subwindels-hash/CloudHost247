import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { useApiResource } from '../../lib/useApiResource';
import {
  communityApi,
  type CommunityNotification,
  type DiscussionSummary,
  type NotificationPreference,
  type Page as PageResult,
} from '../../lib/community-api';
import { useAuthState } from '../../layout/useAuthState';
import {
  CommunityBreadcrumb,
  DiscussionCard,
  EmptyState,
  LoadError,
  Loading,
  Pagination,
  relativeTime,
  standingLabel,
} from '../../components/community/CommunityUI';

/**
 * The member's own community surfaces: notifications, bookmarks and settings.
 *
 * Each page is reachable only through `RequireAuth` in the router, and each endpoint behind it
 * re-verifies the token server-side — the guard is a redirect, not the security boundary.
 */

function SignedOut({ what }: { what: string }) {
  return (
    <div className="community-page">
      <div className="community-wrap">
        <div className="community-composer">
          <h1>Sign in to see your {what}</h1>
          <p className="community-composer__hint">Your community account is your CloudHost247 account.</p>
          <div className="community-form__actions">
            <Link className="community-button" to="/login">Sign in</Link>
            <Link className="community-button community-button--quiet" to="/community">Back to the community</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CommunityNotificationsPage() {
  usePageMeta('Community notifications', 'Replies, mentions, reactions and moderation notices from the CloudHost247 community.');
  const { token } = useAuthState();
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'success'; items?: CommunityNotification[]; message?: string }>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    communityApi
      .notifications()
      .then((result) => setState({ status: 'success', items: result.notifications }))
      .catch((error: unknown) => setState({ status: 'error', message: error instanceof Error ? error.message : 'Notifications could not be loaded.' }));
  }, []);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  if (!token) return <SignedOut what="community notifications" />;

  const unread = (state.items ?? []).filter((item) => !item.readAt);

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Notifications' }]} />
        <header>
          <p className="community-eyebrow">Community</p>
          <h1>Notifications</h1>
          <p className="community-form__hint">
            Replies, mentions, reactions, accepted solutions and moderation notices. Email copies are opt-in per type
            in your community settings; by default these stay inside CloudHost247.
          </p>
        </header>
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError message={state.message ?? 'Notifications could not be loaded.'} onRetry={load} />}
        {state.status === 'success' && (
          <>
            <div className="community-form__actions community-section">
              <button
                type="button"
                className="community-button community-button--quiet community-button--sm"
                disabled={unread.length === 0}
                onClick={() => {
                  void communityApi.markNotificationsRead().then(load);
                }}
              >
                Mark all as read ({unread.length})
              </button>
            </div>
            {state.items!.length === 0 ? (
              <EmptyState title="No community notifications yet">
                When someone replies to your discussion, mentions you or accepts your answer, it appears here.
              </EmptyState>
            ) : (
              <ul className="community-notifications">
                {state.items!.map((item) => (
                  <li key={item.id} className={`community-notification${item.readAt ? '' : ' is-unread'}`}>
                    <strong>
                      {item.resourceId && item.resourceType === 'community_discussion' ? (
                        <Link to="/community/notifications" onClick={(event) => event.preventDefault()}>{item.title}</Link>
                      ) : (
                        item.title
                      )}
                    </strong>
                    <p>{item.message}</p>
                    <small>{relativeTime(item.createdAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function CommunityBookmarksPage() {
  usePageMeta('Bookmarked discussions', 'Discussions you saved from the CloudHost247 community.');
  const { token } = useAuthState();
  const [page, setPage] = useState(1);
  const state = useApiResource<PageResult<DiscussionSummary>>(`/api/v1/community/bookmarks?page=${page}`);

  if (!token) return <SignedOut what="bookmarks" />;

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Bookmarks' }]} />
        <header>
          <p className="community-eyebrow">Community</p>
          <h1>Bookmarks</h1>
        </header>
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError message={state.message} />}
        {state.status === 'success' && (
          <>
            {state.data.items.length === 0 ? (
              <EmptyState title="No bookmarks yet" action={<Link className="community-button" to="/community">Browse discussions</Link>}>
                Open a discussion and choose “Bookmark” to keep it here.
              </EmptyState>
            ) : (
              <div className="community-stack">
                {state.data.items.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />)}
              </div>
            )}
            <Pagination page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

export function CommunitySettingsPage() {
  usePageMeta('Community settings', 'Your CloudHost247 community profile and notification preferences.');
  const { token } = useAuthState();
  const [state, setState] = useState<{
    status: 'loading' | 'error' | 'success';
    message?: string;
    bio: string;
    location: string;
    websiteUrl: string;
    directoryListed: boolean;
    preferences: NotificationPreference[];
    standing: string;
    reputation: number;
  }>({
    status: 'loading',
    bio: '',
    location: '',
    websiteUrl: '',
    directoryListed: true,
    preferences: [],
    standing: 'member',
    reputation: 0,
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading' }));
    Promise.all([communityApi.settings(), communityApi.me()])
      .then(([settings, identity]) =>
        setState({
          status: 'success',
          bio: settings.bio,
          location: settings.location ?? '',
          websiteUrl: settings.websiteUrl ?? '',
          directoryListed: settings.directoryListed,
          preferences: settings.notificationPreferences,
          standing: identity.standing,
          reputation: identity.reputation,
        })
      )
      .catch((error: unknown) =>
        setState((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Settings could not be loaded.' }))
      );
  }, []);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  if (!token) return <SignedOut what="community settings" />;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    setSaveError(null);
    try {
      const result = await communityApi.saveSettings({
        bio: state.bio,
        location: state.location || null,
        websiteUrl: state.websiteUrl || null,
        directoryListed: state.directoryListed,
        notificationPreferences: state.preferences.map((preference) => ({
          type: preference.type,
          inApp: preference.inApp,
          email: preference.email,
        })),
      });
      setState((current) => ({ ...current, preferences: result.notificationPreferences }));
      setNotice('Your community settings are saved.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Your settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (type: string, key: 'inApp' | 'email') => {
    setState((current) => ({
      ...current,
      preferences: current.preferences.map((preference) =>
        preference.type === type ? { ...preference, [key]: !preference[key], isDefault: false } : preference
      ),
    }));
  };

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'Settings' }]} />
        <header>
          <p className="community-eyebrow">Community</p>
          <h1>Community settings</h1>
          <p className="community-form__hint">
            {state.status === 'success' ? `${standingLabel(state.standing)} · ${state.reputation} reputation. ` : ''}
            Your display name and e-mail come from your CloudHost247 account; they are not duplicated here.
          </p>
        </header>

        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <LoadError message={state.message ?? 'Settings could not be loaded.'} onRetry={load} />}
        {state.status === 'success' && (
          <form className="community-form" onSubmit={(event) => void save(event)}>
            <fieldset>
              <legend>Profile</legend>
              <label>
                Biography
                <textarea
                  value={state.bio}
                  maxLength={600}
                  onChange={(event) => setState((current) => ({ ...current, bio: event.target.value }))}
                  placeholder="What do you work with? Which systems do you know well?"
                  style={{ minHeight: 110 }}
                />
              </label>
              <div className="community-form__row">
                <label>
                  Location (optional)
                  <input
                    type="text"
                    value={state.location}
                    maxLength={120}
                    onChange={(event) => setState((current) => ({ ...current, location: event.target.value }))}
                  />
                </label>
                <label>
                  Website (https only)
                  <input
                    type="url"
                    value={state.websiteUrl}
                    maxLength={200}
                    placeholder="https://example.com"
                    onChange={(event) => setState((current) => ({ ...current, websiteUrl: event.target.value }))}
                  />
                </label>
              </div>
              <label className="community-check">
                <input
                  type="checkbox"
                  checked={state.directoryListed}
                  onChange={(event) => setState((current) => ({ ...current, directoryListed: event.target.checked }))}
                />
                <span>
                  List me in the community member directory
                  <small>Hiding yourself does not make your posts anonymous — they stay attributed to your account.</small>
                </span>
              </label>
            </fieldset>

            <fieldset>
              <legend>Notifications</legend>
              <p className="community-form__hint">
                In-app notifications appear in the CloudHost247 bell. Email copies are off by default: community
                activity should not arrive as unsolicited mail unless you ask for it.
              </p>
              <table className="community-table">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">In-app</th>
                    <th scope="col">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {state.preferences.map((preference) => (
                    <tr key={preference.type}>
                      <td>
                        <strong>{preference.label}</strong>
                        <p className="community-form__hint">{preference.description}</p>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={preference.inApp}
                          onChange={() => toggle(preference.type, 'inApp')}
                          aria-label={`${preference.label} in-app notifications`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={preference.email}
                          onChange={() => toggle(preference.type, 'email')}
                          aria-label={`${preference.label} email notifications`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </fieldset>

            {notice && <p className="community-note" role="status">{notice}</p>}
            {saveError && <p className="community-error" role="alert">{saveError}</p>}
            <div className="community-form__actions">
              <button type="submit" className="community-button" disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
              <Link className="community-button community-button--quiet" to="/community/notifications">View notifications</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
