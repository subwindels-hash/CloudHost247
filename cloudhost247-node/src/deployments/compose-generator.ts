/**
 * Phase 6 — renders a validated application manifest + installation configuration into an
 * isolated Docker Compose project (spec §32, §33).
 *
 * Isolation model: every installation gets its own compose project name (= container_project),
 * its own network, its own named volumes, its own directory on the server
 * (/opt/cloudhost247/apps/<project>/), and its own .env file. No customer's application ever
 * shares a compose project with another customer's (spec §32: "Do not place every customer's
 * application in one giant Docker Compose project").
 *
 * Secrets never appear in the compose file: the compose references variables via ${VAR}, and the
 * agent writes the values into the project directory's .env with 0600 permissions at deploy
 * time. Traefik routing is generated from the manifest + the customer's domain — never
 * hardcoded into a global Traefik config (spec §33).
 */
import type { ApplicationManifest } from '../marketplace/manifest-schema';

/** The external Docker network the platform's Traefik instance listens on (docs/DEPLOYMENTS.md). */
export const TRAEFIK_NETWORK_NAME = 'cloudhost247-traefik';

export interface ComposeGenerationInput {
  manifest: ApplicationManifest;
  /** Pinned image for the app service for this version. */
  appImage: string;
  project: string;
  /** Primary domain (null when the app is deployed without a public domain). */
  domain: string | null;
  sslEnabled: boolean;
  cpuLimit: number;
  memoryLimitMb: number;
  /** Names of environment variables the agent must find in .env (validated before calling). */
  environmentKeys: string[];
}

export interface ComposeBundle {
  composeYaml: string;
  /** Names of every named volume created by the project (for backups). */
  volumeNames: string[];
  /** The port the app service listens on (for Traefik and health checks). */
  appPort: number | null;
}

function sanitizeVolumeName(path: string): string {
  return path.replace(/\//g, '-').replace(/[^a-zA-Z0-9_.-]/g, '').replace(/^-+|-+$/g, '') || 'data';
}

function quoteEnv(value: string): string {
  // Compose interpolation treats $ specially; double both $ and keep values single-quoted where
  // they contain characters YAML would otherwise reinterpret.
  return value.replace(/\$/g, '$$');
}

/**
 * Generates the compose file. Pure function: no I/O, fully deterministic for its inputs — which
 * is what makes "regenerate and diff" a viable audit/debgging tool and keeps it unit-testable.
 */
export function generateComposeProject(input: ComposeGenerationInput): ComposeBundle {
  const { manifest, appImage, project, domain, sslEnabled, cpuLimit, memoryLimitMb } = input;
  const services = manifest.services;
  const appService = services.app;
  if (!appService) throw new Error('generateComposeProject: manifest has no app service');

  const volumeNames: string[] = [];
  const serviceBlocks: string[] = [];
  const routerName = `${project}-app`;

  for (const [serviceName, service] of Object.entries(services)) {
    const isApp = serviceName === 'app';
    const image = isApp ? appImage : service.image;
    if (!image) throw new Error(`Service "${serviceName}" has no image and is not the app service`);

    const lines: string[] = [`    image: ${image}`];
    lines.push('    restart: unless-stopped');

    if (service.command) lines.push(`    command: ${service.command}`);
    if (service.capabilities && service.capabilities.length > 0) {
      lines.push('    cap_add:');
      for (const cap of service.capabilities) lines.push(`      - ${cap}`);
    }

    // Static manifest environment + generated-variable references. All generated values live in
    // .env and are referenced with ${VAR} — including injected database credentials.
    const envEntries: string[] = [];
    for (const [key, value] of Object.entries(service.environment ?? {})) {
      envEntries.push(`      ${key}: ${quoteEnv(String(value))}`);
    }
    if (isApp) {
      for (const key of input.environmentKeys) {
        envEntries.push(`      ${key}: \${${key}}`);
      }
    } else if (service.database) {
      for (const key of databaseCredentialKeys(service.database)) {
        envEntries.push(`      ${key}: \${${key}}`);
      }
    }
    if (envEntries.length > 0) {
      lines.push('    environment:');
      lines.push(...envEntries);
    }

    if (service.volumes.length > 0) {
      lines.push('    volumes:');
      for (const mount of service.volumes) {
        const volumeName = `${project}_${serviceName}_${sanitizeVolumeName(mount)}`;
        volumeNames.push(volumeName);
        lines.push(`      - ${volumeName}:${mount}`);
      }
    }

    // Only the app service joins the shared Traefik network; dependencies stay on the project's
    // private default network, unreachable from the proxy (spec §31/§32 isolation).
    lines.push('    networks:');
    if (isApp) {
      lines.push(`      - ${TRAEFIK_NETWORK_NAME}`);
    }
    lines.push('      - default');

    // Resource limits (spec §50): one customer's app can never consume a shared server.
    if (isApp) {
      lines.push('    deploy:');
      lines.push('      resources:');
      lines.push('        limits:');
      lines.push(`          cpus: "${cpuLimit}"`);
      lines.push(`          memory: ${memoryLimitMb}M`);
    }

    if (isApp && domain && !service.internal) {
      lines.push('    labels:');
      lines.push('      - "traefik.enable=true"');
      lines.push(`      - "traefik.docker.network=${TRAEFIK_NETWORK_NAME}"`);
      lines.push(`      - "traefik.http.routers.${routerName}.rule=Host(\`${domain}\`)"`);
      lines.push(`      - "traefik.http.routers.${routerName}.entrypoints=websecure"`);
      lines.push('      - "traefik.http.routers.' + routerName + '.tls=true"');
      if (sslEnabled) {
        lines.push(`      - "traefik.http.routers.${routerName}.tls.certresolver=letsencrypt"`);
      }
      lines.push(`      - "traefik.http.services.${routerName}.loadbalancer.server.port=${service.port}"`);
      // HTTP → HTTPS redirect router on the plain entrypoint (spec §34 step 6).
      lines.push(`      - "traefik.http.routers.${routerName}-redirect.rule=Host(\`${domain}\`)"`);
      lines.push(`      - "traefik.http.routers.${routerName}-redirect.entrypoints=web"`);
      lines.push(`      - "traefik.http.routers.${routerName}-redirect.middlewares=${routerName}-https"`);
      lines.push(`      - "traefik.http.middlewares.${routerName}-https.redirectscheme.scheme=https"`);
    }

    if (isApp && manifest.healthcheck?.type === 'command' && manifest.healthcheck.command) {
      lines.push('    healthcheck:');
      lines.push(`      test: ${JSON.stringify(manifest.healthcheck.command)}`);
      lines.push(`      interval: ${manifest.healthcheck.interval}`);
      lines.push(`      timeout: ${manifest.healthcheck.timeout}`);
      lines.push(`      retries: ${manifest.healthcheck.retries}`);
    }

    serviceBlocks.push(`  ${serviceName}:\n${lines.join('\n')}`);
  }

  const appPort = appService.port ?? null;

  const compose = [
    `# CloudHost247 managed deployment — project ${project}`,
    `# Generated by the deployment engine from the application manifest. Edit by hand at your peril:
# the platform regenerates this file on update/reinstall.`,
    `name: ${project}`,
    'services:',
    serviceBlocks.join('\n\n'),
    'networks:',
    `  ${TRAEFIK_NETWORK_NAME}:`,
    '    external: true',
    '  default: {}',
  ];
  if (volumeNames.length > 0) {
    compose.push('volumes:');
    for (const volume of volumeNames) {
      compose.push(`  ${volume}: {}`);
    }
  }

  return { composeYaml: compose.join('\n') + '\n', volumeNames, appPort };
}

/** Environment keys the engine must generate for a manifest dependency database service. */
export function databaseCredentialKeys(database: string): string[] {
  switch (database) {
    case 'postgres':
      return ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'];
    case 'mysql':
    case 'mariadb':
      return ['MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD'];
    case 'mongodb':
      return ['MONGO_INITDB_ROOT_USERNAME', 'MONGO_INITDB_ROOT_PASSWORD'];
    default:
      return [];
  }
}

/** Placeholder substitution for default env templates (e.g. DATABASE_URL in a manifest). */
export function substituteTemplateValue(
  template: string,
  context: { domain?: string | null; url?: string | null; project: string; dbUser?: string; dbName?: string; dbPassword?: string }
): string {
  return template
    .replace(/__DOMAIN__/g, context.domain ?? '')
    .replace(/__URL__/g, context.url ?? '')
    .replace(/__PROJECT__/g, context.project)
    .replace(/__DB_USER__/g, context.dbUser ?? '')
    .replace(/__DB_NAME__/g, context.dbName ?? '')
    .replace(/__DB_PASSWORD__/g, context.dbPassword ?? '');
}
