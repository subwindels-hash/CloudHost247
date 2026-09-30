-- ============================================================================
-- Migration 0043: Extend Control Panels and Create Commercial Control Panel Plans
-- ============================================================================

-- 1. Extend control_panels with category, logo, URLs, requirements, supported OS, and capabilities
ALTER TABLE control_panels
  ADD COLUMN IF NOT EXISTS category varchar(64) NOT NULL DEFAULT 'SERVER_PANEL',
  ADD COLUMN IF NOT EXISTS description text NULL,
  ADD COLUMN IF NOT EXISTS logo_url varchar(512) NULL,
  ADD COLUMN IF NOT EXISTS website_url varchar(512) NULL,
  ADD COLUMN IF NOT EXISTS documentation_url varchar(512) NULL,
  ADD COLUMN IF NOT EXISTS installation_method varchar(32) NOT NULL DEFAULT 'SCRIPT',
  ADD COLUMN IF NOT EXISTS requires_license boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS license_provider varchar(64) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS minimum_ram_mb integer NOT NULL DEFAULT 1024,
  ADD COLUMN IF NOT EXISTS minimum_cpu_cores integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS minimum_disk_gb integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS supported_os varchar(64)[] NOT NULL DEFAULT ARRAY['ubuntu', 'debian']::varchar(64)[],
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'control_panels_category_check'
  ) THEN
    ALTER TABLE control_panels ADD CONSTRAINT control_panels_category_check
      CHECK (category IN ('SERVER_PANEL', 'APPLICATION_DEPLOYMENT_PLATFORM', 'SERVER_MANAGEMENT', 'OTHER'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'control_panels_installation_method_check'
  ) THEN
    ALTER TABLE control_panels ADD CONSTRAINT control_panels_installation_method_check
      CHECK (installation_method IN ('SCRIPT', 'CLOUD_INIT', 'AGENT', 'DOCKER', 'API', 'MANUAL'));
  END IF;
END $$;

-- 2. Create control_panel_plans table for commercial licensing and quotas
CREATE TABLE IF NOT EXISTS control_panel_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_panel_id uuid NOT NULL REFERENCES control_panels(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  description text NULL,
  billing_cycle varchar(32) NOT NULL DEFAULT 'monthly',
  price numeric(10,2) NOT NULL DEFAULT 0.00,
  currency varchar(3) NOT NULL DEFAULT 'USD',
  setup_fee numeric(10,2) NOT NULL DEFAULT 0.00,
  license_type varchar(64) NOT NULL DEFAULT 'FREE',
  included_domains integer NULL,
  included_accounts integer NULL,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_panel_plans_billing_cycle_check CHECK (
    billing_cycle IN ('one_time', 'monthly', 'quarterly', 'semi_annually', 'annually')
  ),
  CONSTRAINT control_panel_plans_status_check CHECK (
    status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')
  )
);

CREATE INDEX IF NOT EXISTS control_panel_plans_panel_idx ON control_panel_plans (control_panel_id, status);

-- 3. Seed / Update all 18 requested control panels with official metadata, capabilities, and system requirements
INSERT INTO control_panels (
  id, name, slug, category, description, logo_url, website_url, documentation_url,
  status, installation_method, requires_license, license_provider, minimum_ram_mb,
  minimum_cpu_cores, minimum_disk_gb, supported_os, capabilities, sort_order
) VALUES
  ('30000000-0000-0000-0000-000000000001', 'cPanel & WHM', 'cpanel', 'SERVER_PANEL',
   'Industry standard web hosting control panel with automated server management, multi-tier account administration, and comprehensive mail/DNS suites.',
   '/panel-logos/cpanel.svg', 'https://cpanel.net', 'https://docs.cpanel.net',
   'ACTIVE', 'SCRIPT', true, 'CPANEL', 2048, 1, 40,
   ARRAY['almalinux', 'rocky-linux', 'ubuntu', 'cloudlinux']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": true, "ssl": true, "docker": false, "reseller": true, "multi_user": true, "backups": true, "file_manager": true, "php_version_switch": true}'::jsonb,
   10),

  ('30000000-0000-0000-0000-000000000002', 'Plesk Obsidian', 'plesk', 'SERVER_PANEL',
   'Leading WebOps hosting platform for building, securing, and running websites and applications in multi-cloud environments.',
   '/panel-logos/plesk.svg', 'https://www.plesk.com', 'https://docs.plesk.com',
   'ACTIVE', 'SCRIPT', true, 'PLESK', 1024, 1, 20,
   ARRAY['ubuntu', 'debian', 'almalinux', 'rocky-linux']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": true, "ssl": true, "docker": true, "reseller": true, "multi_user": true, "backups": true, "git": true, "nodejs": true, "wordpress_toolkit": true}'::jsonb,
   20),

  ('30000000-0000-0000-0000-000000000003', 'DirectAdmin', 'directadmin', 'SERVER_PANEL',
   'Fast, lightweight, and resource-efficient web hosting control panel offering complete domain, email, and database administration.',
   '/panel-logos/directadmin.svg', 'https://directadmin.com', 'https://docs.directadmin.com',
   'ACTIVE', 'SCRIPT', true, 'DIRECTADMIN', 1024, 1, 20,
   ARRAY['almalinux', 'rocky-linux', 'debian', 'ubuntu']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": true, "ssl": true, "docker": false, "reseller": true, "multi_user": true, "backups": true}'::jsonb,
   30),

  ('30000000-0000-0000-0000-000000000004', 'CyberPanel', 'cyberpanel', 'SERVER_PANEL',
   'Next-generation web hosting control panel powered by OpenLiteSpeed with built-in LSCache, staging, and container tools.',
   '/panel-logos/cyberpanel.svg', 'https://cyberpanel.net', 'https://community.cyberpanel.net/docs',
   'ACTIVE', 'SCRIPT', false, 'NONE', 1024, 1, 10,
   ARRAY['almalinux', 'ubuntu']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": true, "ssl": true, "docker": true, "reseller": false, "multi_user": true, "backups": true, "litespeed": true, "staging": true}'::jsonb,
   40),

  ('30000000-0000-0000-0000-000000000005', 'Webmin', 'webmin', 'SERVER_PANEL',
   'Web-based system administration interface for Unix-like servers covering users, disks, firewalls, services, and packages.',
   '/panel-logos/webmin.svg', 'https://webmin.com', 'https://webmin.com/docs',
   'ACTIVE', 'SCRIPT', false, 'NONE', 512, 1, 5,
   ARRAY['ubuntu', 'debian', 'almalinux', 'rocky-linux', 'fedora-cloud', 'centos', 'opensuse']::varchar(64)[],
   '{"domains": false, "databases": true, "email": false, "dns": true, "ssl": true, "docker": false, "multi_user": true, "system_admin": true, "firewall": true, "package_manager": true}'::jsonb,
   50),

  ('30000000-0000-0000-0000-000000000006', 'HestiaCP', 'hestiacp', 'SERVER_PANEL',
   'Fast and clean open-source Linux web server control panel designed for easy administration of websites, email, and databases.',
   '/panel-logos/hestiacp.svg', 'https://hestiacp.com', 'https://hestiacp.com/docs',
   'ACTIVE', 'SCRIPT', false, 'NONE', 1024, 1, 10,
   ARRAY['debian', 'ubuntu']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": true, "ssl": true, "docker": false, "reseller": false, "multi_user": true, "backups": true, "php_version_switch": true}'::jsonb,
   60),

  ('30000000-0000-0000-0000-000000000007', 'CloudPanel', 'cloudpanel', 'SERVER_PANEL',
   'High-performance server control panel built for PHP, Node.js, Python, and static apps with NGINX, MySQL, and Redis.',
   '/panel-logos/cloudpanel.svg', 'https://www.cloudpanel.io', 'https://www.cloudpanel.io/docs',
   'ACTIVE', 'SCRIPT', false, 'NONE', 1024, 1, 15,
   ARRAY['ubuntu', 'debian']::varchar(64)[],
   '{"domains": true, "databases": true, "email": false, "dns": false, "ssl": true, "docker": true, "multi_user": true, "nodejs": true, "python": true, "php_version_switch": true, "nginx_varnish": true}'::jsonb,
   70),

  ('30000000-0000-0000-0000-000000000008', 'aaPanel', 'aapanel', 'SERVER_PANEL',
   'Modular web hosting control panel supporting one-click LNMP/LAMP stack installations and visual server management.',
   '/panel-logos/aapanel.svg', 'https://www.aapanel.com', 'https://doc.aapanel.com',
   'ACTIVE', 'SCRIPT', false, 'NONE', 1024, 1, 10,
   ARRAY['ubuntu', 'debian', 'almalinux', 'rocky-linux']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": true, "ssl": true, "docker": true, "multi_user": false, "backups": true, "ftp": true, "file_manager": true}'::jsonb,
   80),

  ('30000000-0000-0000-0000-000000000009', 'FASTPANEL', 'fastpanel', 'SERVER_PANEL',
   'Simple and fast web hosting control panel with intuitive site creation, multi-PHP switching, mail, and Let''s Encrypt.',
   '/panel-logos/fastpanel.svg', 'https://fastpanel.direct', 'https://fastpanel.direct/wiki',
   'ACTIVE', 'SCRIPT', true, 'INTERNAL', 1024, 1, 10,
   ARRAY['debian', 'ubuntu', 'almalinux', 'rocky-linux']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": true, "ssl": true, "docker": false, "multi_user": true, "backups": true, "multi_php": true, "web_terminal": true}'::jsonb,
   90),

  ('30000000-0000-0000-0000-000000000010', 'Webuzo', 'webuzo', 'SERVER_PANEL',
   'Multi-user control panel offering automated web server provisioning, domain handling, and one-click Softaculous app installs.',
   '/panel-logos/webuzo.svg', 'https://webuzo.com', 'https://webuzo.com/docs',
   'ACTIVE', 'SCRIPT', true, 'WEBUZO', 1024, 1, 10,
   ARRAY['almalinux', 'rocky-linux', 'ubuntu']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": true, "ssl": true, "docker": false, "multi_user": true, "backups": true, "softaculous": true}'::jsonb,
   100),

  ('30000000-0000-0000-0000-000000000011', 'TinyCP', 'tinycp', 'SERVER_PANEL',
   'Lightweight Linux control panel for managing domains, databases, mail accounts, Samba shares, and VPN connections.',
   '/panel-logos/tinycp.svg', 'https://tinycp.com', 'https://tinycp.com/docs',
   'ACTIVE', 'SCRIPT', false, 'NONE', 512, 1, 5,
   ARRAY['ubuntu', 'debian']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": false, "ssl": true, "docker": false, "multi_user": false, "samba": true, "openvpn": true}'::jsonb,
   110),

  ('30000000-0000-0000-0000-000000000012', 'Kusanagi', 'kusanagi', 'SERVER_PANEL',
   'Ultra-fast WordPress and PHP execution environment by Prime Strategy optimized for enterprise web performance and caching.',
   '/panel-logos/kusanagi.svg', 'https://kusanagi.tokyo', 'https://kusanagi.tokyo/document',
   'ACTIVE', 'SCRIPT', false, 'NONE', 2048, 1, 20,
   ARRAY['almalinux', 'rocky-linux', 'centos']::varchar(64)[],
   '{"domains": true, "databases": true, "email": false, "dns": false, "ssl": true, "docker": false, "multi_user": false, "wordpress_speed_stack": true, "page_cache": true}'::jsonb,
   120),

  ('30000000-0000-0000-0000-000000000013', 'Dokploy', 'dokploy', 'APPLICATION_DEPLOYMENT_PLATFORM',
   'Open-source PaaS platform for deploying applications, databases, and Docker Compose projects with Traefik routing and SSL.',
   '/panel-logos/dokploy.svg', 'https://dokploy.com', 'https://docs.dokploy.com',
   'ACTIVE', 'DOCKER', false, 'NONE', 2048, 1, 20,
   ARRAY['ubuntu', 'debian']::varchar(64)[],
   '{"domains": true, "databases": true, "email": false, "dns": false, "ssl": true, "docker": true, "docker_compose": true, "traefik": true, "git_deploy": true, "multi_user": true, "preview_deployments": true}'::jsonb,
   130),

  ('30000000-0000-0000-0000-000000000014', 'Coolify', 'coolify', 'APPLICATION_DEPLOYMENT_PLATFORM',
   'Self-hostable, all-in-one developer PaaS alternative to Heroku/Netlify supporting Git deployments, Docker, and S3 backups.',
   '/panel-logos/coolify.svg', 'https://coolify.io', 'https://coolify.io/docs',
   'ACTIVE', 'DOCKER', false, 'NONE', 2048, 2, 30,
   ARRAY['ubuntu', 'debian']::varchar(64)[],
   '{"domains": true, "databases": true, "email": false, "dns": false, "ssl": true, "docker": true, "docker_compose": true, "traefik": true, "git_deploy": true, "s3_backups": true, "multi_user": true, "webhooks": true}'::jsonb,
   140),

  ('30000000-0000-0000-0000-000000000015', 'Easypanel', 'easypanel', 'APPLICATION_DEPLOYMENT_PLATFORM',
   'Next-generation Docker management panel for full-stack apps, one-click databases, and automated SSL termination.',
   '/panel-logos/easypanel.svg', 'https://easypanel.io', 'https://easypanel.io/docs',
   'ACTIVE', 'DOCKER', false, 'NONE', 1024, 1, 20,
   ARRAY['ubuntu', 'debian']::varchar(64)[],
   '{"domains": true, "databases": true, "email": false, "dns": false, "ssl": true, "docker": true, "docker_compose": true, "traefik": true, "git_deploy": true, "app_templates": true}'::jsonb,
   150),

  ('30000000-0000-0000-0000-000000000016', 'Cloudron', 'cloudron', 'APPLICATION_DEPLOYMENT_PLATFORM',
   'Turnkey server platform for self-hosting containerized smart applications with automated updates, DNS, and backups.',
   '/panel-logos/cloudron.svg', 'https://cloudron.io', 'https://docs.cloudron.io',
   'ACTIVE', 'SCRIPT', true, 'CLOUDRON', 2048, 2, 20,
   ARRAY['ubuntu']::varchar(64)[],
   '{"domains": true, "databases": true, "email": true, "dns": true, "ssl": true, "docker": true, "smart_apps": true, "unified_auth": true, "automated_backups": true}'::jsonb,
   160),

  ('30000000-0000-0000-0000-000000000017', 'Cosmos Cloud', 'cosmos', 'APPLICATION_DEPLOYMENT_PLATFORM',
   'Secure self-hosting operating platform featuring container management, integrated reverse proxy, 2FA, and app marketplace.',
   '/panel-logos/cosmos.svg', 'https://cosmos-cloud.io', 'https://cosmos-cloud.io/doc',
   'ACTIVE', 'DOCKER', false, 'NONE', 1024, 1, 10,
   ARRAY['ubuntu', 'debian']::varchar(64)[],
   '{"domains": true, "databases": false, "email": false, "dns": false, "ssl": true, "docker": true, "reverse_proxy": true, "app_store": true, "two_factor": true, "anti_bot": true}'::jsonb,
   170),

  ('30000000-0000-0000-0000-000000000018', 'AdminBolt', 'adminbolt', 'SERVER_MANAGEMENT',
   'Centralized server management and telemetry agent providing automated health alerts, service tracking, and security monitoring.',
   '/panel-logos/adminbolt.svg', 'https://adminbolt.com', 'https://adminbolt.com/docs',
   'ACTIVE', 'AGENT', false, 'NONE', 512, 1, 5,
   ARRAY['ubuntu', 'debian', 'almalinux', 'rocky-linux']::varchar(64)[],
   '{"domains": false, "databases": false, "email": false, "dns": false, "ssl": false, "docker": false, "system_monitoring": true, "service_health": true, "remote_management": true, "security_audits": true}'::jsonb,
   180)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  logo_url = EXCLUDED.logo_url,
  website_url = EXCLUDED.website_url,
  documentation_url = EXCLUDED.documentation_url,
  status = EXCLUDED.status,
  installation_method = EXCLUDED.installation_method,
  requires_license = EXCLUDED.requires_license,
  license_provider = EXCLUDED.license_provider,
  minimum_ram_mb = EXCLUDED.minimum_ram_mb,
  minimum_cpu_cores = EXCLUDED.minimum_cpu_cores,
  minimum_disk_gb = EXCLUDED.minimum_disk_gb,
  supported_os = EXCLUDED.supported_os,
  capabilities = EXCLUDED.capabilities,
  sort_order = EXCLUDED.sort_order;

-- 4. Seed default plans for panels
INSERT INTO control_panel_plans (
  id, control_panel_id, name, description, billing_cycle, price, currency, license_type, included_domains, included_accounts, status
) VALUES
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'cPanel Solo', '1 cPanel Account / 1 Domain license', 'monthly', 17.49, 'USD', 'SOLO', 1, 1, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'cPanel Admin (Up to 5 Accounts)', 'Up to 5 cPanel accounts for growing sites', 'monthly', 29.99, 'USD', 'ADMIN', NULL, 5, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'cPanel Pro (Up to 30 Accounts)', 'Up to 30 cPanel accounts for agencies and VPS', 'monthly', 42.99, 'USD', 'PRO', NULL, 30, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', 'Plesk Web Admin Edition', 'Up to 10 domains, optimized for basic web administration', 'monthly', 12.50, 'USD', 'ADMIN', 10, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000002', 'Plesk Web Pro Edition', 'Up to 30 domains with WordPress Toolkit and developer packs', 'monthly', 18.50, 'USD', 'PRO', 30, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000003', 'DirectAdmin Standard License', 'Unlimited domains and accounts with standard direct updates', 'monthly', 15.00, 'USD', 'STANDARD', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000004', 'CyberPanel Community Edition', 'Free OpenLiteSpeed edition with unlimited domains and cache', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000005', 'Webmin Standard Interface', 'Open-source system administration suite with full server management', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000006', 'HestiaCP Community Edition', 'Open-source free lightweight panel with unlimited domains', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000007', 'CloudPanel Free Edition', 'Free high-performance PHP/Node/Python stack', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000008', 'aaPanel Community Edition', 'Free modular Linux server control panel', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000009', 'FASTPANEL Standard License', 'Free basic license for 1 server with multi-PHP', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000013', '30000000-0000-0000-0000-000000000010', 'Webuzo Free Trial / Single User', 'Webuzo server license for 1 domain', 'monthly', 0.00, 'USD', 'FREE', 1, 1, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000014', '30000000-0000-0000-0000-000000000011', 'TinyCP Community Edition', 'Free lightweight Linux control panel', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000015', '30000000-0000-0000-0000-000000000012', 'Kusanagi High-Speed Edition', 'Ultra-fast WordPress environment optimized for Prime Strategy stacks', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000016', '30000000-0000-0000-0000-000000000013', 'Dokploy Community Edition', 'Open-source deployment platform for Docker and Traefik', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000017', '30000000-0000-0000-0000-000000000014', 'Coolify Self-Hosted Edition', 'Open-source all-in-one developer PaaS engine', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000018', '30000000-0000-0000-0000-000000000015', 'Easypanel Free Tier', 'Up to 3 projects with one-click app templates', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000019', '30000000-0000-0000-0000-000000000016', 'Cloudron Starter (2 Apps Free)', 'Free tier for up to 2 apps with full email/DNS automation', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000020', '30000000-0000-0000-0000-000000000017', 'Cosmos Community Edition', 'Open-source self-hosting and container management suite', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE'),
  ('31000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000018', 'AdminBolt Agent & Monitoring', 'Automated server telemetry and health monitoring agent', 'monthly', 0.00, 'USD', 'FREE', NULL, NULL, 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  billing_cycle = EXCLUDED.billing_cycle,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  license_type = EXCLUDED.license_type,
  included_domains = EXCLUDED.included_domains,
  included_accounts = EXCLUDED.included_accounts,
  status = EXCLUDED.status;
