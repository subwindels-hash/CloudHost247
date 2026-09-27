# HostX → CloudHost247 rebrand — deployment & database migration

Everything in this repository that CloudHost247 owns has been renamed from
`hostx*` to `cloudhost247*`. Module names are part of WHMCS's **database state**,
not just the filesystem, so deploying the renamed files alone is not enough —
run the steps below in order.

> Take a full database backup first. Every statement here is reversible by
> swapping the two names around.

---

## 1. What changed

| Kind | Before | After |
|---|---|---|
| Addon module | `modules/addons/hostx_domain_lookup/` | `modules/addons/cloudhost247_domain_lookup/` |
| Provisioning module | `modules/servers/hostx_email/` | `modules/servers/cloudhost247_email/` |
| Addon module (earlier pass) | `modules/addons/CloudHost247_tools/` | `modules/addons/cloudhost247_tools/` |
| Client page | `hostx-sample.php` | `cloudhost247-sample.php` |
| Client page | `hostx-vps-sample.php` | `cloudhost247-vps-sample.php` |
| Client page + template | `all-element-hostx.php` / `.tpl` | `all-element-cloudhost247.php` / `.tpl` |
| Build notes | `docs/build-notes/hostx-*/` | `docs/build-notes/cloudhost247-*/` |

**Not renamed** (see §5): `modules/addons/hostx/` and the theme folders
`templates/hostx/`, `templates/orderforms/hostx/`.

---

## 2. Provisioning module: `hostx_email` → `cloudhost247_email`

WHMCS stores the provisioning module name against every product and every
server row. Without this step, existing email-hosting services stop
provisioning ("Module Command Error: module not found").

```sql
-- Products configured to provision with the module
UPDATE tblproducts
   SET servertype = 'cloudhost247_email'
 WHERE servertype = 'hostx_email';

-- Server entries (System Settings → Products/Services → Servers)
UPDATE tblservers
   SET type = 'cloudhost247_email'
 WHERE type = 'hostx_email';
```

Then move the module's own data tables so existing mailboxes keep resolving:

```sql
RENAME TABLE mod_hostx_email_accounts     TO mod_cloudhost247_email_accounts;
RENAME TABLE mod_hostx_email_api_logs     TO mod_cloudhost247_email_api_logs;
RENAME TABLE mod_hostx_email_webhook_logs TO mod_cloudhost247_email_webhook_logs;
```

Verify nothing was missed:

```sql
SELECT id, name, servertype FROM tblproducts WHERE servertype LIKE '%hostx%';
SELECT id, name, type       FROM tblservers  WHERE type       LIKE '%hostx%';
SHOW TABLES LIKE '%hostx%';
```

All three should return zero rows.

### ⚠️ Webhook URL changed

The module's async webhook endpoint moved with the folder. Update the callback
URL in **each provider's** console (Microsoft 365, Google Workspace, …):

```
old  https://your-whmcs.com/modules/servers/hostx_email/webhook.php?provider=…
new  https://your-whmcs.com/modules/servers/cloudhost247_email/webhook.php?provider=…
```

---

## 3. Addon module: `hostx_domain_lookup` → `cloudhost247_domain_lookup`

Simplest path — deactivate **HostX Domain Lookup** in *System Settings → Addon
Modules* **before** deploying, then activate **CloudHost247 Domain Lookup**
after. Its tables are recreated automatically and only held cache, logs and
rate-limit counters.

To keep the configured API keys instead, deploy first and then run:

```sql
UPDATE tbladdonmodules
   SET module = 'cloudhost247_domain_lookup'
 WHERE module = 'hostx_domain_lookup';

RENAME TABLE hostx_domain_lookup_cache      TO cloudhost247_domain_lookup_cache;
RENAME TABLE hostx_domain_lookup_rate_limit TO cloudhost247_domain_lookup_rate_limit;
RENAME TABLE hostx_domain_lookup_log        TO cloudhost247_domain_lookup_log;
RENAME TABLE hostx_domain_lookup_csrf       TO cloudhost247_domain_lookup_csrf;
```

(Skip any `RENAME TABLE` for a table the module never created — check with
`SHOW TABLES LIKE 'hostx_domain_lookup%';` first.)

Client-area URL changed: `index.php?m=hostx_domain_lookup` →
`index.php?m=cloudhost247_domain_lookup`. Update any menu links, saved
bookmarks or knowledgebase articles pointing at the old URL, and add a redirect
if the old one was published.

---

## 4. Renamed client pages

Old URLs 404 after deployment. If any were linked publicly or indexed, add
redirects in `.htaccess`:

```apache
Redirect 301 /hostx-sample.php       /cloudhost247-sample.php
Redirect 301 /hostx-vps-sample.php   /cloudhost247-vps-sample.php
Redirect 301 /all-element-hostx.php  /all-element-cloudhost247.php
```

These three are theme demo/sample pages, so in most installs nothing links to
them.

---

## 5. What was deliberately **not** renamed, and why

### `modules/addons/hostx/` — the HostX theme helper addon

All 63 of its PHP files are **ionCube-encrypted**. WHMCS loads an addon by
calling `hostx_config()`, `hostx_activate()`, `hostx_output()` — those function
names live inside encrypted bytecode that cannot be edited, so the folder, file
and function prefix must remain `hostx`. It is also a licensed vendor product.

It is not merely cosmetic: the theme consumes **456 Smarty bindings** that this
addon assigns, including in `header.tpl` and `footer.tpl` —

| Variable | Uses | Drives |
|---|---|---|
| `$hostx_theme_settings` | 313 in 28 files | logo, colours, menus, SEO meta, trackers, live chat |
| `$hostx_blocks` | 143 in 46 files | every homepage/landing-page content block |
| `$hxselectedcurrency` | 48 in 10 files | currency switcher |
| `$sidebarHostxRemove` | 13 in 8 files | per-page sidebar suppression |
| `$hxlanguagesflags` | 7 in 4 files | language switcher |

Deleting the addon does not just remove an admin entry — it leaves the header,
footer, menus and every marketing page with no content. Admin-only anyway:
customers never see the module name.

### `templates/hostx/` and `templates/orderforms/hostx/`

The theme and order form ship from the same vendor and are driven by that
encrypted addon. Renaming these folders requires changing **Template** and
**Order Form** in WHMCS admin, and the encrypted addon may reference the theme
path internally — which cannot be verified without the source. They are also
invisible to customers (the folder name never appears in a URL customers see).

The same applies to theme-internal identifiers kept as-is: `hostx_includes/`,
`hostx.tpl`, `sslhostx.tpl`, the `.hostx-*` / `.hx-*` CSS classes, the
`$hostx_*` Smarty variables above, and the `homehostxwebhost*` language keys —
all of these are a contract with the encrypted addon's generated markup.

---

## 6. Post-deployment checklist

- [ ] Database backup taken
- [ ] §2 SQL run; the three verification queries return zero rows
- [ ] Provider webhook URLs updated
- [ ] CloudHost247 Domain Lookup activated, API keys re-entered (or §3 SQL run)
- [ ] CloudHost247 Tools Platform activated (`cloudhost247_tools`)
- [ ] Order a test email-hosting product — confirm Create/Suspend/Terminate work
- [ ] Load the client area: header, footer, menus and homepage blocks still render
- [ ] Redirects added for any renamed page that was publicly linked
