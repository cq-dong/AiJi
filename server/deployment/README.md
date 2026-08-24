# AiJi 后端 HTTPS 部署指南

## 当前状况

- 服务器：腾讯云 106.54.26.195（Ubuntu/Debian）
- 后端部署路径：`/opt/aiji`（平铺）
- 进程管理：pm2 `aiji-api`
- 当前前端直连：`http://106.54.26.195`（明文 HTTP，商店审核会质疑）

## 目标架构

```
用户 (HTTPS)
   │
   ▼
域名 → Nginx (443, SSL) ──proxy_pass──► pm2 aiji-api (127.0.0.1:3000)
   │
Let's Encrypt (自动续期)
```

## 域名建议

如果你还没有域名，建议购买以下类型之一：

| 类型 | 示例 | 年费 | 说明 |
|------|------|------|------|
| `.site` 国际域名 | `aiji.site` | ~20-40 元 | **已购买，无需备案，立即可用** |
| `.cn` 国内域名 | `aiji-note.cn` | ~30-50 元 | 国内备案方便，审核友好 |
| `.com` 国际域名 | `aiji-app.com` | ~60-80 元 | 国际通用，Google Play 也适用 |
| `.top` / `.xyz` | `aiji.top` | ~10-30 元 | 便宜，学生友好 |
| 子域名（已有域名） | `api.yourdomain.com` | 0 元 | 如果你有现有域名 |

> 比赛场景下，`.cn` 域名 + 国内备案是最佳选择，但备案需要 7-20 天。如果时间紧，可用 `.top`/`.xyz` 先上架，后续再切到备案域名。

## 操作步骤

### 1. 购买域名并解析

在腾讯云/阿里云/Namecheap 购买域名后，添加一条 **A 记录**：

- 主机记录：`@`（如果使用子域名如 `api`，则填 `api`）
- 记录值：`106.54.26.195`
- TTL：默认

解析生效通常需要几分钟到几小时。可用以下命令验证：

```sh
nslookup aiji.site
```

### 2. 上传部署脚本到服务器

在**本机**（Mac）执行：

```sh
cd /Users/dcq/Desktop/AionUiSpace/AiJi

# 上传 nginx 配置和脚本到服务器
scp server/deployment/nginx-aiji.conf server/deployment/setup-https.sh \
    root@106.54.26.195:/opt/aiji/
```

> 提示：你也可以直接 `cd /opt/aiji && nano setup-https.sh` 在服务器上创建脚本，把本机文件内容粘贴进去。如果 `scp` 因密钥问题失败，这是最快的替代方案。

### 3. 在服务器上执行部署

SSH 登录服务器后执行：

```sh
ssh root@106.54.26.195
cd /opt/aiji
chmod +x setup-https.sh
./setup-https.sh aiji.site your-email@example.com
```

脚本会自动完成：安装 nginx + certbot → 写入配置 → 申请证书 → 启用 HTTPS。

### 4. 验证 HTTPS

```sh
curl -I https://aiji.site/health
# 应返回 200 OK
```

### 5. 更新前端地址

部署完成后，修改本机的 `.env.production`：

```sh
# 修改前
VITE_AIJI_BACKEND=http
VITE_AIJI_BACKEND_BASE=http://106.54.26.195

# 修改后
VITE_AIJI_BACKEND=https
VITE_AIJI_BACKEND_BASE=https://aiji.site
```

然后重新发版：

```sh
npm pkg set version=2.5.1
# ...commit + tag + push，CI 自动构建新 APK
```

### 6. 清理明文 IP 配置

同时修改 `android/app/src/main/res/xml/network_security_config.xml`，移除明文 IP 例外：

```xml
<!-- 修改前 -->
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">106.54.26.195</domain>
    </domain-config>
</network-security-config>

<!-- 修改后 -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```

## 备选：Caddy（更简单的方案）

如果你觉得 Nginx + Certbot 太复杂，可以用 Caddy（自动 HTTPS，一行配置）：

```sh
# 安装 Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy

# 写入 Caddyfile
cat > /etc/caddy/Caddyfile <<'EOF'
aiji.site {
    reverse_proxy 127.0.0.1:3000
}
EOF

# 启动
systemctl restart caddy
```

Caddy 会自动申请和管理证书，无需手动操作 certbot。

## 文件清单

| 文件 | 说明 |
|------|------|
| `nginx-aiji.conf` | Nginx 反向代理 + SSL 配置模板 |
| `setup-https.sh` | 一键部署脚本（Ubuntu/Debian） |
| `README.md` | 本指南 |
