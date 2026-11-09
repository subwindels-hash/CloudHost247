# Email Trace fixtures — SYNTHETIC, NOT CAPTURED FROM A LIVE SERVER

Every file in this directory is hand-written from Exim's **documented** message-log format:

- `mainlog-sample.log` — one synthetic delivery lifecycle: submission, delivery, an aliased
  additional delivery, a deferral, a permanent remote refusal, a permanent local failure, a
  rejection, a `-N` suppressed delivery, a `Completed` marker, plus two lines that carry no Exim
  message id (rejected during the SMTP conversation) and must be reported as rejected.
- `queue-sample.txt` — synthetic `exim -bp` output with one deliverable message and one deferred
  message.

**What these fixtures prove:** that the parser, normaliser and status resolver implement the rules
described in their source comments, and that the rules do not drift unnoticed.

**What they do not prove:** that the deployed Exim build (cPanel's version, with its own logging
options and any operator customisation) produces lines in exactly this shape. Until the collector
has been run against a real mail server, log-format fidelity is
`IMPLEMENTED — NOT LIVE-VERIFIED` (docs/EMAIL-TRACE-CENTRE-ARCHITECTURE.md §12).

No real address, hostname, message id or customer in these files corresponds to anything. The
`203.0.113.0/24`, `198.51.100.0/24` and `example.com/org/net` ranges are the reserved documentation
ranges, used deliberately.
