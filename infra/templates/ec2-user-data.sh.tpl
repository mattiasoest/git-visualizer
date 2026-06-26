#!/bin/bash
set -euxo pipefail

exec > /var/log/gitvisualizer-user-data.log 2>&1

IMDS_TOKEN="$(curl -fsSL -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")"
API_HOSTNAME="$(curl -fsSL -H "X-aws-ec2-metadata-token: ${IMDS_TOKEN}" http://169.254.169.254/latest/meta-data/public-hostname)"
CORS_ORIGIN="${cors_allowed_origin}"
GITHUB_TOKEN_PARAMETER="${github_token_parameter}"
AWS_REGION="${aws_region}"

dnf update -y
dnf install -y curl tar gzip awscli

ARCH="$(uname -m)"
case "$ARCH" in
  aarch64) JDK_ARCH="aarch64" ;;
  x86_64)  JDK_ARCH="x64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

JDK_URL="https://api.adoptium.net/v3/binary/latest/25/ga/linux/${JDK_ARCH}/jdk/hotspot/normal/eclipse"
curl -fsSL "$JDK_URL" -o /tmp/jdk.tar.gz
mkdir -p /opt/jdk
tar -xzf /tmp/jdk.tar.gz -C /opt/jdk --strip-components=1
ln -sf /opt/jdk/bin/java /usr/local/bin/java
java -version

curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${ARCH}" -o /usr/bin/caddy
chmod +x /usr/bin/caddy
setcap 'cap_net_bind_service=+ep' /usr/bin/caddy
caddy version

id caddy &>/dev/null || useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy
mkdir -p /var/lib/caddy
chown caddy:caddy /var/lib/caddy

cat >/etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

id gitvisualizer &>/dev/null || useradd --system --home /opt/gitvisualizer --shell /sbin/nologin gitvisualizer
mkdir -p /opt/gitvisualizer /etc/caddy /etc/gitvisualizer
chown -R gitvisualizer:gitvisualizer /opt/gitvisualizer

cat >/etc/caddy/Caddyfile <<EOF
$API_HOSTNAME {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }

    header {
        -Server
    }
}
EOF
chown caddy:caddy /etc/caddy/Caddyfile

cat >/etc/systemd/system/gitvisualizer.service <<'EOF'
[Unit]
Description=Git Visualizer Spring Boot API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gitvisualizer
Group=gitvisualizer
WorkingDirectory=/opt/gitvisualizer
EnvironmentFile=-/etc/gitvisualizer/env
ExecStart=/usr/bin/java -Xms128m -Xmx512m -jar /opt/gitvisualizer/gitvisualizer.jar
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

GITHUB_TOKEN=""
if [[ -n "$GITHUB_TOKEN_PARAMETER" ]]; then
  GITHUB_TOKEN="$(aws ssm get-parameter \
    --name "$GITHUB_TOKEN_PARAMETER" \
    --with-decryption \
    --region "$AWS_REGION" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || true)"
fi

cat >/etc/gitvisualizer/env <<EOF
SERVER_PORT=8080
SPRING_WEB_CORS_ALLOWED_ORIGINS=$CORS_ORIGIN
GITHUB_TOKEN=$GITHUB_TOKEN
EOF
chmod 600 /etc/gitvisualizer/env
chown root:gitvisualizer /etc/gitvisualizer/env

systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

if [[ -f /opt/gitvisualizer/gitvisualizer.jar ]]; then
  systemctl enable gitvisualizer
  systemctl restart gitvisualizer
else
  echo "No JAR at /opt/gitvisualizer/gitvisualizer.jar yet. Deploy with scripts/deploy-backend.sh"
fi
