import { useState } from 'react';
import { deleteTicketAttachment, downloadTicketAttachment } from '../lib/account-api';
import type { TicketAttachment } from '../lib/account-types';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Renders the files attached to one ticket message (or to the ticket itself).
 *
 * Two deliberate choices:
 *   - the download is a button, not a link. The route is session-gated (`downloadPath` is an API
 *     path, not a public URL), so it has to go through `downloadTicketAttachment`, which carries
 *     the bearer token. A plain `<a href>` would produce an unauthenticated 401 that looks like a
 *     broken file.
 *   - "Remove" only appears for files the viewer uploaded (`canDelete`). The server enforces the
 *     same rule independently; showing the control to someone who cannot use it would be a lie.
 */
export default function TicketAttachments({
  ticketId,
  attachments,
  canDelete,
  onDeleted,
}: {
  ticketId: string;
  attachments: TicketAttachment[];
  canDelete: boolean;
  onDeleted?: (attachmentId: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  async function onDownload(attachment: TicketAttachment) {
    setBusyId(attachment.id);
    setError(null);
    try {
      await downloadTicketAttachment(attachment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download that file.');
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(attachment: TicketAttachment) {
    if (!window.confirm(`Remove “${attachment.filename}” from this ticket? This cannot be undone.`)) return;
    setBusyId(attachment.id);
    setError(null);
    try {
      await deleteTicketAttachment(ticketId, attachment.id);
      onDeleted?.(attachment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that file.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="ch247-attachments">
      <ul className="ch247-attachments__list">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="ch247-attachments__item">
            <span className="ch247-attachments__name" title={attachment.filename}>
              {attachment.filename}
            </span>
            <span className="ch247-page__hint">{formatBytes(attachment.byteSize)}</span>
            <button
              type="button"
              className="ch247-button ch247-button--outline ch247-button--small"
              onClick={() => onDownload(attachment)}
              disabled={busyId === attachment.id}
            >
              {busyId === attachment.id ? 'Downloading…' : 'Download'}
            </button>
            {canDelete && (
              <button
                type="button"
                className="ch247-button ch247-button--text ch247-button--small"
                onClick={() => onDelete(attachment)}
                disabled={busyId === attachment.id}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="ch247-status-error">{error}</p>}
    </div>
  );
}
