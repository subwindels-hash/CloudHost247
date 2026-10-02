/**
 * Phase 6 — WHM + cPanel UAPI client (spec §35, §36).
 *
 * Uses the *supported* management APIs only — WHM API 1 for server-level operations (creating,
 * suspending, terminating accounts) and cPanel UAPI for account-level operations (databases,
 * subdomains, email). It never automates the cPanel web interface, never screenscrapes, and
 * never stores WHM root credentials in the database: the per-server WHM API token lives
 * encrypted in server_credentials (credential_type 'whm_api_token').
 *
 * The client is transport-only (fetch + JSON) with no business logic; orchestration lives in
 * cpanel-adapter.ts. This separation keeps the wire protocol testable in isolation.
 */
import { createHmac } from 'node:crypto';

export interface CpanelServerConfig {
  whmBaseUrl: string; // e.g. https://whm.example.com:2087
  whmUsername: string; // the WHM user the token belongs to (usually root or a reseller)
  whmApiToken: string;
}

export class CpanelApiError extends Error {
  constructor(
    public readonly operation: string,
    public readonly httpStatus: number,
    public readonly cpanelStatus: number | undefined,
    message: string
  ) {
    super(`cPanel/WHM "${operation}" failed (HTTP ${httpStatus}${cpanelStatus !== undefined ? `, status ${cpanelStatus}` : ''}): ${message}`);
    this.name = 'CpanelApiError';
  }
}

/**
 * WHM API 1 request with token authentication (Authorization: whm <user>:<token>). Query-string
 * parameters per the WHM API convention; responses are { metadata: {result, reason}, data }.
 */
export async function whmRequest<T = Record<string, unknown>>(
  config: CpanelServerConfig,
  version: 'json-api' | 'json-api/1',
  function_: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${config.whmBaseUrl.replace(/\/$/, '')}/${version}/${function_}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `whm ${config.whmUsername}:${config.whmApiToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  });

  const body = (await response.json().catch(() => null)) as
    | { metadata?: { result?: number; reason?: string; OK?: number }; data?: T }
    | null;

  if (!response.ok || !body || (body.metadata?.result !== undefined && body.metadata.result !== 1)) {
    throw new CpanelApiError(
      function_,
      response.status,
      body?.metadata?.result,
      body?.metadata?.reason ?? (response.ok ? 'unknown WHM error' : 'HTTP error')
    );
  }
  return (body.data ?? ({} as T)) as T;
}

/** cPanel UAPI request on behalf of a cPanel account, authenticated with the WHM user + token. */
export async function uapiRequest<T = Record<string, unknown>>(
  config: CpanelServerConfig,
  cpanelUser: string,
  module: string,
  function_: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(`${config.whmBaseUrl.replace(/\/$/, '')}/json-api/cpanel`);
  url.searchParams.set('cpanel_jsonapi_user', cpanelUser);
  url.searchParams.set('cpanel_jsonapi_apiversion', '3');
  url.searchParams.set('cpanel_jsonapi_module', module);
  url.searchParams.set('cpanel_jsonapi_func', function_);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `whm ${config.whmUsername}:${config.whmApiToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  });

  const body = (await response.json().catch(() => null)) as
    | { result?: { status?: number; messages?: string | string[]; data?: T; errors?: string | string[] } }
    | null;

  const result = body?.result;
  if (!response.ok || !body || !result || result.status !== 1) {
    const errors = result?.errors;
    const message = Array.isArray(errors) ? errors.join('; ') : (errors ?? 'unknown UAPI error');
    throw new CpanelApiError(`UAPI ${module}::${function_}`, response.status, result?.status, message);
  }
  return (result.data ?? ({} as T)) as T;
}

// --- WHM server-level operations (spec §36) --------------------------------------------------------

export interface WhmAccountResult {
  domain: string;
  username: string;
  ip: string;
  setup_complete?: boolean;
}

export async function whmCreateAccount(
  config: CpanelServerConfig,
  input: {
    username: string;
    domain: string;
    password: string;
    contactEmail: string;
    plan: string;
  }
): Promise<WhmAccountResult> {
  return whmRequest<WhmAccountResult>(config, 'json-api', 'createacct', {
    username: input.username,
    domain: input.domain,
    password: input.password,
    contactemail: input.contactEmail,
    plan: input.plan,
    'pkgname?': undefined,
  });
}

export async function whmSuspendAccount(config: CpanelServerConfig, username: string, reason: string) {
  return whmRequest(config, 'json-api', 'suspendacct', { user: username, reason });
}

export async function whmUnsuspendAccount(config: CpanelServerConfig, username: string) {
  return whmRequest(config, 'json-api', 'unsuspendacct', { user: username });
}

export async function whmTerminateAccount(config: CpanelServerConfig, username: string, keepDns: boolean) {
  return whmRequest(config, 'json-api', 'removeacct', { username, keepdns: keepDns ? 1 : 0 });
}

export interface WhmAccountSummary {
  acct: Array<{
    domain: string;
    user: string;
    suspended: number;
    diskused: number;
    disklimit: string;
    maxsub?: string;
  }>;
}

export async function whmAccountSummary(config: CpanelServerConfig, username: string) {
  return whmRequest<WhmAccountSummary>(config, 'json-api', 'accountsummary', { user: username });
}

export async function whmListAccounts(config: CpanelServerConfig, searchType = 'domain', search = '') {
  return whmRequest<{ acct: Array<{ user: string; domain: string; suspended: number; diskused: string; disklimit: string }> }>(
    config,
    'json-api',
    'listaccts',
    { searchtype: searchType, search }
  );
}

// --- cPanel UAPI account-level operations (spec §36) -----------------------------------------------

export async function uapiCreateDatabase(config: CpanelServerConfig, user: string, dbName: string) {
  return uapiRequest(config, user, 'Mysql', 'create_database', { name: dbName });
}

export async function uapiCreateDatabaseUser(
  config: CpanelServerConfig,
  user: string,
  dbUser: string,
  password: string
) {
  return uapiRequest(config, user, 'Mysql', 'create_user', { name: dbUser, password });
}

export async function uapiSetDatabasePrivileges(
  config: CpanelServerConfig,
  user: string,
  dbName: string,
  dbUser: string
) {
  return uapiRequest(config, user, 'Mysql', 'set_privileges_on_database', {
    user: dbUser,
    database: dbName,
    privileges: 'ALL PRIVILEGES',
  });
}

export async function uapiCreateSubdomain(
  config: CpanelServerConfig,
  user: string,
  subdomain: string,
  rootDomain: string,
  dir: string
) {
  return uapiRequest(config, user, 'SubDomain', 'addsubdomain', {
    domain: subdomain,
    rootdomain: rootDomain,
    dir,
  });
}

export async function uapiCreateEmailAccount(
  config: CpanelServerConfig,
  user: string,
  emailUser: string,
  domain: string,
  password: string,
  quotaMb = 1024
) {
  return uapiRequest(config, user, 'Email', 'add_pop', {
    email: emailUser,
    domain,
    password,
    quota: quotaMb,
  });
}

export async function uapiCreateDnsRecord(
  config: CpanelServerConfig,
  user: string,
  domain: string,
  name: string,
  type: 'A' | 'CNAME',
  address: string,
  ttl = 3600
) {
  return uapiRequest(config, user, 'ZoneEditor', 'add_zone_record', {
    domain,
    name,
    type,
    address,
    ttl,
    class: 'IN',
  });
}

/** Installs an SSL certificate for a domain on the account (AutoSSL-issued or provided PEM). */
export async function uapiInstallSsl(
  config: CpanelServerConfig,
  user: string,
  domain: string,
  cert: string,
  key: string,
  cabundle?: string
) {
  return uapiRequest(config, user, 'SSL', 'install_ssl', {
    domain,
    cert,
    key,
    cabundle: cabundle ?? '',
  });
}

export async function uapiListSslCertificates(config: CpanelServerConfig, user: string, domain: string) {
  return uapiRequest<{ certificates: Array<{ domains: string[]; expiry: string; is_self_signed: number }> }>(
    config,
    user,
    'SSL',
    'list_ssl_certificates',
    { domains: domain }
  );
}

export async function uapiDiskUsage(config: CpanelServerConfig, user: string) {
  return uapiRequest<{ disk_used: number; disk_available: number }>(config, user, 'DiskUsage', 'get_local_disk_info');
}

export async function uapiBandwidth(config: CpanelServerConfig, user: string) {
  return uapiRequest<{ bandwidth: Array<{ month: string; total: number }> }>(config, user, 'Stats', 'get_bandwidth');
}

export async function uapiAccountInformation(config: CpanelServerConfig, user: string) {
  return uapiRequest(config, user, 'Variables', 'get_server_information');
}

/**
 * cPanel's own account backup operations (UAPI Backup module):
 *   fullbackup_to_homedir → generate a full account archive into the account home directory
 *   list_backups          → list the account's backup files
 *   restore_backup        → restore a full backup that is already in the account home directory
 * There is no remote-download function: the archive lives on the server, and the adapter reports
 * its server-side path and size rather than pretending to hold a copy.
 */
export async function uapiStartBackup(config: CpanelServerConfig, user: string) {
  return uapiRequest(config, user, 'Backup', 'fullbackup_to_homedir', {});
}

export interface UapiBackupEntry {
  file?: string;
  status?: string;
  time?: number;
  size?: number;
}

export async function uapiListBackups(config: CpanelServerConfig, user: string) {
  return uapiRequest<{ backup?: UapiBackupEntry[]; backups?: UapiBackupEntry[] }>(
    config,
    user,
    'Backup',
    'list_backups',
    {}
  );
}

export async function uapiRestoreBackupFromHomedir(config: CpanelServerConfig, user: string, archiveFile: string) {
  return uapiRequest(config, user, 'Backup', 'restore_backup', { file: archiveFile });
}

/** Uploads a file (base64) into the account's home directory — used for the WordPress payload. */
export async function uapiUploadFile(
  config: CpanelServerConfig,
  user: string,
  directory: string,
  fileName: string,
  contentBase64: string
) {
  return uapiRequest(config, user, 'Fileman', 'upload_files', {
    dir: directory,
    file: fileName,
    content: contentBase64,
    overwrite: 1,
  });
}

export async function uapiExtractArchive(
  config: CpanelServerConfig,
  user: string,
  archivePath: string,
  destination: string
) {
  return uapiRequest(config, user, 'Fileman', 'extract_files', {
    archive: archivePath,
    destination,
    strip_path: 1,
  });
}

export async function uapiWriteFile(
  config: CpanelServerConfig,
  user: string,
  directory: string,
  fileName: string,
  content: string
) {
  return uapiRequest(config, user, 'Fileman', 'save_file_content', {
    dir: directory,
    file: fileName,
    content,
    from_charset: 'UTF-8',
    to_charset: 'UTF-8',
  });
}
