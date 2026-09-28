import type { TicketMessage } from '../lib/account-types';

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Renders a ticket's message thread. `isSelf` (computed server-side per docs/API_CUSTOMER_APP.md
 * — never derived from a raw author id client-side) decides which side of the thread a message
 * appears on and whether it's labeled "You" or by role. */
export default function TicketThread({ messages }: { messages: TicketMessage[] }) {
  if (messages.length === 0) {
    return <p className="ch247-page__hint">No messages yet.</p>;
  }

  return (
    <div className="ch247-thread">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`ch247-thread__message${message.isSelf ? ' ch247-thread__message--self' : ''}`}
        >
          <div className="ch247-thread__meta">
            <strong>{message.isSelf ? 'You' : message.authorRole === 'customer' ? 'Customer' : 'Support'}</strong>
            <span>{formatTimestamp(message.createdAt)}</span>
          </div>
          <p className="ch247-thread__body">{message.body}</p>
        </div>
      ))}
    </div>
  );
}
