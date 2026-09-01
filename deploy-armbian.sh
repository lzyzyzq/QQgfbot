#!/bin/bash
# Armbian 一键部署/修复脚本
# 用途：解决部署包 node_modules 是 x86_64 编译、Armbian(arm64) 无法加载 better-sqlite3/sharp 的问题
# 用法：在解压后的项目目录执行  bash deploy-armbian.sh
set -e
cd "$(dirname "$0")"

echo "[1/4] 检查编译工具链（better-sqlite3/sharp 可能需要源码编译）..."
if ! command -v gcc >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  echo "    安装 build-essential / python3 ..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential python3
fi

echo "[2/4] 重建 arm64 原生模块（better-sqlite3 / sharp）..."
# 优先走 npm ci 干净重装生产依赖（会自动下载 arm64 版预编译二进制）
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "[3/4] 验证原生模块可加载..."
node -e "
const sharp = require('sharp');
const db = require('better-sqlite3');
new db(':memory:');
Promise.resolve(sharp(10, 10).png().toBuffer()).then(function(){ console.log('sharp OK / better-sqlite3 OK'); }).catch(function(e){ console.error('sharp FAIL:', e.message); process.exit(1); });
"

echo "[4/4] 启动/重启服务（pm2）..."
if pm2 list 2>/dev/null | grep -q qqbot; then
  pm2 restart qqbot --update-env
else
  pm2 start dist/server.js --name qqbot --update-env
fi
pm2 save
sleep 2
pm2 logs qqbot --lines 15
