# Tool registry

The registry is code, not configuration: nine catalogues in
`lib/Core/Registry/Catalog/` declare every tool as a PHP array, and
`ToolRegistry` lazily globs them, memoises the result and resolves aliases.

```php
'dns/propagation' => array(
    'name'        => 'DNS Propagation Checker',
    'category'    => 'dns',
    'fields'      => array( /* ToolField definitions */ ),
    'handler'     => 'CloudHost247\\NetworkTools\\Services\\Dns\\PropagationService',
    'method'      => 'run',              // optional; omitted means run()
    'target_field'=> 'domain',           // '' for offline calculators
    'rate_tier'   => 'high_risk',        // local | standard | high_risk
    'high_risk'   => true,
    'timeout_seconds' => 30,
    'cache_seconds'   => 60,
    'exports'     => array('json', 'csv', 'pdf', 'png', 'svg'),
    'result_view' => 'propagation',
    'providers'   => array('ipinfo'),    // integration keys the tool may use
    'capabilities'=> array('udp_dns'),   // environment features it needs
    'visibility'  => 'public',           // public | customer | admin
    'notes'       => array('Results describe the resolvers queried, not every resolver on the internet.'),
)
```

## Categories

| Category | Count | Examples |
| --- | --- | --- |
| `dns` | 13 | lookup, propagation, health, mx, spf, dmarc, dkim, dmarc-generator, dnskey, ds, reverse, reverse-ip, bimi |
| `ip` | 7 | lookup, isp, my-ip, whois, domain-to-ip, ip-to-hostname, convert |
| `network` | 8 | subnet-calculator, ping, traceroute, port-checker, mac-lookup, mac-generator, asn, speed-test |
| `developer` | 8 | http-headers, server-os, smtp-test, email-header, json, encoding, url, user-agent |
| `webmaster` | 4 | broken-links, open-graph, robots-generator, serp-simulator |
| `security` | 4 | ssl, ip-blacklist, password, bin-checker |
| `domain` | 2 | punycode, search |
| `productivity` | 10 | text, lorem-ipsum, notepad, small-text, invisible-characters, runic, qr-generator, qr-scanner, color, time-card |
| `diagnostics` | 2 | domain-health, monitors |

## Aliases

Aliases exist for the names people actually type. They are resolved in
`ToolRegistry::aliases()`/`canonical()`, so an alias is never a second tool and
never has its own state:

| Alias | Canonical tool |
| --- | --- |
| `ip/blacklist` | `security/ip-blacklist` |
| `developer/headers` | `developer/http-headers` |
| `productivity/qr-code-generator` | `productivity/qr-generator` |
| `diagnostics/health` | `diagnostics/domain-health` |

## Field types

`ToolField` validates its own values, and is the first of two validation
layers (the second is the service's own guard). Supported types:
`text`, `textarea`, `select`, `checkbox`, `number`, `email`, `domain`,
`hostname`, `ip`, `url`, `port`, `ports`, `asn`, `mac`, `dkim_selector`, `cidr`,
`choice`, `password` (always `sensitive`), `header`, `json`, `integer`.

A field marked `sensitive => true` makes `ToolDefinition::hasSensitiveInput()`
true, which forces the runner to skip the cache and to leave the target label
out of history. The SMTP tester's password, the password tool's value and the
email header body are the current sensitive inputs.

## Adding a tool

1. Add the definition to the matching catalogue (or create a catalogue and
   register it in `ToolRegistry::catalogFiles()`).
2. Add `lib/Services/<Category>/<Name>Service.php` extending `Service`; implement
   `execute()` and return `ToolResult`. Raise `InvalidArgumentException` for
   invalid input — the base class converts it to `INVALID_INPUT`.
3. If it needs the environment, declare the `capabilities`; if it needs a
   provider, declare `providers` and (when it cannot work without one)
   `requires_provider => true`.
4. If it fetches a user-supplied URL, use `HttpFetcher` (never raw cURL) and if
   it shells out — it should not — the release gate will fail.
5. Add assertions to `tests/cloudhost247_network_tools/run.php` (behaviour) and,
   when the tool introduces a new invariant, to `test_static.py`.
6. Document it in `docs/tools/external-apis.md` if it talks to a third party.

The registry is checked automatically: `test_static.py` asserts every slug is
charset-safe and unique, every handler class file exists, every non-default
method exists, and every tool declares fields, exports, an explanation and a
target policy.
