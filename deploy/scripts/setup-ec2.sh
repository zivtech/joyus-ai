#!/usr/bin/env bash
# Joyus AI — EC2 Provisioning Script
# Run on a fresh Ubuntu 24.04 instance: sudo bash setup-ec2.sh
set -euo pipefail

echo "=== Joyus AI EC2 Setup ==="
echo "Started: $(date -u)"

# --- Docker Engine & Docker Compose v2 ---
echo ">>> Installing Docker..."
if ! command -v docker &>/dev/null; then
    apt-get update
    apt-get install -y ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    echo "Docker installed."
else
    echo "Docker already installed, skipping."
fi

# --- Nginx & Certbot ---
echo ">>> Installing nginx and certbot..."
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable nginx

# --- Fail2ban ---
echo ">>> Installing fail2ban..."
apt-get install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# --- Swap (1GB for t3.small with 2GB RAM) ---
echo ">>> Configuring swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "1GB swap created."
else
    echo "Swap already exists, skipping."
fi

# --- UFW Firewall ---
echo ">>> Configuring firewall..."
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 443/tcp   # HTTPS
ufw allow 80/tcp    # HTTP (certbot + redirect)
ufw --force enable
echo "Firewall configured (22, 80, 443 open)."

# Prevent Docker from bypassing UFW
if [ ! -f /etc/docker/daemon.json ] || ! grep -q '"iptables"' /etc/docker/daemon.json 2>/dev/null; then
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'DOCKER_JSON'
{
  "iptables": false
}
DOCKER_JSON
    systemctl restart docker
    echo "Docker iptables bypass disabled."
fi

# --- Deploy user setup ---
echo ">>> Setting up deploy user..."
usermod -aG docker ubuntu 2>/dev/null || true

# --- Application directory ---
echo ">>> Creating application directory..."
mkdir -p /opt/joyus-ai
chown ubuntu:ubuntu /opt/joyus-ai

# --- Nginx configuration ---
echo ">>> Installing nginx config..."
if [ -f /opt/joyus-ai/deploy/nginx/nginx.conf ]; then
    cp /opt/joyus-ai/deploy/nginx/nginx.conf /etc/nginx/sites-available/joyus-ai
    ln -sf /etc/nginx/sites-available/joyus-ai /etc/nginx/sites-enabled/joyus-ai
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
    echo "Nginx configured."
else
    echo "Nginx config not found yet — will configure after deploy files are copied."
fi

# --- Logrotate for nginx ---
echo ">>> Configuring log rotation..."
if [ -f /opt/joyus-ai/deploy/nginx/logrotate-joyus-ai ]; then
    cp /opt/joyus-ai/deploy/nginx/logrotate-joyus-ai /etc/logrotate.d/nginx-joyus-ai
fi

# --- Certbot (only if domain resolves to this IP) ---
echo ">>> Certbot setup..."
DOMAIN="${DOMAIN:-ai.zivtech.com}"
EMAIL="${LETSENCRYPT_EMAIL:-admin@zivtech.com}"
PUBLIC_IP=$(curl -s http://checkip.amazonaws.com || echo "unknown")
RESOLVED_IP=$(dig +short "$DOMAIN" 2>/dev/null || echo "unresolved")

if [ "$PUBLIC_IP" = "$RESOLVED_IP" ]; then
    echo "DNS resolves to this instance. Requesting TLS certificate..."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" || {
        echo "Certbot failed — will retry after nginx is fully configured."
    }
    # Auto-renewal hook
    mkdir -p /etc/letsencrypt/renewal-hooks/post
    cat > /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh <<'HOOK'
#!/bin/bash
systemctl reload nginx
HOOK
    chmod +x /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh
    systemctl enable certbot.timer
    systemctl start certbot.timer
else
    echo "DNS not yet pointing here (${DOMAIN} -> ${RESOLVED_IP}, this instance -> ${PUBLIC_IP})."
    echo "Run certbot manually after DNS propagates:"
    echo "  sudo certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m ${EMAIL}"
fi

# --- Docker starts on boot ---
systemctl enable docker

echo ""
echo "=== Setup complete ==="
echo "Finished: $(date -u)"
echo ""
echo "Next steps:"
echo "  1. Copy deploy files to /opt/joyus-ai/"
echo "  2. Create /opt/joyus-ai/deploy/.env from .env.example"
echo "  3. Point DNS to this instance's Elastic IP: ${PUBLIC_IP}"
echo "  4. Run certbot after DNS propagates (if not done above)"
echo "  5. Start services: cd /opt/joyus-ai/deploy && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
