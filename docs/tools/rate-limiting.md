# Rate limiting and abuse protection

`lib/Core/Security/RateLimiter.php` applies four dimensions to every tool run,
each with a count and a window in seconds:

| Dimension | Scoped to | Why |
| --- | --- | --- |
| `ip` | The caller's IP | Stops a single client flooding the platform |
| `client` | The signed-in customer | Stops one account spreading load across IPs |
| `tool_ip` | One tool × one IP | The expensive tool cannot be hammered |
| `tool_global` | One tool, everyone | Protects shared capacity and upstream providers |

## Tiers

Defaults (per minute):

| Tier | ip | client | tool_ip | tool_global | Used by |
| --- | --- | --- | --- | --- | --- |
| `local` | 120 | 120 | 60 | 1200 | Offline calculators (subnet maths, punycode, text, colour …) |
| `standard` | 60 | 60 | 20 | 600 | Lookups, parsers, single DNS queries |
| `high_risk` | 10 | 10 | 4 | 120 | ping, traceroute, port checks, SMTP tests, crawls, bulk propagation, HTTP fetches |

A tool is `high_risk` when it sends packets to a third party or can be used for
amplification. The registry sets both the tier and the flag; the release suite
asserts that every flagged tool is on the strict tier.

## Overrides

An administrator can override any dimension per tool in
**Admin → CloudHost247 Network Tools → Tools** (`rate_limits` in the tool state
row). Overrides are validated (two integers) and clamped; they cannot make a
high-risk tool looser than the standard tier by accident because the runner
re-derives the limits from the definition on every run.

## Behaviour when limited

```json
{
  "success": false,
  "code": "RATE_LIMITED",
  "message": "Too many requests for this tool. Try again in 42 seconds.",
  "retryable": true,
  "data": {}
}
```

HTTP 429 with `Retry-After` semantics, nothing cached, and the attempt is
recorded for the abuse screen. Limits are counted in
`mod_cloudhost247_nt_tool_rate_limits`; counters are pruned by the cron worker.

## Abuse thresholds

`abuse_block_threshold` (default 5) consecutive failures — validation failures
excluded — create an abuse event; repeated events apply a temporary block for
the offending IP or account, with the reason recorded for the admin. Blocked
traffic is answered with `RATE_LIMITED` or `ACCESS_DENIED` and is visible in
**Admin → CloudHost247 Network Tools → Abuse**.

## Concurrency and deadlines

Every tool has a timeout (`timeout_seconds`, default from
`default_timeout_seconds`) and every expensive loop has a hard bound:
ping count ≤ 5, traceroute hops ≤ 30, ports ≤ 32 per request, crawl ≤ 10 pages /
250 links / 25 seconds / 512 KiB per response, HTTP body ≤ 256 KiB, speed test
≤ 8 MB and ≤ 20 seconds. When a bound is reached the tool returns the partial
result it actually has, marked `PARTIAL` with a warning — it never pads a result
to look complete.
