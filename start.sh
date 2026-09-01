#!/bin/bash

echo "===================================="
echo "  QQ Bot Platform"
echo "===================================="
echo ""

# 安装后端依赖
if [ ! -d "node_modules" ]; then
  echo "[1/3] 安装后端依赖..."
  npm install
fi

# 安装前端依赖
if [ ! -d "web/node_modules" ]; then
  echo "[2/3] 安装前端依赖..."
  cd web && npm install && cd ..
fi

# 编译
echo "[3/3] 编译项目..."
npx tsc
cd web && npm run build && cd ..

# 启动
echo ""
echo "===================================="
echo "  启动服务..."
echo "===================================="
node dist/server.js
