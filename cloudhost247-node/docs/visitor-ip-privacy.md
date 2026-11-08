# Visitor IP and privacy indicator

The React header requests `/api/v1/visitor/ip` on load, every five minutes while visible, and on reconnect or return to a visible tab. The address stays in component state; it is neither stored nor sent to analytics or a third party by this feature. The endpoint has `Cache-Control: private, no-store` plus `Vary` for the supported edge/forwarding headers, does not query a database, and does not log its response or address. Application request IP and common forwarding-header fields are redacted by the logger. Infrastructure access logs, reverse proxies, CDN logs, browser extensions and unrelated analytics are outside this feature's control and must be reviewed separately. The endpoint deliberately reports privacy status `unknown`: seeing an IP cannot prove whether VPN, proxy, or anonymity protection is used. No percentage or guarantee is shown.

## One boundary, every surface

Detection is resolved in exactly one place — `resolveVisitorIpDetail()` in `src/routes/visitor-ip.ts` — and every surface that names a visitor's address goes through it:

| Surface | Route | What it shows |
| --- | --- | --- |
| Menu-bar indicator | `GET /api/v1/visitor/ip` | the verified address, or a `reason` |
| Country beside the indicator | `GET /api/v1/currency/geo-country` | GeoLite2 country for the same verified address |
| Tools → IP Tools → "What Is My IP" | `GET /api/tools/my-ip` | the same verified address, plus the request's own headers |
| Marketing consent jurisdiction | `src/marketing/consent-service.ts` | the same verified address |

They cannot disagree, because none of them resolves an address any other way. In particular nothing reads Fastify's `request.ip`: the main app sets `trustProxy: true` globally, which makes `request.ip` the leftmost `X-Forwarded-For` value — a value any caller can set. "What Is My IP" used to do exactly that, and behind a reverse proxy with no forwarding header it reported the *server's own* peer address (reproduced as `127.0.0.1`) as the visitor's public IP.

## Why nothing was detected

"Unverified" is not one undifferentiated state, and the menu bar no longer pretends it is. Every response carries a coarse `reason` so the widget can explain itself; the vocabulary is deliberately small and never discloses the configured allowlist, the peer address, or which hop in a chain failed:

| `reason` | Meaning | Menu bar shows |
| --- | --- | --- |
| `detected` | a public address was verified against the boundary | `IP: <address>` |
| `disabled` | `VISITOR_IP_MODE=off`; the deployment never turned detection on | `IP: not enabled` |
| `unverified` | detection is on, but this connection's boundary could not be verified (untrusted peer, missing/invalid/oversized forwarding chain, unparsable allowlist) | `IP: unverified` |
| `not_public` | an address was verified but it is loopback, private, link-local, CGNAT or reserved — not globally routable, so it is not presented as anyone's public IP | `IP: not public` |

The full sentence for each reason is in the widget's visually-hidden live-region text and its `title` tooltip. `not_public` deliberately includes the RFC 5737 documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24): they are `reserved` to the address classifier, so a test or edge that injects one is told `not_public`, not given a fake visitor.

A widget or caller must treat any `reason` it does not recognise as "unreachable" rather than inventing one; the frontend whitelists the four above and falls back to `IP: unavailable`.

## Deployment configuration (required)

Production defaults to `VISITOR_IP_MODE=off` and returns `ip: null`. This is intentional: the Node app is normally behind cPanel/Apache, and blindly using the socket or trusting an arbitrary forwarding header could reveal the server/proxy address or allow spoofing. The UI then displays `IP: not enabled`. The embedded local preview runner (`npm run dev:api`) is the exception: if the mode is unset, it enables `trusted-proxy` for local-only proxy hops so the dev preview can exercise detection. This convenience is never part of production `src/server.ts`; explicitly setting `VISITOR_IP_MODE=off` always disables detection. To enable real production detection, an operator must verify the topology and choose **one** of these modes:

* `VISITOR_IP_MODE=direct`: only when the Node process is directly connected to visitors, with no reverse proxy, CDN, load balancer or NAT gateway in front. The public socket address is used; forwarded headers are ignored.
* `VISITOR_IP_MODE=trusted-proxy`: set `VISITOR_IP_TRUSTED_PROXIES` to a comma-separated list of specific trusted peer IPs and/or CIDR ranges. This must include every legitimate proxy hop from the app back to the edge. Example syntax: `127.0.0.1,::1,10.20.0.0/24` (examples are not recommended production networks). At the network edge, ensure the proxy overwrites untrusted inbound `X-Forwarded-For`, or appends the observed client address correctly, and that no untrusted host can connect through an allowlisted peer. The resolver accepts a single authoritative `CF-Connecting-IP` or `X-Real-IP` from an allowlisted peer, or safely walks `Forwarded` / `X-Forwarded-For` chains from right to left, stopping at the first untrusted public address. Missing, malformed, overly long or entirely trusted chains are rejected; invalid allowlists fail closed. Do not trust broad networks or the whole internet. Verify IPv4, IPv6 and spoofed headers from outside the proxy before enabling.

Because a bad `VISITOR_IP_TRUSTED_PROXIES` fails closed rather than crashing, it would otherwise disable detection silently and forever. `npm run env:check` therefore treats an unparsable allowlist (or a `/0`) as a hard error and prints which mode is active and what it implies. Run it after changing either variable and before restarting.

## Caching

Both this endpoint and the `my-ip` tool answer per-visitor, so both send `Cache-Control: no-store` and neither is ever `public` or `s-maxage`. That includes the tool's `GET` route: an intermediary (Cloudflare, Apache `mod_cache`, a cPanel proxy) storing one visitor's address and request headers and replaying them to the next visitor would be a privacy incident, not a performance optimisation. Public result caching for the other tools remains the typed executor cache's job, governed per tool by `cacheSeconds`.

## What the tool echoes, and what it withholds

`GET /api/tools/my-ip` shows a visitor the headers their own browser sent — useful for diagnosing proxies and TLS — with two limits. The address in `ipv4`/`ipv6`/`detectedAddress` is only ever the verified one; the raw `X-Forwarded-For` chain is reported separately in `forwardedFor`, labelled as received and never promoted to an answer. And credential-shaped headers (`cookie`, `set-cookie`, `authorization`, `proxy-authorization`, `x-api-key`) are echoed as keys with their values replaced by `«redacted»`: repeating an `HttpOnly` session cookie inside a readable JSON body would hand that credential to any script on the page, defeating the protection that made it unreadable.

This feature currently covers the React/Node site; the separate WHMCS/Smarty templates do not use this endpoint.
