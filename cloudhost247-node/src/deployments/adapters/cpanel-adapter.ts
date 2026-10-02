/**
 * Phase 6 — cPanel/WHM deployment adapter (spec §35–§38).
 *
 * Implements the platform's DeploymentAdapter contract for CPANEL servers. Container operations
 * are NOT supported here (spec §35: "Do not try to deploy Docker applications into ordinary
 * cPanel hosting") — they throw UnsupportedOperationError, which the engine surfaces as a
 * validation failure before any deployment starts.
 *
 * Hosting provisioning (spec §37 flow): create WHM account → apply package → create database +
 * user → install WordPress when requested → SSL is requested via AutoSSL/UAPI. WordPress-on-
 * cPanel (spec §38) downloads the official WordPress core archive from wordpress.org, extracts
 * it into public_html via UAPI Fileman, writes wp-config.php with the generated DB credentials,
 * and completes the famous 5-minute install programmatically via the wp-admin/install.php API.
 */
import { randomBytes } from 'node:crypto';
import type {
  AdapterContext,
  ApplicationStatusResult,
  BackupResult,
  DeploymentAdapter,
  DeploymentOperationResult,
  DeployInstallationInput,
  HostingProvisionInput,
  LogsResult,
} from './types';
import { UnsupportedOperationError } from './types';
import {
  CpanelApiError,
  uapiAccountInformation,
  uapiCreateDatabase,
  uapiCreateDatabaseUser,
  uapiExtractArchive,
  uapiListBackups,
  uapiRestoreBackupFromHomedir,
  uapiSetDatabasePrivileges,
  uapiStartBackup,
  uapiUploadFile,
  uapiWriteFile,
  whmAccountSummary,
  whmCreateAccount,
  whmSuspendAccount,
  whmTerminateAccount,
  whmUnsuspendAccount,
} from './cpanel-client';
import { getCredential } from '../../db/servers';
import { getKeyRing } from '../../lib/keyring';

export interface CpanelAdapterOptions {
  simulationMode: boolean;
}

const WORDPRESS_ARCHIVE_URL = 'https://wordpress.org/latest.tar.gz';

function ok(message: string): DeploymentOperationResult {
  return { ok: true, code: 'OK', message };
}

function fail(code: string, err: unknown): DeploymentOperationResult {
  return { ok: false, code, message: err instanceof Error ? err.message : String(err) };
}

export function createCpanelAdapter(options: CpanelAdapterOptions): DeploymentAdapter {
  return {
    kind: 'cpanel',

    /**
     * cPanel "application deployment" means provisioning a hosting account with the installable
     * placed in it (spec §38 cPanel path), not containers. The engine routes marketplace installs
     * on CPANEL servers here.
     */
    async deployApplication(ctx, input: DeployInstallationInput): Promise<DeploymentOperationResult> {
      if (options.simulationMode) {
        await ctx.log('warn', 'SIMULATION MODE: cPanel provisioning simulated, no WHM API was contacted');
        return ok(`Simulated cPanel deployment for ${input.project}`);
      }
      const config = await loadWhmConfig(ctx);
      if (!config) {
        return fail('WHM_NOT_CONFIGURED', 'Server has no WHM API token stored');
      }
      try {
        // The marketplace wizard's cPanel path provisions under the customer's account; the
        // username is derived from the project name (validated charset by WHM conventions).
        // Same derivation the status/stop paths use, with a random fallback for a project whose
        // name has no usable characters (the account still has to be addressable afterwards).
        const username = cpanelUsernameForProject(input.project) || `u${randomBytes(3).toString('hex')}`;
        const password = input.environment.CPANEL_ACCOUNT_PASSWORD ?? randomBytes(16).toString('base64url');
        await whmCreateAccount(config, {
          username,
          domain: input.domain ?? `${username}.cloudhost247.com`,
          password,
          contactEmail: input.environment.CPANEL_CONTACT_EMAIL ?? 'support@cloudhost247.com',
          plan: String(input.environment.CPANEL_PACKAGE ?? 'default'),
        });
        await ctx.log('info', `WHM account ${username} created`);

        if (input.manifest.deployment.cpanelInstaller === 'wordpress') {
          await installWordPress(ctx, config, username, input);
        }
        return ok(`cPanel account ${username} provisioned`);
      } catch (err) {
        return fail(err instanceof CpanelApiError ? 'CPANEL_API_ERROR' : 'PROVISION_FAILED', err);
      }
    },

    async destroyApplication(ctx, project) {
      if (options.simulationMode) return ok(`Simulated cPanel termination of ${project}`);
      const config = await loadWhmConfig(ctx);
      if (!config) return fail('WHM_NOT_CONFIGURED', 'Server has no WHM API token stored');
      try {
        const username = project.replace(/[^a-z0-9]/g, '').slice(0, 16);
        await whmTerminateAccount(config, username, false);
        return ok(`cPanel account ${username} terminated`);
      } catch (err) {
        return fail('TERMINATE_FAILED', err);
      }
    },

    async provisionHosting(ctx, input: HostingProvisionInput): Promise<DeploymentOperationResult> {
      if (options.simulationMode) {
        await ctx.log('warn', 'SIMULATION MODE: cPanel hosting provisioning simulated');
        return ok(`Simulated cPanel account for ${input.domain}`);
      }
      const config = await loadWhmConfig(ctx);
      if (!config) return fail('WHM_NOT_CONFIGURED', 'Server has no WHM API token stored');
      try {
        const result = await whmCreateAccount(config, {
          username: input.username,
          domain: input.domain,
          password: input.password,
          contactEmail: input.contactEmail,
          plan: input.planName,
        });
        await ctx.log('info', `WHM account created for ${input.domain} (user ${result.username})`);

        if (input.installer === 'wordpress') {
          await installWordPress(ctx, config, input.username, {
            environment: { CPANEL_CONTACT_EMAIL: input.contactEmail },
            domain: input.domain,
          });
        }
        return ok(`Hosting account ${input.username} provisioned on ${result.ip || 'cPanel server'}`);
      } catch (err) {
        return fail(err instanceof CpanelApiError ? 'CPANEL_API_ERROR' : 'PROVISION_FAILED', err);
      }
    },

    async suspendHosting(ctx, externalId) {
      if (options.simulationMode) return ok(`Simulated suspension of ${externalId}`);
      const config = await loadWhmConfig(ctx);
      if (!config) return fail('WHM_NOT_CONFIGURED', 'Server has no WHM API token stored');
      try {
        await whmSuspendAccount(config, externalId, 'Subscription suspended by CloudHost247 billing');
        return ok(`Account ${externalId} suspended`);
      } catch (err) {
        return fail('SUSPEND_FAILED', err);
      }
    },

    async terminateHosting(ctx, externalId) {
      if (options.simulationMode) return ok(`Simulated termination of ${externalId}`);
      const config = await loadWhmConfig(ctx);
      if (!config) return fail('WHM_NOT_CONFIGURED', 'Server has no WHM API token stored');
      try {
        await whmUnsuspendAccount(config, externalId).catch(() => undefined);
        await whmTerminateAccount(config, externalId, false);
        return ok(`Account ${externalId} terminated`);
      } catch (err) {
        return fail('TERMINATE_FAILED', err);
      }
    },

    /**
     * cPanel has no container to start, stop or restart — but it does have an account suspension
     * state, and that is what the customer's start/stop actually means on this hosting type
     * (spec §35 deliberately keeps containers off cPanel). Suspending blocks the account's web,
     * mail and FTP service (cPanel's own definition); starting unsuspends it. Restarting is
     * refused because cPanel exposes no per-account process restart, and inventing one would be
     * a silent no-op.
     */
    async startApplication(ctx, project): Promise<DeploymentOperationResult> {
      if (options.simulationMode) return ok(`Simulated cPanel start of ${project}`);
      const config = await loadWhmConfig(ctx);
      if (!config) return fail('WHM_NOT_CONFIGURED', 'Server has no WHM API token stored');
      const username = cpanelUsernameForProject(project);
      try {
        const account = (await whmAccountSummary(config, username)).acct?.[0];
        if (!account) return fail('ACCOUNT_NOT_FOUND', `WHM does not know the account ${username}`);
        if (!account.suspended) return ok(`Account ${username} is already active`);
        await whmUnsuspendAccount(config, username);
        await ctx.log('info', `WHM account ${username} unsuspended`);
        return ok(`Account ${username} is active again`);
      } catch (err) {
        return fail('START_FAILED', err);
      }
    },

    async stopApplication(ctx, project): Promise<DeploymentOperationResult> {
      if (options.simulationMode) return ok(`Simulated cPanel stop of ${project}`);
      const config = await loadWhmConfig(ctx);
      if (!config) return fail('WHM_NOT_CONFIGURED', 'Server has no WHM API token stored');
      const username = cpanelUsernameForProject(project);
      try {
        await whmSuspendAccount(config, username, 'Application stopped by the account owner');
        await ctx.log('info', `WHM account ${username} suspended (web, mail and FTP blocked)`);
        return ok(`Account ${username} suspended`);
      } catch (err) {
        return fail('STOP_FAILED', err);
      }
    },

    async restartApplication(): Promise<DeploymentOperationResult> {
      // No per-account restart exists in WHM/UAPI. A silent success here would be a lie.
      throw new UnsupportedOperationError('cpanel', 'restartApplication');
    },

    /**
     * Account status from WHM's own account summary. `running` means the account is not suspended;
     * health is UNKNOWN because cPanel exposes no application health signal and claiming a healthy
     * website from "the account exists" would be fabricated.
     */
    async applicationStatus(ctx, project): Promise<ApplicationStatusResult> {
      if (options.simulationMode) {
        return { ok: true, code: 'OK', message: `Simulated cPanel status of ${project}`, running: true, health: 'unknown' };
      }
      const config = await loadWhmConfig(ctx);
      if (!config) {
        return { ok: false, code: 'WHM_NOT_CONFIGURED', message: 'Server has no WHM API token stored', running: false, health: 'unknown' };
      }
      const username = cpanelUsernameForProject(project);
      try {
        const account = (await whmAccountSummary(config, username)).acct?.[0];
        if (!account) {
          return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: `WHM does not know the account ${username}`, running: false, health: 'unknown' };
        }
        const suspended = Boolean(account.suspended);
        return {
          ok: true,
          code: suspended ? 'ACCOUNT_SUSPENDED' : 'OK',
          message: suspended
            ? `Account ${username} is suspended; web, mail and FTP are blocked`
            : `Account ${username} exists and is not suspended`,
          running: !suspended,
          health: 'unknown',
          detail: `diskused=${account.diskused ?? 'unknown'}, disklimit=${account.disklimit ?? 'unknown'}, domain=${account.domain ?? 'unknown'}`,
        };
      } catch (err) {
        if (err instanceof CpanelApiError) {
          return { ok: false, code: 'ACCOUNT_NOT_FOUND', message: err.message, running: false, health: 'unknown' };
        }
        return { ok: false, code: 'STATUS_FAILED', message: (err as Error).message, running: false, health: 'unknown' };
      }
    },

    /**
     * Per-account application logs do not exist on cPanel: the platform cannot read inside the
     * customer's account. Refused explicitly; the customer's own cPanel is where logs live.
     */
    async applicationLogs(): Promise<LogsResult> {
      throw new UnsupportedOperationError('cpanel', 'applicationLogs');
    },
    async runHealthcheck(ctx): Promise<ApplicationStatusResult> {
      // cPanel account provisioning does not expose a container health signal. Keep the
      // installation UNKNOWN until a domain-level HTTP monitor is configured; returning UNKNOWN
      // is intentional and prevents the control plane from claiming the site is online merely
      // because WHM accepted the account.
      if (options.simulationMode) {
        await ctx.log('warn', 'SIMULATION MODE: cPanel health could not be verified');
      }
      return {
        ok: true,
        code: 'HEALTHCHECK_UNAVAILABLE',
        message: 'cPanel account was provisioned, but application health is not yet verifiable',
        running: false,
        health: 'unknown',
      };
    },
    /**
     * A full account backup generated through UAPI on cPanel's own terms. The archive is written
     * into the account's home directory on the server; cPanel's UAPI has no remote-download
     * function, so the adapter waits for the backup engine to report completion and records the
     * archive's server-side path and size rather than claiming to hold a copy it does not have.
     */
    async runBackup(ctx, project): Promise<BackupResult> {
      if (options.simulationMode) {
        return { ok: true, code: 'OK', message: 'Simulated cPanel backup', archivePath: `/home/${project}/simulated-backup.tar.gz`, sizeBytes: 1024, checksum: null };
      }
      const config = await loadWhmConfig(ctx);
      if (!config) {
        return { ok: false, code: 'WHM_NOT_CONFIGURED', message: 'Server has no WHM API token stored', archivePath: null, sizeBytes: null, checksum: null };
      }
      const username = cpanelUsernameForProject(project);
      try {
        const before = new Set((await backupEntries(config, username)).map((entry) => entry.file));
        await uapiStartBackup(config, username);
        await ctx.log('info', `cPanel full backup requested for ${username}`);
        // cPanel queues the backup; poll its own list until a new completed archive appears.
        const deadline = Date.now() + 10 * 60_000;
        while (Date.now() < deadline) {
          const entries = await backupEntries(config, username);
          const fresh = entries.find((entry) => entry.file && !before.has(entry.file));
          if (fresh?.file) {
            const status = String(fresh.status ?? '');
            if (status === 'complete' || status === 'completed') {
              const archivePath = `/home/${username}/${fresh.file}`;
              await ctx.log('info', `cPanel backup archived at ${archivePath}`);
              return {
                ok: true,
                code: 'OK',
                message: `cPanel backup ${fresh.file} completed on the server`,
                archivePath,
                sizeBytes: typeof fresh.size === 'number' && fresh.size > 0 ? fresh.size : null,
                checksum: null,
              };
            }
          }
          await sleep(backupPollIntervalMs);
        }
        return {
          ok: false,
          code: 'BACKUP_TIMEOUT',
          message: 'cPanel did not report a completed backup within 10 minutes',
          archivePath: null,
          sizeBytes: null,
          checksum: null,
        };
      } catch (err) {
        return { ok: false, code: 'BACKUP_FAILED', message: (err as Error).message, archivePath: null, sizeBytes: null, checksum: null };
      }
    },

    /**
     * UAPI restores a full backup that is already in the account's home directory. The path is
     * validated to be the platform's own archive location, because a restore overwrites the
     * account's files and must never be pointed at an arbitrary file.
     */
    async restoreBackup(ctx, project, archivePath) {
      if (options.simulationMode) return ok(`Simulated cPanel restore of ${archivePath}`);
      const config = await loadWhmConfig(ctx);
      if (!config) return fail('WHM_NOT_CONFIGURED', 'Server has no WHM API token stored');
      const username = cpanelUsernameForProject(project);
      const expectedPrefix = `/home/${username}/`;
      if (!archivePath.startsWith(expectedPrefix) || archivePath.includes('..')) {
        return fail('INVALID_ARCHIVE_PATH', `cPanel restores only accept an archive inside ${expectedPrefix}, not ${archivePath}`);
      }
      const archiveFile = archivePath.slice(expectedPrefix.length);
      try {
        await uapiRestoreBackupFromHomedir(config, username, archiveFile);
        await ctx.log('info', `cPanel restore of ${archiveFile} requested for ${username}`);
        return ok(`Account ${username} restore from ${archiveFile} submitted`);
      } catch (err) {
        return fail('RESTORE_FAILED', err);
      }
    },
  };
}

/**
 * The cPanel username the platform derives from a deployment project name. Real cPanel usernames
 * are lowercase alphanumerics that cannot start with a digit, so the project name is lowercased
 * first (stripping capitals silently dropped characters — "My-Project" became "roject"), a leading
 * digit gets the `u` prefix, and the result is capped at cPanel's 16 characters. An empty result
 * is returned for an empty project so lookups cannot address an unrelated account.
 */
export function cpanelUsernameForProject(project: string): string {
  const cleaned = project.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  if (!cleaned) return '';
  return /^[0-9]/.test(cleaned) ? `u${cleaned}`.slice(0, 16) : cleaned;
}

/** How often the adapter asks cPanel whether its backup engine has finished. */
export const backupPollIntervalMs = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function backupEntries(
  config: { whmBaseUrl: string; whmUsername: string; whmApiToken: string },
  username: string
): Promise<Array<{ file?: string; status?: string; size?: number }>> {
  const result = await uapiListBackups(config, username);
  return result.backup ?? result.backups ?? [];
}

async function loadWhmConfig(ctx: AdapterContext) {
  const metadata = ctx.server.metadata as Record<string, unknown> | null;
  const baseUrl = typeof metadata?.whm_url === 'string' ? metadata.whm_url : null;
  const username = typeof metadata?.whm_user === 'string' ? metadata.whm_user : null;
  const token = await getCredential(ctx.db, getKeyRing(), ctx.server.id, 'whm_api_token');
  if (!baseUrl || !username || !token) return null;
  return { whmBaseUrl: baseUrl, whmUsername: username, whmApiToken: token };
}

/**
 * Installs WordPress on a freshly created cPanel account (spec §38), entirely through supported
 * APIs — no screenscraping, no manual steps:
 *
 *   1. UAPI Mysql::create_database / create_user / set_privileges_on_database
 *   2. Control plane downloads the official wordpress.org core archive
 *   3. UAPI Fileman::upload_files places it in the account home, Fileman::extract_files
 *      extracts it into public_html (strip_path drops the wordpress/ wrapper)
 *   4. UAPI Fileman::save_file_content writes wp-config.php with the generated credentials
 *   5. The wp-admin/install.php step-2 API completes installation via a single form POST
 */
async function installWordPress(
  ctx: AdapterContext,
  config: { whmBaseUrl: string; whmUsername: string; whmApiToken: string },
  username: string,
  input: { environment: Record<string, string>; domain: string | null }
): Promise<void> {
  const dbName = `wp_${username}`.slice(0, 54);
  const dbUser = `wp_${username}`.slice(0, 54);
  const dbPassword = randomBytes(16).toString('base64url');
  const siteTitle = 'My WordPress Site';

  // 1. Database
  await uapiCreateDatabase(config, username, dbName);
  await uapiCreateDatabaseUser(config, username, dbUser, dbPassword);
  await uapiSetDatabasePrivileges(config, username, dbName, dbUser);
  await ctx.log('info', `Database ${dbName} + user created via UAPI`);

  // 2. Download official core
  const archive = await fetch(WORDPRESS_ARCHIVE_URL, { signal: AbortSignal.timeout(120_000) });
  if (!archive.ok) {
    throw new CpanelApiError('wordpress-download', archive.status, undefined, `wordpress.org returned ${archive.status}`);
  }
  const archiveBytes = Buffer.from(await archive.arrayBuffer());
  await ctx.log('info', `Downloaded WordPress core (${(archiveBytes.length / 1_048_576).toFixed(1)} MB)`);

  // 3. Upload + extract into public_html
  const home = `/home/${username}`;
  await uapiUploadFile(config, username, home, 'wp-latest.tar.gz', archiveBytes.toString('base64'));
  await uapiExtractArchive(config, username, `${home}/wp-latest.tar.gz`, `${home}/public_html`);
  await ctx.log('info', 'WordPress core extracted into public_html');

  // 4. wp-config.php
  const wpConfig = `<?php
define('DB_NAME', '${dbName}');
define('DB_USER', '${dbUser}');
define('DB_PASSWORD', '${dbPassword}');
define('DB_HOST', 'localhost');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');
define('AUTH_KEY', '${randomBytes(32).toString('base64url')}');
define('SECURE_AUTH_KEY', '${randomBytes(32).toString('base64url')}');
define('LOGGED_IN_KEY', '${randomBytes(32).toString('base64url')}');
define('NONCE_KEY', '${randomBytes(32).toString('base64url')}');
define('AUTH_SALT', '${randomBytes(32).toString('base64url')}');
define('SECURE_AUTH_SALT', '${randomBytes(32).toString('base64url')}');
define('LOGGED_IN_SALT', '${randomBytes(32).toString('base64url')}');
define('NONCE_SALT', '${randomBytes(32).toString('base64url')}');
$table_prefix = 'wp_';
if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');
require_once ABSPATH . 'wp-settings.php';
`;
  await uapiWriteFile(config, username, `${home}/public_html`, 'wp-config.php', wpConfig);
  await ctx.log('info', 'wp-config.php written');

  // 5. Complete the 5-minute install programmatically. install.php accepts a single POST with
  // the site title, admin user, and admin password; a 200 + "Success" body confirms completion.
  const adminUser = `ch247_${username}`.slice(0, 40);
  const adminPassword = randomBytes(14).toString('base64url');
  const installUrl = input.domain ? `http://${input.domain}/wp-admin/install.php?step=2` : null;
  if (installUrl) {
    const body = new URLSearchParams({
      weblogTitle: siteTitle,
      userName: adminUser,
      admin_password: adminPassword,
      admin_password2: adminPassword,
      pw_weak: '1',
      admin_email: input.environment.CPANEL_CONTACT_EMAIL ?? `support@cloudhost247.com`,
      language: '',
      submit: 'Install WordPress',
    });
    const result = await fetch(installUrl, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await result.text().catch(() => '');
    if (result.ok && /success/i.test(text)) {
      await ctx.log('info', 'WordPress install completed via wp-admin API');
    } else {
      // Site may not yet resolve to the server (DNS lag) — the files+DB are fully in place, and
      // wp-admin/install.php will finish on the customer's first visit. Recorded honestly.
      await ctx.log('warn', `WordPress installer API returned ${result.status} — first visit to /wp-admin/install.php will complete setup`);
    }
  }
}
