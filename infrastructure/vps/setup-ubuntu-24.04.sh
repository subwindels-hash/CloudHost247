#!/usr/bin/env bash
# CloudHost247 — Ubuntu 24.04 VPS provisioning (WHMCS 8.x + Node platform).
#
# Idempotent: safe to re-run. Run once as root on a fresh Ubuntu 24.04 LTS VPS.
#
#   sudo bash infrastructure/vps/setup-ubuntu-24.04.sh
#
# What it installs/configures:
#   - Base hardening: UFW (22/80/443), fail2ban, unattended-upgrades, swapfile
#   - Nginx 1.24 (Ubuntu default) + Certbot
#   - PHP 8.2-FPM from ondrej/php PPA (WHMCS 8.x requires PHP 7.4–8.2; Ubuntu's
#     default PHP 8.3 is NOT supported by WHMCS 8.x) + ionCube Loader
#   - MySQL 8.0 (WHMCS) + PostgreSQL 16 (Node platform)
#   - Node.js 22 LTS from NodeSource (app requires >= 20.9; Ubuntu ships 18)
#   - App user `cloudhost247`, directories, systemd units, Nginx vhosts,
#     PHP-FPM pool, logrotate, fail2ban jail, cron snippet
#
# What it does NOT do (operator steps, see docs/VPS_DEPLOYMENT.md):
#   - Download WHMCS (commercial licence) — scripts/install-whmcs.sh
#   - Create /opt/cloudhost247/.env with secrets
#   - Issue TLS certificates (after DNS points at the VPS)
#   - Run database migrations (deploy.sh does this with CONFIRM_MIGRATION=yes)
#
# Environment overrides (optional):
#   DOMAIN=cloudhost247.com APP_DOMAIN=app.cloudhost247.com
#   APP_USER=cloudhost247 APP_ROOT=/opt/cloudhost247 WHMCS_ROOT=/var/www/whmcs
set -euo pipefail

DOMAIN="${DOMAIN:-cloudhost247.com}"
APP_DOMAIN="${APP_DOMAIN:-app.cloudhost247.com}"
APP_USER="${APP_USER:-cloudhost247}"
APP_ROOT="${APP_ROOT:-/opt/cloudhost247}"
WHMCS_ROOT="${WHMCS_ROOT:-/var/www/whmcs}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Pre-flight
# ---------------------------------------------------------------------------
log "Pre-flight checks"
[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo bash ...)."
[[ -r /etc/os-release ]] || die "Cannot read /etc/os-release."
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "Expected Ubuntu, found ID=${ID:-unknown}."
[[ "${VERSION_CODENAME:-}" == "noble" ]] || die "Expected Ubuntu 24.04 (noble), found ${VERSION_CODENAME:-unknown}. Continue only on noble."
echo "  OS: ${PRETTY_NAME:-Ubuntu 24.04}"
echo "  DOMAIN: ${DOMAIN}  APP_DOMAIN: ${APP_DOMAIN}"
echo "  APP_USER: ${APP_USER}  APP_ROOT: ${APP_ROOT}  WHMCS_ROOT: ${WHMCS_ROOT}"
echo "  SRC_DIR: ${SRC_DIR}"

# ---------------------------------------------------------------------------
# 1. Base packages + hardening
# ---------------------------------------------------------------------------
log "Updating package lists and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  software-properties-common ca-certificates curl wget gnupg \
  ufw fail2ban unattended-upgrades \
  nginx certbot python3-certbot-nginx \
  git unzip tar gzip rsync \
  build-essential python3 \
  libcurl4-openssl-dev libssl-dev libxml2-dev libzip-dev \
  libonig-dev libpng-dev libjpeg-dev libfreetype6-dev \
  libicu-dev libmagickwand-dev libimap-dev libc-client-dev \
  libargon2-dev librabbitmq-dev

log "Configuring unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades || true

log "Adding a 2 GiB swapfile if none exists (small VPS OOM protection)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Configuring UFW (allow 22/tcp, 80/tcp, 443/tcp; default deny inbound)"
# Rules first, then enable — enabling before the SSH rule exists would lock you
# out of the box on a fresh VPS (UFW's default inbound policy is deny).
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ---------------------------------------------------------------------------
# 2. PHP 8.2 (ondrej/php PPA) — WHMCS 8.x requires PHP 7.4–8.2
# ---------------------------------------------------------------------------
log "Installing PHP 8.2 from ondrej/php PPA (Ubuntu default PHP 8.3 is unsupported by WHMCS 8.x)"
add-apt-repository -y ppa:ondrej/php
apt-get update -qq
apt-get install -y -qq \
  php8.2-fpm php8.2-cli \
  php8.2-curl php8.2-json php8.2-openssl php8.2-pdo php8.2-mysql \
  php8.2-mbstring php8.2-dom php8.2-fileinfo php8.2-filter \
  php8.2-gd php8.2-imap php8.2-soap php8.2-xml php8.2-zip \
  php8.2-intl php8.2-bcmath php8.2-readline php8.2-tokenizer \
  php8.2-ctype php8.2-iconv php8.2-simplexml php8.2-phar \
  php8.2-redis php8.2-imagick php8.2-sockets php8.2-exif php8.2-pcdo 2>/dev/null || \
  apt-get install -y -qq \
  php8.2-fpm php8.2-cli \
  php8.2-curl php8.2-json php8.2-openssl php8.2-pdo php8.2-mysql \
  php8.2-mbstring php8.2-dom php8.2-fileinfo php8.2-filter \
  php8.2-gd php8.2-imap php8.2-soap php8.2-xml php8.2-zip \
  php8.2-intl php8.2-bcmath php8.2-readline php8.2-tokenizer \
  php8.2-ctype php8.2-iconv php8.2-simplexml php8.2-phar \
  php8.2-redis php8.2-imagick php8.2-sockets php8.2-exif
update-alternatives --set php /usr/bin/php8.2 || true
php -v | head -n 1

log "Installing ionCube Loader (required by encoded WHMCS addons)"
IONCUBE_VERSION="ionCube_Loader_v14.2.3"
IONCUBE_FILE="${IONCUBE_VERSION}_lin_x86_64.tar.gz"
IONCUBE_URL="https://downloads.ioncube.com/loader_downloads/${IONCUBE_FILE}"
if ! php -m | grep -qi ioncube; then
  tmpdir="$(mktemp -d)"
  wget -q -O "${tmpdir}/${IONCUBE_FILE}" "${IONCUBE_URL}" || die "ionCube download failed from ${IONCUBE_URL}"
  tar -xzf "${tmpdir}/${IONCUBE_FILE}" -C "${tmpdir}"
  IONCUBE_SO="$(find "${tmpdir}" -name 'ioncube_loader_lin_8.2.so' | head -n 1)"
  [[ -n "${IONCUBE_SO}" ]] || die "ionCube loader .so for PHP 8.2 not found in archive."
  install -m 755 "${IONCUBE_SO}" /usr/lib/php/20220829/ioncube_loader_lin_8.2.so
  echo 'zend_extension = /usr/lib/php/20220829/ioncube_loader_lin_8.2.so' \
    > /etc/php/8.2/fpm/conf.d/00-ioncube-loader.ini
  echo 'zend_extension = /usr/lib/php/20220829/ioncube_loader_lin_8.2.so' \
    > /etc/php/8.2/cli/conf.d/00-ioncube-loader.ini
  rm -rf "${tmpdir}"
fi
php -m | grep -i ioncube || die "ionCube Loader not loaded after install."

log "Installing CloudHost247 PHP-FPM pool + ini overrides"
install -m 644 "${SRC_DIR}/infrastructure/vps/php/www.conf" /etc/php/8.2/fpm/pool.d/www.conf
# open_basedir hardcodes the WHMCS root; keep it correct when WHMCS_ROOT is overridden.
sed -i -E "s#^php_admin_value\[open_basedir\] = .*#php_admin_value[open_basedir] = ${WHMCS_ROOT}/:/tmp/:/var/tmp/#" \
  /etc/php/8.2/fpm/pool.d/www.conf
install -m 644 "${SRC_DIR}/infrastructure/vps/php/zz-cloudhost247.ini" /etc/php/8.2/fpm/conf.d/zz-cloudhost247.ini
install -m 644 "${SRC_DIR}/infrastructure/vps/php/zz-cloudhost247.ini" /etc/php/8.2/cli/conf.d/zz-cloudhost247.ini
systemctl enable --now php8.2-fpm

# ---------------------------------------------------------------------------
# 3. MySQL 8.0 (WHMCS) + PostgreSQL 16 (Node)
# ---------------------------------------------------------------------------
log "Installing MySQL 8.0 and PostgreSQL 16"
apt-get install -y -qq mysql-server postgresql-16 postgresql-client-16
systemctl enable --now mysql postgresql

# MySQL: utf8mb4 + InnoDB defaults (WHMCS requirement). Idempotent.
log "Hardening MySQL (utf8mb4, InnoDB, localhost-only)"
mkdir -p /etc/mysql/mysql.conf.d
cat > /etc/mysql/mysql.conf.d/cloudhost247.cnf <<'EOF'
[mysqld]
bind-address = 127.0.0.1
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
default-storage-engine = InnoDB
transaction-isolation = REPEATABLE-READ
sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'
max_connections = 150
EOF
systemctl restart mysql

# PostgreSQL: localhost-only (Node connects via DATABASE_URL on 127.0.0.1).
log "Hardening PostgreSQL (localhost-only)"
PG_HBA="$(ls /etc/postgresql/16/main/pg_hba.conf 2>/dev/null || true)"
if [[ -n "${PG_HBA}" ]]; then
  sed -i -E 's/^(host\s+all\s+all\s+0\.0\.0\.0\/0\s+).*/\1scram-sha-256/' "${PG_HBA}" || true
fi
systemctl restart postgresql || true

# ---------------------------------------------------------------------------
# 4. Node.js 22 LTS (NodeSource) — app requires >= 20.9
# ---------------------------------------------------------------------------
log "Installing Node.js 22 LTS from NodeSource"
if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node --version
npm --version

# ---------------------------------------------------------------------------
# 5. App user + directories
# ---------------------------------------------------------------------------
log "Creating app user and directories"
# --user-group: the systemd units use Group=${APP_USER}, so a same-named group
# must exist (plain `useradd --system` does not create one).
id "${APP_USER}" >/dev/null 2>&1 || useradd --system --user-group --home "${APP_ROOT}" --shell /usr/sbin/nologin "${APP_USER}"
mkdir -p "${APP_ROOT}" "${WHMCS_ROOT}" /var/log/cloudhost247 /var/backups/cloudhost247
# Two separate ownerships: the Node tree belongs to the app user, the WHMCS tree
# to the web server. Never let one write the other.
chown -R "${APP_USER}":"${APP_USER}" "${APP_ROOT}"
chown -R www-data:www-data "${WHMCS_ROOT}"
chmod 755 "${APP_ROOT}" "${WHMCS_ROOT}"
# Shared log dir: the app user writes worker/app logs (systemd journal + files),
# root-run cron jobs write theirs; group adm keeps them readable to ops.
chown -R "${APP_USER}":adm /var/log/cloudhost247 /var/backups/cloudhost247
chmod 2775 /var/log/cloudhost247
chmod 700 /var/backups/cloudhost247
# WHMCS runtime dirs must be writable by the web server.
mkdir -p "${WHMCS_ROOT}/templates_c" "${WHMCS_ROOT}/attachments" "${WHMCS_ROOT}/downloads"
chown -R www-data:www-data "${WHMCS_ROOT}/templates_c" "${WHMCS_ROOT}/attachments" "${WHMCS_ROOT}/downloads"
chmod 775 "${WHMCS_ROOT}/templates_c" "${WHMCS_ROOT}/attachments" "${WHMCS_ROOT}/downloads"

# ---------------------------------------------------------------------------
# 6. Nginx vhosts + snippets
# ---------------------------------------------------------------------------
log "Installing Nginx vhosts (WHMCS + Node) and header snippets"
install -m 644 "${SRC_DIR}/infrastructure/vps/nginx/snippets/security-headers.conf" /etc/nginx/snippets/security-headers.conf
install -m 644 "${SRC_DIR}/infrastructure/vps/nginx/snippets/csp-whmcs.conf" /etc/nginx/snippets/csp-whmcs.conf
mkdir -p /var/www/letsencrypt
chown -R www-data:www-data /var/www/letsencrypt
# Certbot's HTTP-01 challenge must be writable by the certbot process (root) and
# readable over HTTP by Nginx (www-data) — 755 on the directory is how the
# webroot plugin and the ACME location above both work.
chmod 755 /var/www/letsencrypt

# The 443 blocks reference /etc/letsencrypt/live/<domain>/{fullchain,privkey}.pem,
# which do not exist before Certbot runs. Install a throwaway self-signed cert
# at those exact paths so `nginx -t` is green and Certbot's HTTP-01 challenge
# can be served. Certbot replaces these files with the real certificate; if a
# real certificate already exists, leave it untouched (idempotent re-runs).
log "Bootstrapping self-signed certificates (replaced by Certbot later)"
for cert_domain in "${DOMAIN}" "${APP_DOMAIN}"; do
  live_dir="/etc/letsencrypt/live/${cert_domain}"
  if [[ ! -s "${live_dir}/fullchain.pem" || ! -s "${live_dir}/privkey.pem" ]]; then
    mkdir -p "${live_dir}"
    openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
      -keyout "${live_dir}/privkey.pem" -out "${live_dir}/fullchain.pem" \
      -subj "/CN=${cert_domain}" >/dev/null 2>&1
    # The vhosts also reference chain.pem for OCSP stapling (ssl_trusted_certificate).
    cp "${live_dir}/fullchain.pem" "${live_dir}/chain.pem"
    chmod 600 "${live_dir}/privkey.pem"
    # Nginx worker runs as www-data and must be able to traverse/read these.
    chmod 755 /etc/letsencrypt /etc/letsencrypt/live "${live_dir}"
    chmod 644 "${live_dir}/fullchain.pem" "${live_dir}/chain.pem"
    echo "  bootstrapped self-signed cert for ${cert_domain}"
  else
    echo "  certificate already present for ${cert_domain} (left untouched)"
  fi
done

# Render DOMAIN / APP_DOMAIN into the vhosts (placeholders __DOMAIN__ / __APP_DOMAIN__).
for vhost in cloudhost247-whmcs.conf cloudhost247-node.conf; do
  sed -e "s/__DOMAIN__/${DOMAIN}/g" -e "s/__APP_DOMAIN__/${APP_DOMAIN}/g" \
    "${SRC_DIR}/infrastructure/vps/nginx/${vhost}" > "/etc/nginx/sites-available/${vhost}"
done
ln -sf /etc/nginx/sites-available/cloudhost247-whmcs.conf /etc/nginx/sites-enabled/cloudhost247-whmcs.conf
ln -sf /etc/nginx/sites-available/cloudhost247-node.conf /etc/nginx/sites-enabled/cloudhost247-node.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t || die "Nginx config test failed — inspect the error above before continuing."
systemctl enable --now nginx

# ---------------------------------------------------------------------------
# 7. systemd units (Node API + worker)
# ---------------------------------------------------------------------------
log "Installing systemd units"
sed -e "s|__APP_ROOT__|${APP_ROOT}|g" -e "s|__APP_USER__|${APP_USER}|g" \
  "${SRC_DIR}/infrastructure/vps/systemd/cloudhost247-node.service" \
  > /etc/systemd/system/cloudhost247-node.service
sed -e "s|__APP_ROOT__|${APP_ROOT}|g" -e "s|__APP_USER__|${APP_USER}|g" \
  "${SRC_DIR}/infrastructure/vps/systemd/cloudhost247-worker.service" \
  > /etc/systemd/system/cloudhost247-worker.service
systemctl daemon-reload
systemctl enable cloudhost247-node cloudhost247-worker || true

# ---------------------------------------------------------------------------
# 8. Logrotate, fail2ban, cron
# ---------------------------------------------------------------------------
log "Installing logrotate + fail2ban + cron"
install -m 644 "${SRC_DIR}/infrastructure/vps/logrotate/cloudhost247" /etc/logrotate.d/cloudhost247
install -m 644 "${SRC_DIR}/infrastructure/vps/fail2ban/jail.local" /etc/fail2ban/jail.local
systemctl restart fail2ban || true
install -m 644 "${SRC_DIR}/infrastructure/vps/cron/cloudhost247.cron" /etc/cron.d/cloudhost247
# Render SRC_DIR / WHMCS_ROOT / APP_ROOT into the cron file.
sed -i -e "s|__SRC_DIR__|${SRC_DIR}|g" -e "s|__WHMCS_ROOT__|${WHMCS_ROOT}|g" -e "s|__APP_ROOT__|${APP_ROOT}|g" /etc/cron.d/cloudhost247
chmod 644 /etc/cron.d/cloudhost247

log "Provisioning complete."
cat <<EOF

Next steps (see docs/VPS_DEPLOYMENT.md):
  1. Point DNS: ${DOMAIN} and ${APP_DOMAIN} → this VPS IP.
  2. Download the WHMCS ZIP from whmcs.com → /root/whmcs.zip, then run:
       bash ${SRC_DIR}/infrastructure/vps/scripts/install-whmcs.sh /root/whmcs.zip
  3. Create ${APP_ROOT}/.env (copy cloudhost247-node/.env.example, fill secrets).
  4. Run: bash ${SRC_DIR}/infrastructure/vps/scripts/deploy.sh
  5. Issue certificates:
       certbot certonly --webroot -w /var/www/letsencrypt \
         -d ${DOMAIN} -d www.${DOMAIN} -d ${APP_DOMAIN}
       systemctl reload nginx
  6. Verify: bash ${SRC_DIR}/infrastructure/vps/scripts/healthcheck.sh

Versions installed:
  - $(nginx -v 2>&1 | head -n 1)
  - $(php -v | head -n 1)
  - $(node --version) / $(npm --version)
  - $(mysql --version | head -n 1)
  - $(psql --version | head -n 1)
EOF
