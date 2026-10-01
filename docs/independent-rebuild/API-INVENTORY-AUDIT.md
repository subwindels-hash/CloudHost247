# API inventory and credential audit

Companion to [API-INTEGRATIONS.md](API-INTEGRATIONS.md). This document records
the full-codebase audit that preceded and followed the introduction of the
central **API & Integrations** centre: every outbound API found, where its
credentials used to live, what changed, and what remains a tracked risk.

---

## 1. Method

Four sweeps over the whole working tree (`modules/`, `crons/`, `templates/`,
`scripts/`, top-level pages):

1. **Call sites** — `curl_init`, `curl_setopt`, `CURLOPT_URL`, `file_get_contents('http…')`,
   `stream_socket_client`, `fsockopen`, `mail(`, WHMCS `LocalAPI`.
2. **Endpoints** — every `http(s)://` literal, grouped by owning module.
3. **Credential literals** — assignments of the form
   `api_key|api_secret|secret_key|client_secret|access_token|auth_token|password|consumer_key|private_key = "…"`
   with a value of 12 or more characters, excluding obvious placeholders.
4. **Key material** — `-----BEGIN … PRIVATE KEY-----`, `AKIA[0-9A-Z]{16}`,
   `.pem` / `.key` / `.env` files tracked by Git.

Sweeps 3 and 4 are re-run on every release by
`tests/integrations/test_static.py::test_owned_code_has_no_hard_coded_credentials`
and `::test_no_private_keys_or_cloud_access_keys_are_committed`.

**Ownership rule.** Files listed in
`docs/independent-rebuild/original-file-manifest.sha256` are proprietary
third-party code covered by the integrity baseline. They are audited and
documented here but **never modified**; remediation for those is decommissioning
or replacement, not editing.

---

## 2. Owned integrations — migrated to the central registry

| API | Former credential location | Now | Provider key |
|---|---|---|---|
| RDP provider API | WHMCS server record (`serverhostname`, `serveraccesshash`) | Encrypted vault, with the WHMCS server record kept as an explicit fallback until migration completes. `CH247_RDP_ALLOWED_HOSTS` still applies. | `rdp` |
| OVHcloud API | `tblservers` username / password / access hash via WHMCS `decrypt()` | Encrypted vault when the endpoint opts in (`integration_key`, migration `1.6.0`); legacy path retained for un-migrated endpoints. | `ovh` |
| CloudHost247 LTE Proxy API | Product configuration options `configoption1` (**plaintext API key**) and `configoption3`, duplicated across four files | Encrypted vault via the single `lib/Configuration.php` builder; legacy options deprecated and read only when nothing is configured centrally. | `lteproxy` |
| Frankfurter exchange rates | Hard-coded URL in `FrankfurterProvider` | Endpoint resolved through the registry, documented public endpoint as fallback. No credential. | `frankfurter` |
| ECB reference rates | Hard-coded URL in `EcbProvider` | Endpoint resolved through the registry, documented public endpoint as fallback. No credential. | `ecb` |

---

## 3. Third-party APIs in vendor modules — covered by a registry provider

These modules are proprietary and under the integrity baseline, so their code is
untouched. The registry now provides a first-class, encrypted, testable
configuration for the same provider, which is the supported path forward.

| API observed | Vendor module(s) | Registry provider |
|---|---|---|
| OVHcloud / SoYouStart (`eu`/`ca`/`us` API hosts) | `modules/addons/soyoustart`, `modules/servers/soyoustart`, `modules/servers/soyoustart_vps`, `crons/getServer.php`, `crons/getIpStatus.php`, `crons/priceSync.php` | `ovh`, `soyoustart` |
| Microsoft Graph / Office 365 (`graph.microsoft.com`, `login.microsoftonline.com`, `outlook.office365.com`) | `modules/servers/cloudhost247_email` | `microsoft_graph` |
| Google Workspace / Gmail (`oauth2.googleapis.com`, `gmail.googleapis.com`, `admin.googleapis.com`) | `crons/emailSend.php`, `modules/servers/cloudhost247_email` | not yet registered — see §6 |
| Blockonomics (`www.blockonomics.co`, `bch.blockonomics.co`) | `modules/gateways/blockonomics.php`, `modules/gateways/callback/blockonomics.php` | `blockonomics` |
| CryptoCompare (`min-api.cryptocompare.com`) | `modules/gateways/blockonomics` | not registered — read-only public price feed, no credential |
| SMTP Hosting reseller API (`my.smtphosting.com`) | `modules/servers/Smtphosting` | not registered — see §6 |
| SMM panel v2 API | `modules/addons/smmaddon`, `modules/servers/smmprovisioning` | `smm_panel` |
| eSIM / telephony APIs (`api.airalo.com`, `api.truphone.com`) | `modules/addons/phoneservices` | not registered — see §6 |
| Public lookup services (`ip-api.com`, `api.bgpview.io`, `ipinfo.io`, `ipwho.is`, `api.whatismyip.com`, `lookup.binlist.net`, `api.qrserver.com`, `chart.googleapis.com`) | `modules/addons/CloudHost247_tools`, `cloudhost247_tools`, `cloudhost247_domain_lookup`, `tools_center` | not registered — unauthenticated public utilities, no credential to protect |
| ionCube licence loader (`get-loader.ioncube.com`) | `modules/addons/[retired-addon]`, `modules/addons/xtreme_currency_rates` | not applicable — vendor licensing |

---

## 4. Security findings

### 4.1 HIGH — hard-coded cryptographic secrets in a vendor module

`modules/addons/soyoustart/lib/Helper.php` (integrity manifest line 299,
**must not be edited**) contains:

| Line | Finding |
|---|---|
| 11 | `public $secretKey = "encryptionKey1234567891234567";` together with a fixed `$iv = "1234567891011121"` — a hard-coded symmetric key and a static initialisation vector committed to the repository. |
| ~1331 | `$secretKey = "9f8c2a7b4e6d1c3a9b0f5e8d7c6a2b1f4e3d2c1a0b9f8e7d6c5b4a3f2e1d0c9";` — a hard-coded HMAC shared secret used to sign requests to a third-party host. |
| ~1330 | `$url = "https://proxmox.shinedezign.pro/ovh_available_products/getAvailableProducts.php";` — a hard-coded third-party production endpoint outside the OVH API, reached with the shared secret above. A commented-out `members.whmcsglobalservices.com` URL sits alongside it. |

**Impact.** Anyone with read access to this repository (or to the deployed
files) holds the key that protects whatever `Helper` encrypts, and can forge
signed requests to `proxmox.shinedezign.pro`. A static IV additionally makes
identical plaintexts produce identical ciphertexts.

**Why it was not edited.** The file is part of the proprietary integrity
baseline, which this work is explicitly required not to modify or weaken.
Changing one byte would invalidate
`docs/independent-rebuild/original-file-manifest.sha256`.

**Remediation path.**

1. Treat both secrets as compromised and rotate them at their owners.
2. Decommission `modules/addons/soyoustart` in favour of
   `modules/addons/cloudhost247_ovh` plus the `ovh` / `soyoustart` registry
   providers, which store the application key, application secret and consumer
   key encrypted and never in source.
3. If the `proxmox.shinedezign.pro` product feed is still required, register it
   as its own provider (administrator-supplied HTTPS endpoint plus a vaulted
   HMAC secret) so the endpoint and secret become configuration, not code.
4. Until then, restrict filesystem read access to that module and keep the
   integrity manifest verified on every release so tampering is detected.

`tests/integrations/test_static.py::test_vendor_credential_findings_are_documented`
keeps this finding from being quietly dropped.

### 4.2 MEDIUM — resolved: plaintext API key in product configuration options

`modules/servers/cloudhost247_lteproxy` stored its API key in
`configoption1` as a `text` field. WHMCS keeps product configuration options in
cleartext, and the value was echoed into the admin settings template.

**Resolved.** The key now lives in the encrypted vault
(`lteproxy` provider). The product fields are relabelled *deprecated* /
*unused*, are no longer required, and are read only when nothing is configured
centrally. `api_secret` was dead code — the API authenticates with a bearer key
only — and is now always empty.

### 4.3 MEDIUM — resolved: duplicate API configuration systems

The LTE proxy module built its API configuration in four places
(`cloudhost247_lteproxy.php`, `ajax/proxy-operations.php`, `ajax/proxy-test.php`,
`ajax/stats.php`), each with its own copy of the defaults.

**Resolved.** All four now delegate to a single
`CloudHost247\LTEProxy\Configuration::resolve()`.
`tests/integrations/test_static.py::test_lteproxy_has_a_single_configuration_builder`
fails the build if a second builder reappears.

### 4.4 MEDIUM — resolved: hard-coded production endpoint defaults

`https://api.cloudhost247.com` was hard-coded as a fallback in twelve places
across the LTE proxy module, including the API client itself and an admin
template placeholder. An unconfigured installation would silently send bearer
tokens to that host.

**Resolved.** No endpoint default remains. `ApiClient` now refuses to construct
without a configured HTTPS endpoint and API key, raising a controlled
`ApiException` that names the central configuration screen.
`tests/integrations/test_static.py::test_no_hard_coded_production_endpoint_defaults`
enforces this.

### 4.5 LOW — accepted: unauthenticated public utility endpoints

The tools modules call public IP, ASN, BIN and QR services without credentials.
There is no secret to protect. They are listed in §3 for completeness and are
deliberately **not** registered, because adding them would create placeholder
integrations with nothing to configure.

### 4.6 Clean results

- No `-----BEGIN … PRIVATE KEY-----` block anywhere in the tree.
- No AWS access key id (`AKIA…`) anywhere in the tree.
- No `.env`, `.pem` or `.key` file is tracked; `.gitignore` already excludes
  them along with `configuration.php` and `*.zip`.
- No credential appears in any `templates/**` file, any `assets/js/**` file or
  any URL query string in owned code.
- The only `Authorization`-style headers in owned code are built at call time
  from vault material.

---

## 5. Post-change verification

| Check | Command |
|---|---|
| Credential literals in owned code | `python3 -m unittest tests.integrations.test_static` |
| Secret handling, SSRF, result sanitisation | `php tests/integrations/run.php` |
| Whole release gate | `bash scripts/release-candidate-check.sh` |
| Proprietary integrity baseline | `sha256sum --check docs/independent-rebuild/original-file-manifest.sha256` (unchanged: 2538 entries) |

---

## 6. Open items

| Item | Recommendation |
|---|---|
| Google Workspace / Gmail OAuth in `crons/emailSend.php` and `modules/servers/cloudhost247_email` | Both are manifest-protected. When those modules are rebuilt, register a `google_workspace` provider (OAuth 2.0 service account or client credentials) rather than re-introducing per-module configuration. |
| `my.smtphosting.com` reseller API (`modules/servers/Smtphosting`) | Vendor module. Register a provider when the module is rebuilt or replaced; the generic `smtp` provider already covers plain mail submission. |
| eSIM / telephony APIs (`modules/addons/phoneservices`) | Vendor module using Airalo and Truphone. Register providers when that module is brought in-house. |
| `modules/addons/soyoustart` | Decommission — see §4.1. |
| Legacy credential copies | After migrating each module, clear the WHMCS server record (RDP) and the deprecated LTE proxy product options so exactly one copy of each credential exists. |

No provider is listed as supported in the dashboard unless it has a real field
set, real encrypted storage and a real connection test. Open items above are
deliberately **absent** from the catalogue rather than stubbed.
