# Hosting and cPanel limitations

The platform is designed to run inside ordinary shared/cPanel hosting, where
several things a desktop diagnostic tool would take for granted are simply not
available. None of them are faked: each is detected at runtime by
`lib/Core/Result/Capability.php` and surfaced as a state.

## Capability states

* `AVAILABLE` — the feature exists and the tool may use it.
* `UNAVAILABLE_IN_THIS_ENVIRONMENT` — the feature does not exist here (for
  example raw ICMP sockets when the hosting account cannot create them).
* `CONFIGURATION_REQUIRED` — the feature exists but an administrator has not
  configured what it needs (a provider, a key, a resolver).

Tools declare the capabilities they need; `ToolRunner::capabilityGap()` turns a
missing one into `SERVICE_UNAVAILABLE` (or `CONFIGURATION_REQUIRED`) with the
reason, and the admin health screen lists every capability and its state.

## Known constraints and how they are handled

| Constraint | Consequence | Handling |
| --- | --- | --- |
| Raw sockets (`socket_create`, `SOCK_RAW`) may be disabled | ICMP ping cannot send echo requests | Falls back to a TCP connect probe to 443 (or the port you choose) and labels the result "TCP probe", never "ICMP echo" |
| `exec`/`proc_open`/`shell_exec` disabled or banned | No `ping`, `traceroute`, `dig`, `whois` binaries | Everything is implemented in PHP: DNS over UDP/TCP/DoT/DoH, WHOIS over TCP 43, traceroute via UDP/TCP with TTL windows where the socket API allows it |
| Traceroute needs UDP or ICMP sockets | Some hops cannot be measured | Reports the hops it actually measured, marks the rest, and states the method used |
| Outbound port 25 blocked by providers | MX port-25 probes fail | Reported as a blocked port (`SERVICE_UNAVAILABLE` with the reason), never as "no mail server" |
| Outbound port 43 blocked | WHOIS fails | `whois_tcp43` capability reported; the tool explains the block instead of returning an empty record |
| No `intl` extension | `idn_to_ascii`/`idn_to_unicode` missing | The module ships its own Punycode implementation (RFC 3492) and uses it when `intl` is absent |
| No `bcmath`/`gmp` | Big-integer maths | The module ships decimal arithmetic for IPv6 counts, so 2^80 is exact without them |
| Short `max_execution_time` | Long crawls/traceroutes are killed | Every loop is bounded and returns `PARTIAL` with the work actually done |
| No cron access | Health checks and monitors do not run automatically | All of it is also triggerable from the admin screens; the cron file is optional |
| No shell access and no Composer | Deployable by upload only | The module has no Composer dependency and no build step; see `deployment.md` |
| Shared hosting rate limits | Upstream providers may throttle | Requests are retried within a bounded budget and `RATE_LIMITED`/`PROVIDER_ERROR` are returned with the provider's own wording |

## What is never done

* No port scanning beyond the explicit port set the user entered (≤ 32 ports)
  and the SSRF policy.
* No unbounded ping/traceroute/crawl.
* No privilege escalation attempt, no `su`, no reading of system files.
* No fabricated substitute when a capability is missing — the state is reported.

## Deploy checks

The admin **Health** tab shows, per capability, whether the feature is available
here, along with the environment (PHP version, extensions, cron last run). The
same information is in the tool page footer when a tool is unavailable, so a
customer sees *why* instead of a generic error.
