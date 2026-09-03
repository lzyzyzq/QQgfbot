#!/bin/bash
# AI 唱歌本地换声服务 - 启动脚本
cd "$(dirname "$0")"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8765}"
if [ ! -x .venv/bin/python ]; then
  echo "未安装，先执行 bash install.sh"; exit 1
fi
echo "AI 换声服务启动: http://$HOST:$PORT （首次运行会自动下载 hubert/rmvpe 基础模型，需数分钟）"
exec .venv/bin/python server.py --host "$HOST" --port "$PORT"
