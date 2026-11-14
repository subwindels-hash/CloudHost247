import { ChangeEvent, useCallback, useState } from 'react';
import type { TicketAttachmentInput } from '../lib/account-types';

/** Mirrors ALLOWED_UPLOAD_TYPES / MAX_TICKET_ATTACHMENT_BYTES in src/lib/media-upload.ts. */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,application/zip,text/plain,text/csv';
const MAX_BYTES = 5 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/** `data:image/png;base64,AAAA` → `AAAA`. The server wants the payload, not the URL envelope. */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * One-file picker for a support ticket message.
 *
 * The checks here are convenience, not security: the server re-derives the type from the bytes,
 * re-checks the size on the decoded payload and normalises the filename. Catching an obviously
 * wrong file in the browser only saves a round trip.
 *
 * Base64 rather than multipart, matching every other upload surface in this platform.
 */
export default function TicketAttachmentPicker({
  attachment,
  onChange,
  disabled,
}: {
  attachment: TicketAttachmentInput | null;
  onChange: (attachment: TicketAttachmentInput | null) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const onPick = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;

      setError(null);
      if (file.size > MAX_BYTES) {
        setError(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 5 MB.`);
        onChange(null);
        return;
      }

      setReading(true);
      try {
        const dataUrl = await readAsDataUrl(file);
        onChange({ base64: stripDataUrlPrefix(dataUrl), contentType: file.type, filename: file.name });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that file.');
        onChange(null);
      } finally {
        setReading(false);
      }
    },
    [onChange]
  );

  return (
    <div className="ch247-attachment-picker">
      <label className="ch247-field-label" htmlFor="ticket-attachment">
        Attach a file (optional)
      </label>
      <input
        id="ticket-attachment"
        type="file"
        accept={ACCEPT}
        onChange={onPick}
        disabled={disabled || reading}
      />
      <p className="ch247-page__hint">
        PNG, JPEG, WebP, GIF, PDF, ZIP, TXT or CSV, up to 5 MB. One file per message. Files are
        scanned and re-typed server-side; SVG and HTML are not accepted.
      </p>
      {reading && <p className="ch247-page__hint">Reading file…</p>}
      {attachment && (
        <p className="ch247-inline-actions">
          <span className="ch247-badge">{attachment.filename}</span>
          <button
            type="button"
            className="ch247-button ch247-button--text ch247-button--small"
            onClick={() => onChange(null)}
            disabled={disabled}
          >
            Remove
          </button>
        </p>
      )}
      {error && <p className="ch247-status-error">{error}</p>}
    </div>
  );
}
