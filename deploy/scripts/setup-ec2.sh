#!/usr/bin/env bash
set -euo pipefail

# Joyus AI EC2 bootstrap script.
# Intended for first-run setup on Ubuntu 24.04 instances.

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo ./deploy/scripts/setup-ec2.sh)"
  exit 1
fi

echo "[setup] Updating apt indexes..."
apt-get update -y

echo "[setup] Installing base dependencies..."
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  jq \
  fail2ban \
  ufw

if ! command -v docker >/dev/null 2>&1; then
  echo "[setup] Installing Docker Engine + Compose plugin..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "[setup] Ensuring docker service is enabled..."
systemctl enable docker
systemctl start docker

if [[ -n "${SUDO_USER:-}" ]]; then
  usermod -aG docker "${SUDO_USER}" || true
fi

echo "[setup] Configuring firewall (SSH + HTTPS)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 443/tcp
yes | ufw enable

echo "[setup] Enabling fail2ban..."
systemctl enable fail2ban
systemctl restart fail2ban

echo "[setup] Bootstrap complete."
echo "Next steps:"
echo "  1) Create /opt/joyus-ai and copy repository contents."
echo "  2) Copy deploy/.env.example to deploy/.env and set production secrets."
echo "  3) Run deploy/scripts/deploy.sh <image-tag> from /opt/joyus-ai."
