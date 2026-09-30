/**
 * Renders the lifecycle state of the operating system a server is running.
 *
 * Reaching end of life never disables a customer's server, so this is an informational notice,
 * not an error: it explains what changed and points at reinstall, which is the destructive
 * action the customer must opt into deliberately.
 */
export interface OsLifecycleNoticeProps {
  status: string | null | undefined;
  displayName: string | null | undefined;
  endOfLifeDate: string | null | undefined;
  compact?: boolean;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
}

export default function OsLifecycleNotice({ status, displayName, endOfLifeDate, compact }: OsLifecycleNoticeProps) {
  if (!status || !['MAINTENANCE', 'EOL_WARNING', 'EOL', 'ARCHIVED'].includes(status)) return null;
  const name = displayName ?? 'This operating system';
  const date = formatDate(endOfLifeDate);
  const tone = status === 'EOL' || status === 'ARCHIVED' ? 'is-eol' : status === 'EOL_WARNING' ? 'is-warning' : 'is-maintenance';
  const label =
    status === 'MAINTENANCE' ? 'Maintenance only'
      : status === 'EOL_WARNING' ? 'Approaching end of life'
        : status === 'EOL' ? 'End of life' : 'Retired';

  if (compact) return <span className={`ch247-os-lifecycle__tag ${tone}`}>{label}</span>;

  const detail =
    status === 'MAINTENANCE'
      ? `${name} receives maintenance updates only. Your server is unaffected.`
      : status === 'EOL_WARNING'
        ? `${name} reaches end of life${date ? ` on ${date}` : ''}. Your server keeps running, but plan a reinstall onto a supported version before vendor security updates stop.`
        : `${name} reached end of life${date ? ` on ${date}` : ''} and no longer receives vendor security updates. Your server keeps running and your data is untouched; reinstall onto a supported version when you are ready.`;

  return (
    <div className={`ch247-os-lifecycle ${tone}`} role="status">
      <strong>{label}</strong>
      <span>{detail}</span>
      {(status === 'EOL' || status === 'ARCHIVED' || status === 'EOL_WARNING') && (
        <small>Reinstalling erases everything on the server. Back up your data first.</small>
      )}
    </div>
  );
}
