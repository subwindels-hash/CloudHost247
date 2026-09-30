import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  resource_type: string | null;
  resource_id: string | null;
  read_at: string | null;
  created_at: string;
}

const TONE: Record<string, string> = {
  SERVER_READY: 'is-success',
  SERVER_REINSTALLED: 'is-success',
  OS_EOL_WARNING: 'is-warning',
  OS_EOL: 'is-danger',
  SERVER_TERMINATED: 'is-danger',
};

/**
 * Customer notification centre. The platform already records durable in-app notifications for
 * provisioning and operating-system lifecycle events; this is where a customer reads them.
 * Every request is scoped server-side to the signed-in user.
 */
export default function NotificationsPage() {
  usePageMeta('Notifications', 'Provisioning and operating-system notices for your services.');
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await apiFetch<{ notifications: Notification[]; unread: number }>('/api/v1/notifications');
      setNotifications(result.notifications);
      setUnread(result.unread);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load notifications');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function markRead(notification: Notification) {
    if (notification.read_at) return;
    try {
      await apiFetch(`/api/v1/notifications/${notification.id}/read`, { method: 'POST', body: '{}' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the notification');
    }
  }

  async function markAllRead() {
    try {
      await apiFetch('/api/v1/notifications/read-all', { method: 'POST', body: '{}' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update notifications');
    }
  }

  return (
    <div className="ch247-stack">
      <section className="ch247-card ch247-section-heading">
        <div>
          <span className="ch247-eyebrow">Dashboard</span>
          <h1>Notifications</h1>
          <p className="ch247-page__hint">
            {unread > 0 ? `${unread} unread notice${unread === 1 ? '' : 's'}.` : 'You are up to date.'}
          </p>
        </div>
        {unread > 0 && <button className="ch247-btn" onClick={() => void markAllRead()}>Mark all as read</button>}
      </section>

      {error && <CatalogErrorBanner message={error} />}
      {!notifications && !error && <CatalogLoadingBanner label="Loading notifications…" />}

      {notifications && notifications.length === 0 && (
        <section className="ch247-card ch247-empty-state">
          <p className="ch247-empty-state__icon" aria-hidden="true">✓</p>
          <h2>No notifications yet</h2>
          <p>Provisioning results and operating-system lifecycle notices will appear here.</p>
        </section>
      )}

      {notifications && notifications.length > 0 && (
        <ul className="ch247-notification-list">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`ch247-card ch247-notification ${TONE[notification.type] ?? ''}${notification.read_at ? '' : ' is-unread'}`}
            >
              <div className="ch247-notification__head">
                <h2>{notification.title}</h2>
                <time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time>
              </div>
              <p className="ch247-notification__body">{notification.message}</p>
              <div className="ch247-actions">
                {notification.resource_type === 'server' && notification.resource_id && (
                  <Link className="ch247-btn" to={`/dashboard/servers/${notification.resource_id}`}>Open server</Link>
                )}
                {!notification.read_at && (
                  <button className="ch247-btn" onClick={() => void markRead(notification)}>Mark as read</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
