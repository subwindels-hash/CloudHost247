# CloudHost247 Module Manager

**Addon:** `modules/addons/cloudhost247_modules` · **Namespace:**
`CloudHost247\ModuleManager\` · **Admin page:** Super Admin → Addons →
CloudHost247 Module Manager (Modules)

The Module Manager is the platform service for getting new code onto a
CloudHost247/WHMCS installation. It replaces "upload a ZIP over SSH, unzip it
into `modules/servers`, hope it was the right build" with an auditable pipeline
that validates the package before anything touches the filesystem, installs it
transactionally, and can prove afterwards that what is on disk is exactly what
was installed.

Nothing in this document describes intent only: every control below is
implemented, exercised by `tests/modules/run.php` (198 assertions) and enforced
at source level by `tests/modules/test_static.py`.

---

## 1. Threat model

A module package is untrusted input that becomes executable server-side code.
The design assumes the uploaded archive is hostile and that the uploading
administrator may have been compromised.

| Threat | Control |
| --- | --- |
| Arbitrary code execution at upload time | The package is never included, evaluated or shelled out to. `module.json` is parsed with `json_decode` and validated as data. No installer hook, no post-install script, no serialized payload. |
| Zip-slip / path traversal | Entry names are rejected on inspection (`../`, absolute, `C:`, backslash, null byte) and the destination is re-derived and re-verified per entry at write time. `ZipArchive::extractTo()` is never called. |
| Symlink attack | Entries whose unix mode marks them as links, devices, FIFOs or sockets are rejected; the extractor refuses to write through a symlink at the destination or any parent. |
| Privilege escalation via permissions | setuid/setgid/sticky and executable modes are rejected on inspection; every extracted file is written `0644` regardless of what the archive claims. |
| Decompression bomb | Caps on entry count (3000), uncompressed total (128 MiB), single entry (32 MiB) and compression ratio (200:1). |
| Overwriting core or another module | The install path is derived from the validated module type plus the module id — `modules/<type>/<id>`. A package cannot name its own destination, and platform ids (`cloudhost247_core`, `cloudhost247_modules`, `cloudhost247_integrations`, `vendor`, `includes`, …) are reserved. |
| Silent overwrite of an existing module | Existing version vs uploaded version is shown; install becomes update/downgrade/reinstall; downgrade needs a second explicit confirmation. |
| Partial install left active | Backup → extract → verify → register → commit, with rollback on any failure. A module is never enabled automatically. |
| Tampering after install | Every installed file's SHA-256 is recorded; Verify re-hashes them on demand and after every install. |
| Privilege abuse | Seven capabilities, seeded Super-Admin-only at activation, enforced per operation and reflected in the UI. |
| Credential leakage | The manifest may not declare secret settings. Credentials go to the central API & Integrations vault. Logs record checksums, versions, admin id and IP — never secrets. |

---

## 2. Pipeline

```
Upload → Validate → Inspect → Compatibility Check → Dependency Check
      → Security Check → Preview → Confirm → Backup → Install → Register
      → Configure → Enable → Health Check
```

### 2.1 Upload (`lib/Package/UploadReceiver.php`)

1. `$_FILES` error code mapped to an administrator-readable message.
2. `is_uploaded_file()` — a submitted path that is not a genuine PHP upload is
   rejected (injected seam for tests only).
3. Filename sanitised; must end in `.zip` (`payload.zip.php` is rejected).
4. Real byte size between 128 B and `CH247_MODULE_MAX_UPLOAD_BYTES`
   (default 32 MiB, clamped to 64 KiB – 256 MiB).
5. ZIP signature bytes (`PK\x03\x04`, `PK\x05\x06`, `PK\x07\x08`).
6. `finfo` MIME allowlist (`application/zip`, `application/x-zip-compressed`,
   `application/octet-stream`, `multipart/x-zip`).
7. SHA-256 of the received bytes. This checksum identifies the package in the
   ledger, the preview, every log line and the audit trail.

### 2.2 Inspect (`lib/Package/ArchiveInspector.php`)

The archive is opened with `ZipArchive::CHECKCONS` and only the central
directory is read — **no bytes are written to disk at this stage**. Rejections:

- name: traversal, absolute, drive-letter, backslash, null byte, control
  characters, > 200 chars, > 12 path segments, duplicate (case-insensitive);
- structure: forbidden segments (`.git`, `.github`, `.svn`, `.idea`, `.ssh`,
  `.aws`, `__MACOSX`, `node_modules`, `.htaccess`, `.htpasswd`, `.user.ini`,
  `web.config`, `.npmrc`, `.netrc`, `.env`);
- type: symlink, device, socket, FIFO, directory declared as a file;
- permissions: setuid, setgid, sticky, any executable bit;
- encryption: any entry with an encryption method set;
- size: > 3000 entries, > 128 MiB total, > 32 MiB per entry, ratio > 200:1
  on entries larger than 1 MiB;
- file type: only `php tpl json md txt html htm css js map png jpg jpeg gif svg
  webp ico bmp woff woff2 ttf otf eot xml yml yaml csv lang po mo sql dist lock`
  plus bare `LICENSE`/`README`/`CHANGELOG`/… are allowed. `phar phtml php3..php7
  phps inc sh bash bat ps1 exe dll so dylib bin msi py pl rb cgi jar class pem
  key p12 pfx crt cer env ini conf` are explicitly forbidden.

A single wrapper directory (`my_module/…`) is stripped. `module.json` must be
at the resulting root.

### 2.3 Manifest (`lib/Manifest/Manifest.php`)

```jsonc
{
  "schema": "cloudhost247-module/v1",
  "id": "example_rdp",                       // ^[a-z][a-z0-9_]{2,63}$, not reserved
  "name": "Example RDP Provisioning",
  "version": "1.2.0",                        // dotted numeric, optional -suffix
  "description": "Provisions RDP servers.",
  "author": "Example Ltd",
  "author_url": "https://example.test",
  "license": "Commercial",
  "type": "server",                          // addon|server|gateway|registrar|report|widget|notification
  "entry_point": "example_rdp.php",          // relative .php inside the module
  "min_application_version": "8.0",
  "max_application_version": "",
  "min_php_version": "7.4",                  // required
  "max_php_version": "8.3",
  "php_extensions": ["curl", "json"],
  "dependencies": {
    "cloudhost247_core": ">=1.1.0",
    "cloudhost247_integrations": { "min_version": "1.0.0", "optional": true }
  },
  "conflicts": ["legacy_rdp"],
  "permissions": ["services.provision", "services.suspend"],
  "migrations": { "required": true, "tables": ["mod_example_rdp_servers"] },
  "configuration": {
    "required": true,
    "fields": [
      { "key": "timeout", "label": "API timeout", "type": "number", "required": true, "help": "Seconds" }
    ]
  },
  "integrations": {
    "providers": ["example_rdp_api"],
    "definitions": [
      {
        "key": "example_rdp_api",
        "label": "Example RDP API",
        "category": "provisioning",
        "vendor": "Example Ltd",
        "auth": "bearer",
        "base_url": "",
        "health": { "method": "GET", "path": "/v1/ping" }
      }
    ]
  },
  "health_check": { "files": ["lib/Api/Client.php"] },
  "documentation": "https://example.test/docs/rdp"
}
```

Hard rejections: missing/invalid `id`, `name`, `version`, `author`, `license`,
`type`, `min_php_version`; an `entry_point` that is absolute, traverses, or is
not `.php`; a maximum version below the minimum; a dependency id or version that
does not parse; a migration table not matching `^mod_[a-z0-9_]{1,56}$`;
**any configuration field marked `"secret": true`**.

Unknown keys are not an error — they are recorded and displayed in the preview
as "keys this platform does not understand and will ignore", so a package can
never smuggle behaviour through an unrecognised field.

`"migrations": {"required": true}` is a **declaration**, not an execution hook.
The Module Manager does not run a third-party module's migrations; the module
runs its own through `MigrationRunner` when WHMCS activates it. The preview says
so explicitly.

### 2.4 Compatibility (`lib/Registry/CompatibilityChecker.php`)

Live `PHP_VERSION`, live `get_loaded_extensions()`, and the application version
from `WHMCS_VERSION` or `WHMCS\Application::getVersion()`. If the application
version cannot be detected it is reported as *not detected* and marked FAIL in
the check table with a warning — never silently treated as compatible, and never
fabricated.

### 2.5 Dependencies (`lib/Registry/DependencyResolver.php`)

Resolved against installed modules **and** platform components (whose versions
are read from the real addon files). Each dependency resolves to
`satisfied | missing | version | disabled`, and declared conflicts that are
installed are blockers. Optional dependencies warn instead of blocking.

### 2.6 Preview (`lib/Install/InstallationPlan.php`)

```
Module               Example RDP Provisioning (example_rdp)
Version              1.2.0            (installed: 1.1.0)
Author / License     Example Ltd / Commercial
Type                 Server / provisioning module
PHP                  7.4 – 8.3
Install path         modules/servers/example_rdp
Files                34 (412.5 KiB)      new 6 · replaced 22 · unchanged 6 · removed 2
Database changes     Yes — mod_example_rdp_servers
Configuration        Yes
Permissions          services.provision, services.suspend
API integrations     example_rdp_api
Checksum             9f2c…  (full SHA-256 shown)
Compatibility        PASS/FAIL per check
Dependencies         PASS/FAIL per dependency
                          [ Cancel ]   [ Install Module ]
```

Blockers disable the action entirely. Warnings (downgrade, orphaned files,
declared migrations, unknown manifest keys) are shown but may be accepted.

### 2.7 Install (`lib/Install/Installer.php`, `InstallationTransaction.php`)

1. `createBackupDirectory()` — a fresh `0700` directory in package storage.
2. `begin()` — writes `installation.json`: module id/name/type, action,
   `version_from` → `version_to`, package checksum, install path, declared
   tables, declared integrations, admin id, timestamp, stage.
3. `clearDestination()` — the existing directory is copied to
   `<backup>/previous/` and then emptied (inside its boundary only).
4. Extraction, per entry, through `SecureExtractor`.
5. `verifyInstalledTree()` — the declared entry point and every declared
   health-check file must exist.
6. Registry row + per-file SHA-256 manifest written **after** the files are on
   disk and verified.
7. `commit()` — snapshot stage set to `committed`.

Any failure → `rollback()`: extracted files are removed, the previous version is
restored from the backup, the snapshot records the reason, and a
`ModuleException` with reason `rollback_performed` is raised. The message states
whether the previous version was restored. On a failed first install no module
directory is left behind and no registry row is created.

### 2.8 Register, configure, enable, verify

- A newly installed module is **disabled**. Enabling is a separate, capability-
  gated action that re-checks dependencies, compatibility and file presence.
- Disabling never deletes files or data and is blocked while an enabled module
  depends on it.
- `ModuleManager::registerIntegrations()` turns each manifest integration
  definition into a real provider in the API & Integrations registry, so
  credentials are entered once, encrypted in the central vault, and connection-
  tested by the existing centre. A module never stores its own credentials.
- Health: `healthy | modified | missing_files | not_installed`, computed by
  re-hashing the installed files.

### 2.9 Uninstall

The impact screen lists the exact file count and directory, the declared
database tables (**retained**), declared API integrations (credentials stay in
the vault), dependent modules (which block the uninstall) and whether the module
is currently enabled — with an explicit warning that active services provisioned
through it will stop working. The administrator must tick the confirmation and
type the module id.

Only files recorded in the installation manifest are deleted; anything an
operator added afterwards is left in place. Tables are never dropped; customer
and service data are never touched.

---

## 3. Permissions

| Capability | Default |
| --- | --- |
| `modules.view`, `modules.upload`, `modules.install`, `modules.update`, `modules.toggle`, `modules.uninstall`, `modules.configure` | Full administrator roles + the role that activated the addon |

`AdminGuard::requireCapability()` falls back to WHMCS addon-role access when a
capability has no policy row, which is too permissive for installing code.
Activation therefore seeds an explicit row per capability
(`CapabilityPolicy::seedDefaults()`); existing rows are never overwritten.
Adjust them under **CloudHost247 Foundation → Capability policy**. The UI hides
actions the current role does not hold, and the server enforces them regardless.

---

## 4. Audit and logs

`mod_cloudhost247_module_events` records `upload, reject, install, update,
reinstall, enable, disable, uninstall, rollback, health_check` with result
(`success|failed|denied`), version from/to, package checksum, detail, admin id,
peer IP (`REMOTE_ADDR` only — forwarded headers are not trusted) and a
correlation id. The same actions are written to the platform audit trail
(`mod_cloudhost247_audit_events`) through `AuditLogger`, which redacts through
`SecretPolicy`. A rejected upload is recorded with its reason; the package is
never stored.

---

## 5. Deployment

```bash
# Outside the document root, writable by the web user
export CH247_MODULE_STORAGE=/var/cloudhost247/modules
export CH247_MODULE_MAX_UPLOAD_BYTES=33554432     # optional
```

Resolution order: `CH247_MODULE_STORAGE` → `$ch247_module_storage` in
`configuration.php` → `$attachments_dir/cloudhost247-modules`. Directories are
created `0700` with `.htaccess` deny rules and an empty `index.html`; if the
only writable location is inside the web root, the admin page says so and asks
for the environment variable. If nothing is writable, uploads are disabled and
the reason is displayed — the page never pretends storage is available.

PHP requirements: `zip`, `fileinfo`, `hash`, `json`. Without `zip` the page
reports that packages cannot be inspected or installed.

Tables are created by migration `1.0.0`
(`modules/addons/cloudhost247_modules/migrations/V100.php`), registered in
`scripts/validate-migrations.py`. Deactivating the addon retains all data.

---

## 6. Packaging checklist

1. One top-level directory named after the module id.
2. `module.json` at its root; entry point present and named in the manifest.
3. No executable bits, no symlinks, no `.git`, no `.env`, no `.htaccess`.
4. Declare every API the module calls under `integrations` so credentials are
   vaulted centrally; never ship credentials in the package.
5. Declare database tables under `migrations.tables` (`mod_…` prefixed) and run
   them from the module's own activation through `MigrationRunner`.
6. `zip -r example_rdp-1.2.0.zip example_rdp` — then upload and read the preview.

## 7. Verification

| Check | Command |
| --- | --- |
| Behavioural suite (upload → rollback → uninstall) | `php tests/modules/run.php` |
| Source-level security policy | `python3 -m unittest tests.modules.test_static` |
| Migration policy | `python3 scripts/validate-migrations.py` |
| Full release gate | `bash scripts/release-candidate-check.sh` |
