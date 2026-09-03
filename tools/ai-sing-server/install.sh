#!/bin/bash
# AI 唱歌本地换声服务 - 一键安装（纯 CPU / ARM / Python 3.11 兼容版）
set -e
cd "$(dirname "$0")"

PY=python3
command -v $PY >/dev/null 2>&1 || { echo "需要 python3"; exit 1; }
echo "==> 创建虚拟环境 .venv"
$PY -m venv .venv || { echo "venv 创建失败，先装 python3-venv：apt-get install -y python3-venv"; exit 1; }
. .venv/bin/activate

echo "==> 安装 ffmpeg（缺才装）"
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y ffmpeg
fi

echo "==> 升级 pip"
pip install --upgrade pip

echo "==> 安装 CPU 版 torch/torchaudio（aarch64 与 x86_64 通用 CPU wheel）"
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# rvc-python 的 setup 里 numpy<=1.23.5 在 Python 3.11 无预编译轮子，会尝试源码编译导致失败。
# 因此先装新版 numpy（>=1.24 有 py3.11 wheel），再 --no-deps 装 rvc-python，缺的依赖单独补齐。
echo "==> 安装 numpy（py3.11 兼容版，绕过 rvc-python 旧约束）"
pip install "numpy>=1.24,<2"

echo "==> 安装 rvc-python（--no-deps）"
pip install --no-deps rvc-python

echo "==> 补齐 rvc-python 运行时依赖"
pip install av ffmpeg-python loguru omegaconf==2.0.6 pydantic python-multipart \
  pyworld requests soundfile faiss-cpu==1.7.3 praat-parselmouth torchcrepe fastapi uvicorn

echo "==> 创建 models 目录（每音色独立子目录：models/<音色名>/<音色名>.pth）"
mkdir -p models

echo
echo "完成。把音色模型放入 models/ 后执行： bash run.sh"
echo "提示：首次推理会自动下载 hubert_base.pt / rmvpe.onnx 基础模型（约几百 MB），"
echo "      若服务器访问 HuggingFace 失败，按 RVC-WebUI 官方地址手动下载放入 ~/.cache。"
