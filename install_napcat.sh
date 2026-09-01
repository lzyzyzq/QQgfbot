#!/bin/bash
# ============================================================
#  NapCat 一键安装脚本（Armbian/Linux，无 Docker）
#  安装目录：/var/www/NapCat（与 /var/www/php 并列）
#  OneBot11 HTTP 端口：7788    WebUI 端口：6099
#  用法：sudo bash install_napcat.sh
# ============================================================
set -e

if [ "$EUID" -ne 0 ]; then
  echo "请用 root 运行：sudo bash install_napcat.sh"
  exit 1
fi

# ---------- 1. 检测架构 ----------
ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64)    QQ_ARCH="arm64";;
  x86_64|amd64)     QQ_ARCH="amd64";;
  *) echo "不支持的架构：$ARCH（仅支持 arm64/x64）"; exit 1;;
esac
echo "架构：$ARCH（QQ_ARCH=$QQ_ARCH）"

# ---------- 2. 下载并安装 Linux QQ ----------
echo "[1/4] 获取 QQ Linux 下载地址..."
if [ "$QQ_ARCH" = "arm64" ]; then
  QQ_DEB="https://qqdl.gtimg.cn/qqfile/QQNT/9.9.32/beta/727ce4e5/linuxqq_3.2.30-50828_arm64.deb"
else
  QQ_DEB="https://qqdl.gtimg.cn/qqfile/QQNT/9.9.32/beta/727ce4e5/linuxqq_3.2.30-50828_amd64.deb"
fi
echo "QQ 下载地址：$QQ_DEB"
cd /tmp
echo "[2/4] 下载并安装 QQ ..."
wget -q -T 120 -O qq.deb "$QQ_DEB"
dpkg -i qq.deb 2>/dev/null || apt-get -f install -y
# QQ 安装目录
if [ -f "/opt/QQ/package.json" ]; then QQ_DIR="/opt/QQ"; else QQ_DIR="/usr/share/QQ"; fi
echo "QQ 安装目录：$QQ_DIR"

# ---------- 3. 确保 NapCat 在 /var/www/NapCat ----------
echo "[3/4] 检查 NapCat 是否就绪 ..."
mkdir -p /var/www/NapCat
cd /var/www/NapCat
if [ ! -f "/var/www/NapCat/napcat.mjs" ]; then
  echo "未检测到 napcat.mjs，开始下载 NapCat ..."
  TAG=$(curl -sL --max-time 15 "https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest" | grep -oP '"tag_name" ?: ?"\K[^"]+' | head -1 || true)
  [ -z "$TAG" ] && TAG="v4.18.19"
  echo "NapCat 版本：$TAG"
  DOWNLOADED=0
  for base in \
    "https://github.com/NapNeko/NapCatQQ/releases/download/$TAG/NapCat.Shell.zip" \
    "https://gh-proxy.com/https://github.com/NapNeko/NapCatQQ/releases/download/$TAG/NapCat.Shell.zip" \
    "https://ghfast.top/https://github.com/NapNeko/NapCatQQ/releases/download/$TAG/NapCat.Shell.zip"; do
    echo "  尝试下载：$base"
    if wget -q -T 90 -O NapCat.Shell.zip "$base" 2>/dev/null && unzip -t NapCat.Shell.zip >/dev/null 2>&1; then
      DOWNLOADED=1
      break
    fi
  done
  if [ "$DOWNLOADED" != "1" ]; then
    echo "NapCat 下载失败，请检查网络后重试"
    exit 1
  fi
  unzip -o -q NapCat.Shell.zip -d /var/www/NapCat
fi
ls /var/www/NapCat/napcat.mjs
chmod -R 755 /var/www/NapCat

# ---------- 4. 注入 NapCat 到 QQ 启动 ----------
echo "[4/4] 注入 NapCat 到 QQ 启动（HTTP 端口 7788）..."
if [ -f "$QQ_DIR/package.json" ]; then
  cp -n "$QQ_DIR/package.json" "$QQ_DIR/package.json.bak" || true
  python3 - <<EOF
import json
p = "$QQ_DIR/package.json"
d = json.load(open(p, encoding="utf-8"))
d["main"] = "/var/www/NapCat/napcat.mjs"
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("QQ 启动入口 ->", d["main"])
EOF
else
  echo "未找到 QQ package.json，注入失败"
  exit 1
fi

# ---------- 5. 安装 xvfb（无显示器环境） ----------
echo "[5/6] 安装 xvfb ..."
apt-get install -y xvfb >/dev/null 2>&1 || true

# ---------- 6. 注册 systemd 服务 ----------
echo "[6/6] 注册 systemd 服务并启动 ..."
cat > /etc/systemd/system/napcat.service <<EOF
[Unit]
Description=NapCat QQ
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/NapCat
Environment=NAPCAT_WEBUI_PREFERRED_PORT=6099
ExecStart=/usr/bin/xvfb-run -a $QQ_DIR/qq --no-sandbox
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now napcat

# 等待 NapCat 生成配置文件后，把 OneBot11 HTTP 端口改为 7788
echo "等待 NapCat 初始化..."
for i in $(seq 1 15); do
  CFG_DIR=$(find /root/.config/QQ -maxdepth 3 -type d -name config 2>/dev/null | head -1)
  [ -n "$CFG_DIR" ] && [ -n "$(ls "$CFG_DIR"/onebot11_*.json 2>/dev/null)" ] && break
  sleep 3
done
CFG_DIR=$(find /root/.config/QQ -maxdepth 3 -type d -name config 2>/dev/null | head -1)
if [ -n "$CFG_DIR" ]; then
  for f in "$CFG_DIR"/onebot11_*.json; do
    [ -f "$f" ] || continue
    python3 - <<EOF
import json
p = "$f"
d = json.load(open(p, encoding="utf-8"))
if "network" not in d:
    d["network"] = {}
servers = d["network"].get("httpServers", [])
if not servers:
    servers = [{"name": "HTTP服务器", "enable": True, "host": "0.0.0.0", "port": 7788}]
    d["network"]["httpServers"] = servers
for s in servers:
    s["enable"] = True
    s["host"] = "0.0.0.0"
    s["port"] = 7788
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("已配置 HTTP 7788 ->", p)
EOF
  done
  systemctl restart napcat || true
fi

echo ""
echo "=================================================="
echo "  安装完成！"
echo "=================================================="
echo "  1. 查看 NapCat 日志（含 WebUI 登录账号密码）："
echo "       journalctl -u napcat -f"
echo "  2. 浏览器打开 WebUI 用另一个 QQ 扫码登录："
echo "       http://<本机IP>:6099/webui"
echo "  3. 登录成功后，OneBot11 HTTP 服务已在 7788 端口："
echo "       http://127.0.0.1:7788"
echo "  4. 回到机器人面板 → NapCat OneBot 连接，填："
echo "       http://127.0.0.1:7788"
echo "     点「测试连接」→ 显示小号昵称 → 「一键同步 QQ 号」"
echo "=================================================="
