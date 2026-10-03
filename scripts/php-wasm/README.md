# `php-wasm` — running the PHP release gate on a host without PHP

`scripts/release-candidate-check.sh` lints **785 PHP targets** and runs **18 behavioural
suites** (`tests/*/run.php`). It needs a PHP binary, and one leg of the CI matrix is
**PHP 7.4** — the version that catches PHP-8-only syntax. On a machine where PHP cannot be
installed, that entire half of the gate is unrunnable and every PHP claim in the build notes
stays unverified.

This directory supplies a `php` that needs only **Node (>= 20)**, by running the real PHP
interpreter compiled to WebAssembly.

## Usage

```bash
# drop-in replacement — no other script needs to change
scripts/php-wasm/php -l modules/addons/cloudhost247_core/lib/Support/Logger.php

# reproduce the 7.4 leg (default is 8.2)
PHP_WASM_VERSION=7.4 scripts/php-wasm/php tests/foundation/run.php

# a full sweep, both matrix versions
scripts/php-lint-targets.sh | xargs -r -n1 scripts/php-wasm/php -l
PHP_WASM_VERSION=7.4 bash -c 'scripts/php-lint-targets.sh | xargs -r -n1 scripts/php-wasm/php -l'
```

To use it as the gate's `php`, put it first on `PATH`:

```bash
mkdir -p /tmp/ch247-bin && ln -sf "$PWD/scripts/php-wasm/php" /tmp/ch247-bin/php
PATH=/tmp/ch247-bin:$PATH bash scripts/release-candidate-check.sh
```

Dependencies install automatically on first use (a few seconds). `node_modules/` is
git-ignored; nothing here is committed.

## What this shim is responsible for

- **Real exit codes.** The upstream `php-wasm-cli` package calls `process.exit(0)` in a
  `finally` block, so it reports success even for a fatal parse error — useless for a gate
  that has to fail a build. `shim.mjs` propagates the interpreter's actual status: `php -l`
  on a syntax error exits non-zero (255 on 8.x), matching php-cli.
- **OpenSSL key material.** The wasm OpenSSL build cannot open its compiled-in config path,
  so `openssl_pkey_new()` fails for every key type and the `passkey` and
  `cloudhost247_email` suites fail for environmental reasons. Pointing `OPENSSL_CONF` at a
  readable copy of the system config fixes it; an empty or minimal config does not.
- **Both matrix versions.** `PHP_WASM_VERSION` selects 8.5 / 8.4 / 8.3 / 8.2 / 8.1 / 8.0 / 7.4.

## Known limitations

- PHP **extensions** are whatever the wasm build ships (curl, openssl, mbstring, PDO, pdo_sqlite,
  dom, gd, mysqli, soap, …). `ext-intl` is **not** included, so a file that needs it will fail
  here but pass on a host with it. No first-party PHP in this repository requires it.
- Performance is roughly **0.5 s per process start**, so lint the 785 targets with
  `xargs -P 8` rather than serially.
- `gethostbynamel()` resolves through the sandbox's DNS proxy, which returns private
  addresses for public hostnames. Suites that assert SSRF refusals against a live DNS lookup
  will therefore fail here for environmental reasons; run them on a host with real DNS.
- This is a **verification aid**, not a substitute for the PHP the module actually runs on.
  The gate's first real run on a host with native PHP 7.4 remains the authoritative signal.

## Provenance

`@php-wasm/node` and `@php-wasm/universal` 3.1.56, from the WordPress Playground project
(GPL-2.0-or-later). Pinned by exact version; they are build tooling and are never loaded by
any code this repository ships.
