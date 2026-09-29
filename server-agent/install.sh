#!/usr/bin/env bash
#
# CloudHost247 Server Agent installer (run as root on a fresh VPS/dedicated server).
#
# Installs the agent under /opt/cloudhost247/agent, creates a dedicated unprivileged
# `cloudhost-agent` system user that owns the deployment tree, and registers a systemd unit.
#
# Usage:
#   sudo CH247_AGENT_ID=... CH247_AGENT_SECRET=... CH247_CONTROL_URL=https://portal.cloudhost247.com \
#        ./install.sh
#
# Security model (docs/SERVER_AGENT.md):
#   - The agent runs as its own user with access to the Docker socket via the `docker` group.
#   - It binds to 127.0.0.1 by default: put it behind Traefik/TLS or an IP-allowlisted proxy.
#   - The agent secret grants ONLY this agent's fixed operation set — never the Docker API.
set -euo pipefail

: "${CH247_AGENT_ID:?CH247_AGENT_ID is required}"
: "${CH247_AGENT_SECRET:?CH247_AGENT_SECRET is required}"
: "${CH247_CONTROL_URL:?CH247_CONTROL_URL is required}"

INSTALL_DIR="/opt/cloudhost247/agent"
APPS_DIR="/opt/cloudhost247/apps"
BACKUP_DIR="/opt/cloudhost247/backups"
AGENT_USER="cloudhost-agent"

echo "==> CloudHost247 agent installer"

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(process.versions.node >= "20" ? 0 : 1)'; then
  echo "!! Node.js >= 20 is required (apt install nodejs via NodeSource, or your distro's nodejs)." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "!! Docker is required (https://docs.docker.com/engine/install/)." >&2
  exit 1
fi

echo "==> Creating service user ${AGENT_USER}"
id -u "${AGENT_USER}" >/dev/null 2>&1 || useradd --system --home-dir /opt/cloudhost247 --shell /usr/sbin/nologin "${AGENT_USER}"
usermod -aG docker "${AGENT_USER}"

echo "==> Installing files"
mkdir -p "${INSTALL_DIR}/src" "${APPS_DIR}" "${BACKUP_DIR}"
cp -r src/* "${INSTALL_DIR}/src/"
cp package.json "${INSTALL_DIR}/"
chown -R "${AGENT_USER}:${AGENT_USER}" /opt/cloudhost247

echo "==> Writing environment file (root-only)"
install -m 600 /dev/null /etc/cloudhost247-agent.env
cat > /etc/cloudhost247-agent.env <<EOF
CH247_AGENT_ID=${CH247_AGENT_ID}
CH247_AGENT_SECRET=${CH247_AGENT_SECRET}
CH247_CONTROL_URL=${CH247_CONTROL_URL}
CH247_PORT=${CH247_PORT:-8787}
CH247_BIND=${CH247_BIND:-127.0.0.1}
CH247_APPS_DIR=${APPS_DIR}
CH247_BACKUP_DIR=${BACKUP_DIR}
EOF

echo "==> Installing systemd unit"
cat > /etc/systemd/system/cloudhost247-agent.service <<EOF
[Unit]
Description=CloudHost247 Server Agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${AGENT_USER}
EnvironmentFile=/etc/cloudhost247-agent.env
ExecStart=$(command -v node) ${INSTALL_DIR}/src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/cloudhost247
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now cloudhost247-agent.service

echo "==> Done. Status:"
systemctl --no-pager status cloudhost247-agent.service || true
echo
echo "Next steps:"
echo "  1. Point the platform at this agent (admin portal → Servers → agent URL)."
echo "  2. Expose ${CH247_BIND:-127.0.0.1}:${CH247_PORT:-8787} to the control plane ONLY (TLS or IP allowlist)."
