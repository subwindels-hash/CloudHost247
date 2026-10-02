# SSRF protection

`lib/Core/Security/SsrfGuard.php` decides whether a target may be contacted.
`HttpFetcher` calls it for the initial request and for every redirect hop;
services that open raw sockets (ping, traceroute, port checks, WHOIS) call it
before the first packet.

## Blocked space

Both IPv4 and IPv6 are checked, including IPv4-mapped and NAT64 forms:

```
127.0.0.0/8        10.0.0.0/8          172.16.0.0/12      192.168.0.0/16
169.254.0.0/16     100.64.0.0/10       0.0.0.0/8          192.0.0.0/24
198.18.0.0/15      192.0.2.0/24        198.51.100.0/24    203.0.113.0/24
224.0.0.0/4        240.0.0.0/4
::1                ::                 fc00::/7           fe80::/10
ff00::/8           ::ffff:0:0/96 (mapped IPv4 is unwrapped and re-checked)
64:ff9b::/96 (NAT64 is unwrapped and re-checked)
```

Cloud metadata endpoints are rejected explicitly by name and address
(`169.254.169.254`, `169.254.170.2`, `metadata.google.internal`,
`metadata.azure.com`, `metadata.oraclecloud.com`, and the equivalent names), so
a DNS record cannot be used to reach them.

## Re-resolution (DNS rebinding)

`validateHost()` resolves A and AAAA records itself, requires **every** returned
address to be public, and returns the validated address list. `HttpFetcher` then
pins those addresses with `CURLOPT_RESOLVE`, so the connection cannot go to a
different address than the one that was checked — even if the attacker's DNS
answer changes between the check and the connection.

## Hostnames

* Length ≤ 253, labels ≤ 63, no leading/trailing hyphen, no whitespace, no
  `/`, `@`, `\`, `?`, `#`.
* IP literals are allowed only when the address itself passes the block list.
* A configuration allowlist (`CH247_NT_ALLOWED_HOSTS`) can restrict the module to
  specific hosts; when set, everything else is `TARGET_BLOCKED`.

## What a rejected target looks like

```json
{
  "success": false,
  "code": "TARGET_BLOCKED",
  "message": "Private, loopback and reserved addresses are blocked by this tool.",
  "retryable": false,
  "data": {}
}
```

## Deliberate escape hatch

Private space can only be enabled deliberately, by the hosting operator:

* environment variable `CH247_NT_ALLOW_PRIVATE_HOSTS=1` (see
  `configuration.md`), or
* policy array `array('allow_private' => true)` passed in code for a specific
  internal tool.

Both are visible in the health screen. There is no per-request user toggle, and
no tool exposes one.

## Tests

`tests/cloudhost247_network_tools/run.php` asserts the blocked ranges, the
metadata hosts, IPv4-mapped handling, the pin entries and the allowlist
behaviour; `test_static.py` asserts that `HttpFetcher` still consults
`SsrfGuard`, still pins with `CURLOPT_RESOLVE`, still refuses to auto-follow
redirects and never disables TLS verification.
