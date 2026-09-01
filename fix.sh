#!/bin/bash
# QQ Bot Platform 服务器一键修复部署脚本
# 用法：把 qq-bot-deploy.zip 和本脚本放到服务器部署目录（如 /var/www/html），执行：bash fix.sh

DEPLOY_DIR=$(pwd)
echo "==============================================="
echo " QQ Bot Platform 修复部署"
echo " 部署目录: $DEPLOY_DIR"
echo "==============================================="

# 1. 解压更新包
if [ -f "$DEPLOY_DIR/qq-bot-deploy.zip" ]; then
    echo "[1/6] 解压更新包..."
    unzip -o qq-bot-deploy.zip -d "$DEPLOY_DIR"
else
    echo "错误: 当前目录未找到 qq-bot-deploy.zip，请先上传"
    exit 1
fi

# 2. 检测 nginx 反代的上游端口
echo "[2/6] 检测 nginx 反代端口..."
PROXY=$(grep -rh "proxy_pass" /etc/nginx/ 2>/dev/null | grep -oE "http://(127.0.0.1|localhost):[0-9]+" | grep -oE "[0-9]+$" | head -1)
if [ -z "$PROXY" ]; then
    PROXY="3100"
    echo "    未检测到 nginx 配置，默认端口 $PROXY（若面板此前用 3000，请改用 PORT=3000）"
else
    echo "    检测到 nginx 上游端口: $PROXY"
fi
export PORT="$PROXY"

# 3. 停止旧进程
echo "[3/6] 停止旧服务..."
pkill -9 -f "node dist/server.js" 2>/dev/null || true
rm -f "$DEPLOY_DIR/.server.pid" "$DEPLOY_DIR/.restart-ready"

# 4. 启动服务
echo "[4/6] 启动服务 (PORT=$PORT)..."
cd "$DEPLOY_DIR"
nohup env PORT=$PORT node dist/server.js > bot.log 2>&1 &

# 5. 本机验证
echo "[5/6] 等待启动并验证..."
sleep 3
curl -s http://127.0.0.1:$PORT/api/health || { echo "    本机 health 失败，请查看 bot.log"; exit 1; }
echo ""

# 6. 公网验证（经 nginx + tailscale）
echo "[6/6] 公网验证..."
curl -s -o /dev/null -w "    health via nginx: %{http_code}\n" https://armbian.tailaa2e36.ts.net/api/health 2>/dev/null || echo "    tailscale 域名验证失败（服务器本机不在 tailnet 时可忽略）"
curl -s -o /dev/null -w "    webhook (/qq/webhook): %{http_code}\n" https://armbian.tailaa2e36.ts.net/qq/webhook 2>/dev/null || echo "    webhook 验证失败（同上可忽略）"

echo "==============================================="
echo " 完成。修复后请在 QQ 开放平台将回调链接设置为:"
echo "   https://armbian.tailaa2e36.ts.net/qq/webhook"
echo "==============================================="
