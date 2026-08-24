#!/usr/bin/env bash
# AiJi 后端 HTTPS 一键部署脚本
# 运行环境：腾讯云 Ubuntu/Debian（106.54.26.195）
# 前置条件：已购买域名并解析到本机 IP

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [ -z "$DOMAIN" ]; then
    echo "Usage: ./setup-https.sh <your-domain.com> <your-email@example.com>"
    echo "Example: ./setup-https.sh aiji.site yourname@example.com"
    exit 1
fi
if [ -z "$EMAIL" ]; then
    echo "Error: email is required for Let's Encrypt registration."
    echo "Usage: ./setup-https.sh aiji.site yourname@example.com"
    exit 1
fi

echo "=== AiJi HTTPS 部署 ==="
echo "域名: $DOMAIN"
echo "邮箱: $EMAIL"
echo "服务器 IP: $(curl -sL ifconfig.me || echo 'unknown')"
echo ""

# 等待用户确认 DNS 已解析
echo "请确认域名 $DOMAIN 的 A 记录已指向本服务器 IP。"
echo "如果还没配置，请先去腾讯云控制台添加 A 记录后再继续。"
echo ""
read -p "按 Enter 继续，或 Ctrl+C 取消..."
echo ""

# 1. 安装依赖
echo "[1/6] 安装 nginx 和 certbot..."
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx

# 2. 创建 certbot webroot
echo "[2/6] 创建 certbot 验证目录..."
mkdir -p /var/www/certbot

# 3. 写入 nginx 配置（替换域名占位符）
echo "[3/6] 写入 Nginx 配置..."
NGINX_CONF="/etc/nginx/sites-available/aiji"
sed "s/YOUR_DOMAIN/$DOMAIN/g" nginx-aiji.conf > "$NGINX_CONF"

# 禁用默认站点，启用 aiji
rm -f /etc/nginx/sites-enabled/default
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/aiji

# 测试配置
nginx -t

# 4. 先启动 nginx（HTTP 模式）用于 ACME 验证
echo "[4/6] 启动 Nginx..."
systemctl restart nginx
systemctl enable nginx

# 5. 申请 Let's Encrypt 证书
echo "[5/6] 申请 SSL 证书（Let's Encrypt）..."
certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --agree-tos \
    --non-interactive \
    --email "$EMAIL" \
    || {
        echo "证书申请失败。请确认："
        echo "  1. 域名 $DOMAIN 已解析到本服务器 IP"
        echo "  2. 服务器 80 端口已开放"
        exit 1
    }

# 6. 重新加载 nginx（HTTPS 配置生效）
echo "[6/6] 重载 Nginx（启用 HTTPS）..."
systemctl reload nginx

# 7. 自动续期测试
echo ""
echo "=== 配置自动续期 ==="
systemctl status certbot.timer --no-pager || true
echo "Certbot 已配置自动续期，无需手动维护。"

echo ""
echo "=== 部署完成 ==="
echo "HTTPS 地址: https://$DOMAIN"
echo ""
echo "请验证："
echo "  curl -I https://$DOMAIN/health"
echo ""
echo "下一步：更新前端 .env.production 中的 VITE_AIJI_BACKEND_BASE 为 https://$DOMAIN"
