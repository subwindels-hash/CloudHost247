# CloudHost247 Node Platform — Deployment Artifacts

Generated on **2026-10-04** from checkout `b54b047`.

## Deployment ZIP

- **File:** `cloudhost247-node/release/cloudhost247-cpanel-b54b047.zip`
- **Size:** 2.3 MB
- **Files:** 1,138
- **Database migrations:** 70 (0001–0070)
- **SHA-256:** `d2321760556f36cc68e05c9f7dac1691db248b08003fc5820ea1fb6384888236`

The ZIP contains the Passenger startup file, package manifests/lockfile, compiled server and frontend assets, database migrations, application manifests, and `.env.example`. It excludes `node_modules`, tests, and all real environment files/secrets. The archive passed `unzip -t`. The `release/` output is git-ignored, so the ZIP is local to this workspace and not included in this PR; regenerate it with `bash scripts/package-cpanel.sh`.

## Full environment file

- **File:** `cloudhost247-node/.env`
- **Permissions:** `0600`
- **Git status:** ignored by Git; intentionally excluded from the ZIP.

The file has generated app secrets for JWT signing, credential encryption, and the reserved cron token. The sandbox webhook secret is intentionally disabled in production. It is a full configuration starting point, **not a ready-to-run production configuration**: `DATABASE_URL` is still a placeholder, `APP_URL` must match the actual cPanel application URL, and external provider/email credentials are intentionally left unset. Confirm the database provider's TLS requirements before changing `DATABASE_SSL`.

`npm run env:check` passes with this file. That only validates environment-variable shape; it does not verify a live PostgreSQL connection, email delivery, or provider credentials. Preserve the credential-encryption key after first use; changing it without re-encrypting stored values can make those values unreadable.

## Build and verification

The package was built with `bash scripts/package-cpanel.sh`, which installed from the lockfile and ran the server and frontend production builds. The full suite passed (129 test files / 1,158 tests), `npm run env:check` passed, and the ZIP integrity check passed; the archive contains all 70 migrations. No real cPanel/Passenger deployment was performed in this workspace; see [`../docs/CPANEL_DEPLOYMENT.md`](../docs/CPANEL_DEPLOYMENT.md) for prerequisites and the outstanding staging gate.

## cPanel deployment outline

1. Confirm that the hosting account provides **Setup Node.js App/Passenger**, Node.js **20.9.0+**, terminal or equivalent package-install access, and a PostgreSQL database (local or managed).
2. Upload the ZIP to cPanel File Manager, extract it, and move the contents of `cloudhost247-cpanel-b54b047/` into the chosen application root.
3. Create a Node.js application in Production mode, choose the application URL/root, and set `server.js` as the startup file.
4. Configure the active variables from `.env` through cPanel's Environment Variables UI (recommended), or upload the customized file with mode `0600`. Replace `DATABASE_URL`, confirm `APP_URL`, and configure only the integrations you intend to use. **Do not set `PORT`; Passenger supplies it.**
5. In the cPanel virtual-environment terminal, install runtime packages:
   ```bash
   npm ci --omit=dev
   ```
   The ZIP is pre-built, so do not run a build on a memory-limited shared host unless you are intentionally rebuilding it.
6. Run `npm run env:check`, inspect database migration status, and take a database backup before applying schema changes.
7. **Production migration restriction:** migrations `0023`, `0024`, `0025`, and `0041` are quarantined. Applying them requires deliberate owner authorization. Read `docs/CPANEL_DEPLOYMENT.md` §0a/§6 first; only after approval, the command is:
   ```bash
   CONFIRM_MIGRATION=yes AUTHORIZED_MIGRATIONS=0023,0024,0025,0041 node dist/database/migrate.js up
   ```
8. Restart the application and verify `/health`, `/ready`, and the configured application URL. For cPanel shared hosting, schedule the deployment worker as a bounded one-shot cron job (`node dist/src/worker/main.js --once`); use the actual paths shown by cPanel.

## Production cautions

- The generated `.env` must not be committed, emailed, or included in a deployment archive. Use cPanel's secret/environment-variable UI where possible.
- Replace the database placeholder with the exact PostgreSQL connection string from the hosting provider; URL-encode reserved characters in the username/password.
- Set `APP_URL` to the final HTTPS origin (for example, if deploying on a subdomain, use that subdomain rather than the apex domain).
- Provider and email delivery credentials are not supplied; configure them before enabling those integrations.
- A successful build and local environment check do **not** mean cPanel production readiness. Complete the cPanel staging checklist in `docs/CPANEL_DEPLOYMENT.md` before a live rollout.
