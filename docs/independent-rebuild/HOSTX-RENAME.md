# Renaming `hostx` to `CloudHost247`

The request was to rename every `hostx` file and code name to `CloudHost247`.
That splits cleanly in two, because two different things share the prefix.

| | Files | Owner | Action |
| --- | --- | --- | --- |
| `modules/addons/hostx_tools`, `modules/addons/hostx_domain_lookup`, `modules/servers/hostx_email` | 47 | **ours** — built in-house, 0 files in the integrity manifest | **renamed** |
| `templates/hostx`, `templates/orderforms/hostx`, `modules/addons/hostx` | 2085 | **licensed third party** — every file in the integrity manifest | **left alone** |

## What was renamed

    modules/addons/hostx_tools          -> modules/addons/cloudhost247_tools
    modules/addons/hostx_domain_lookup  -> modules/addons/cloudhost247_domain_lookup
    modules/servers/hostx_email         -> modules/servers/cloudhost247_email
    docs/build-notes/hostx-*            -> docs/build-notes/cloudhost247-*

Inside those three modules every identifier moved with the directory: WHMCS
entry points (`<dir>/<dir>.php`), the 91 `<module>_*()` hook functions, the 74
`hostx_tool_*()` tool implementations, the `CloudHost247EmailAPI` class, CSS
classes, JS, Smarty templates, constants and asset filenames. No occurrence of
`hostx` in any case remains in the code we own.

The one string customers actually saw, `$_LANG['homehostxwebhost']`, is now
`CloudHost247 Web Hosting` in all 27 languages, including the translated forms
(`Веб-хостинг CloudHost247`, `CloudHost247 webbhotell`). **The array key keeps
its original spelling** because `templates/hostx/*.tpl` reads it; renaming the
key would blank the string on the live homepage.

## What was not renamed, and why

**The HostX theme and its helper module.** All 2085 files are licensed
third-party code recorded in `original-file-manifest.sha256`. Renaming them
would break the integrity baseline the release gate verifies, and rebranding a
vendor's source is a licensing matter rather than a technical one. The theme
directory therefore stays `templates/hostx`, and `tblconfiguration.Template`
still reads `hostx`.

**Owned pages that link to vendor assets.** Files such as `cpanel-hosting.php`
reference `templates/hostx/...` for real CSS, fonts and images. Those paths
resolve to the vendor directory, which kept its name, so they were left exactly
as they were. A blanket find-and-replace would have broken every asset URL on
the marketing pages — the main reason this was done with targeted token
replacement rather than `sed s/hostx/cloudhost247/g`.

**Prose in `docs/` and `README.md` that refers to the vendor product.** Lines
like *"Do not select or activate HostX"* and *"independent of HostX"* are
statements about a third-party product. Rewriting them to say CloudHost247
would turn true documentation into false documentation. References to the three
renamed modules were updated; references to the vendor were not.

## Required database migration

**The code rename does not take effect on its own.** WHMCS resolves modules by
name from the database, and the renamed PHP now addresses renamed tables. Deploy
the code and the migration together:

    mysql -u USER -p DATABASE < scripts/rename-hostx-to-cloudhost247.sql

It renames eight tables and repoints the registration rows:

| Table | Holds |
| --- | --- |
| `mod_hostx_email_accounts` | **live customer mailboxes** |
| `mod_hostx_email_api_logs`, `mod_hostx_email_webhook_logs` | email module history |
| `mod_hostx_tools_cache`, `_logs`, `_rate_limit`, `_settings`, `_status` | tools platform state |

plus `tbladdonmodules.module`, `tblproducts.servertype`, `tblservers.type` and
the addon entries inside `tbladminroles.permissions`. Tables are renamed, never
recreated, so no row is lost. Every statement is guarded and the script is safe
to re-run; it ends with four verification counts that must all be zero.

Skipping it has specific consequences: the two addons disappear from the admin
menu, and every product whose `servertype` is still `hostx_email` loses its
provisioning module, which stops provisioning, suspension and renewal for those
services.

## Order of operations

1. Full database backup.
2. Site into maintenance mode.
3. Deploy this branch.
4. Run the SQL above; confirm the four verification counts are zero.
5. Admin → System Settings → Addon Modules: confirm both addons are listed and
   still activated for the right roles.
6. Open one email service and confirm the module tab loads.
7. Leave maintenance mode.

## Rollback

Revert the deploy and run the inverse renames. Because the migration only
renames tables and rewrites three name columns, rolling back is symmetrical and
loses no data. Keep the backup from step 1 until step 6 has passed.
