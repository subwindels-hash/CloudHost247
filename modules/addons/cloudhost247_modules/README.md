# CloudHost247 Module Manager

Super Admin → **Modules**. Upload, validate, install, update, enable, disable and
uninstall CloudHost247 modules from the WHMCS admin area, without extracting
archives over SSH or cPanel.

Installing a module puts executable code on the server. Everything on this page
is therefore treated as a privileged security operation: authenticated
administrator, per-action capability, CSRF token, archive inspection **before**
extraction, confined extraction, a pre-change backup, transactional rollback,
and an audit record of the outcome whether it succeeded or failed.

## Workflow

```
Upload → Validate → Inspect → Compatibility Check → Dependency Check
      → Security Check → Preview → Confirm → Backup → Install → Register
      → Configure → Enable → Health Check
```

| Step | What actually happens | Code |
| --- | --- | --- |
| Upload | `is_uploaded_file`, PHP upload status, `.zip` name, size floor/ceiling, ZIP signature bytes, `finfo` MIME allowlist, SHA-256 of the received bytes | `lib/Package/UploadReceiver.php` |
| Validate / Inspect | Central-directory scan only — entry names, sizes, compression ratios, permission bits. No extraction | `lib/Package/ArchiveInspector.php` |
| Manifest | `module.json` parsed as **data**; no PHP from the package is executed | `lib/Manifest/Manifest.php` |
| Compatibility | Live PHP version, live application version, loaded extensions | `lib/Registry/CompatibilityChecker.php` |
| Dependencies | Installed modules and platform components, versions, enabled state, conflicts | `lib/Registry/DependencyResolver.php` |
| Preview | Module, version, author, type, PHP range, dependencies, files, database changes, configuration, permissions, checksum | `lib/Install/InstallationPlan.php` |
| Confirm | Explicit checkbox; a second checkbox for downgrades; the module id must be typed to uninstall | `lib/Services/AdminController.php` |
| Backup | Existing directory copied to storage with an `installation.json` snapshot | `lib/Install/InstallationTransaction.php` |
| Install | Per-entry streamed extraction, containment re-check, size cap, CRC verify, `chmod 0644` | `lib/Package/SecureExtractor.php` |
| Register | Registry row + per-file SHA-256 manifest written only after the files are on disk and verified | `lib/Registry/ModuleRepository.php` |
| Configure | Credentials are delegated to the central API & Integrations vault | `lib/Services/ModuleManager.php` |
| Enable | Never automatic. Blocked while a dependency is missing, disabled or incompatible | `lib/Install/Installer.php` |
| Health Check | Installed files re-hashed against the recorded checksums | `Installer::health()` |

## What the archive inspector rejects

Path traversal (`../`), absolute paths, Windows drive paths, backslash
traversal, null bytes, symbolic links, devices/FIFOs/sockets, setuid/setgid/
sticky bits, executable modes, encrypted entries, duplicate names, more than
3000 entries, more than 128 MiB uncompressed, single entries over 32 MiB,
compression ratios above 200:1, paths longer than 200 characters, nesting
deeper than 12 levels, executable/binary/script/key/config file types
(`.phar .sh .so .exe .py .pl .key .pem .ini .conf …`), and control files such as
`.htaccess`, `.user.ini`, `web.config`, `.git/`, `.env`, `node_modules/`.

Extraction never calls `ZipArchive::extractTo()`. Each accepted entry is opened
as a stream, its destination is re-derived and re-verified inside the module
directory, copied in 64 KiB chunks under a byte cap, CRC-checked against the
central directory and written non-executable.

## Permissions

| Capability | Grants |
| --- | --- |
| `modules.view` | See modules, details and logs |
| `modules.upload` | Upload and delete packages |
| `modules.install` | Install a new module |
| `modules.update` | Update, reinstall or downgrade an installed module |
| `modules.toggle` | Enable and disable |
| `modules.uninstall` | Uninstall |
| `modules.configure` | Configure installed modules |

Activation seeds a Super-Admin-only policy row for each capability in
`mod_cloudhost247_capabilities` (full administrator roles plus the role that
activated the addon). Adjust them under **CloudHost247 Foundation**. Existing
rows are never overwritten.

## Storage

Packages and backups live outside the document root. The location is resolved
from, in order: `CH247_MODULE_STORAGE`, `$ch247_module_storage` in
`configuration.php`, then `$attachments_dir/cloudhost247-modules`. Directories
are created `0700` with `.htaccess` deny rules; stored packages are named by
their SHA-256, never by the client-supplied filename.

```
CH247_MODULE_STORAGE=/var/cloudhost247/modules      # outside the web root
CH247_MODULE_MAX_UPLOAD_BYTES=33554432              # optional, 64 KiB – 256 MiB
```

## Tables

`mod_cloudhost247_modules`, `mod_cloudhost247_module_packages`,
`mod_cloudhost247_module_files`, `mod_cloudhost247_module_events` — all
additive, all `hasTable`-guarded. Deactivating the addon retains every row;
uninstalling a module removes its files but never drops a table and never
deletes customer or service data.

## Writing a module

See `docs/independent-rebuild/MODULE-MANAGER.md` for the full `module.json`
specification, the packaging rules and the integration contract.

## Tests

```bash
php tests/modules/run.php                      # 198 behavioural assertions
python3 -m unittest tests.modules.test_static  # source-level security policy
```
