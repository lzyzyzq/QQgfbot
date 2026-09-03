# AI 唱歌本地换声服务（纯 CPU / ARM 版）

配合 `plugins/AI唱歌.js` 使用。在机器人同一台服务器（或任意本机）运行，接收歌曲 URL，
经 ffmpeg 裁剪 → RVC 换声（rvc-python，CPU 推理）→ 输出 mp3，供群内语音条播放。

## 适用环境

- Linux aarch64（ARM）或 x86_64，无 NVIDIA 卡也可（纯 CPU 推理）
- Python 3.10 / 3.11（aarch64 上 torch 官方 wheel 支持 3.11）
- 内存建议 ≥ 4G（torch CPU 推理 20~30 秒片段约占 1.5G）；可用内存紧张时先加 swap
- 磁盘充足（模型 + torch 约需 3G）

## 一键安装

```bash
cd tools/ai-sing-server
bash install.sh
```

脚本会：创建 python venv → 安装 ffmpeg（若缺）→ 安装 CPU 版 torch/torchaudio + rvc-python + 服务依赖。

## 放置音色模型

RVC 音色模型是 `.pth` 文件（社区"现成音色"或你自己训练的）。放入：

```
tools/ai-sing-server/models/<音色名>.pth
```

服务按文件名（去扩展名）作为音色 ID，例如 `models/ayaka.pth` → 音色 `ayaka`。

RVC 推理还需要两个基础模型（首次运行自动尝试从 HuggingFace 下载到 `~/.cache`）：
`hubert_base.pt` 与 `rmvpe.onnx`。若服务器无法访问 HuggingFace，参考
https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI 的模型下载地址手动放入。

## 启动

```bash
bash run.sh          # 默认监听 127.0.0.1:8765
```

验证：

```bash
curl http://127.0.0.1:8765/health
# -> {"ok":true,...}
```

建议用 pm2 守护：

```bash
pm2 start run.sh --name ai-sing --interpreter bash
pm2 save
```

## 插件对接

群内发送 `AI唱配置 http://127.0.0.1:8765 ayaka`（主人），即可用 `AI唱 歌名` 点歌。

## API

- `GET /health`：服务状态 + 已加载模型列表
- `POST /job`：`{"url":"<歌曲直链>","model":"<音色ID>","start":30,"dur":25}` 创建任务
  - `url` 支持 http(s) 直链（服务端用 ffmpeg 拉取）
  - `start` 裁剪起点（秒，默认 30）、`dur` 时长（秒，默认 25、上限 40）
  - 返回 `{"job_id":"..."}`
- `GET /job/<job_id>`：任务状态 `{"status":"pending|done|error","message":...}`；`done` 含 `audio_url`
- `GET /audio/<job_id>.mp3`：结果音频（完成后可下载）

## CPU 性能预期

ARM64 4 核纯 CPU 推理 20~25 秒片段约需 1~4 分钟；x86 桌面级 CPU 更快。
`AI唱歌.js` 会先回复「合成中，约需几分钟」，完成后自动把语音条发进群。
