#!/usr/bin/env python3
"""
AI 唱歌本地换声服务（纯 CPU / ARM 版）
用法： python server.py [--host 127.0.0.1] [--port 8765]
流程： 接收歌曲直链 -> ffmpeg 拉取+裁剪 -> 调 rvc-python CLI 换声(CPU) -> 输出 mp3
换声引擎： rvc-python 官方 CLI（python -m rvc_python cli ...），首跑自动下载 hubert/rmvpe 基础模型
"""
import argparse, json, os, re, shutil, subprocess, threading, time, uuid, urllib.request, sys

BASE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE, "models")     # 放 *.pth（推荐每模型独立子目录含同名 .pth/.index）
JOBS_DIR = os.path.join(BASE, "jobs")
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(JOBS_DIR, exist_ok=True)
VENV_PY = os.path.join(BASE, ".venv", "bin", "python")

JOBS = {}
JOBS_LOCK = threading.Lock()
WORKERS = 1  # CPU 机器并发 1 防止 OOM


def log(msg):
    print("[ai-sing] %s" % msg, flush=True)


def list_models():
    """收集 rvc_models/models 下独立子目录（含 .pth）的模型名。"""
    roots = [MODELS_DIR, os.path.join(BASE, "rvc_models")]
    out = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            d = os.path.join(root, name)
            pth = os.path.join(d, name + ".pth")
            if os.path.isdir(d) and os.path.exists(pth) and name not in out:
                out.append(name)
            # 兼容直接放 models/x.pth
            if os.path.isfile(d) and d.lower().endswith(".pth"):
                out.append(os.path.splitext(name)[0])
    return out


def rvc_cli(model_path, in_wav, out_wav):
    """调用 rvc-python 官方 CLI 换声（CPU）。model_path 为 .pth 绝对路径。"""
    py = VENV_PY if os.path.exists(VENV_PY) else sys.executable
    cmd = [
        py, "-m", "rvc_python", "cli",
        "-i", in_wav, "-o", out_wav,
        "-mp", model_path,
        "-de", "cpu",
        "-me", "rmvpe",
        "-pi", "0",
        "-ir", "0.75",
        "-fr", "3",
        "-rsr", "0",
        "-rmr", "0.25",
        "-pr", "0.33",
    ]
    log("RVC CLI: python -m rvc_python cli -mp %s -de cpu" % os.path.basename(model_path))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise RuntimeError("RVC 推理失败: %s" % (proc.stderr or proc.stdout or "unknown")[-800:])
    if not os.path.exists(out_wav):
        raise RuntimeError("RVC 未产出文件")


def locate_pth(model_name):
    for root in [MODELS_DIR, os.path.join(BASE, "rvc_models")]:
        d = os.path.join(root, model_name)
        p = os.path.join(d, model_name + ".pth")
        if os.path.exists(p):
            return p
        p2 = os.path.join(root, model_name + ".pth")
        if os.path.exists(p2):
            return p2
    return None


def run_ffmpeg(args, timeout=300):
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + args
    subprocess.run(cmd, check=True, capture_output=True, timeout=timeout)


def fetch_and_trim(url, start, dur, workdir):
    """ffmpeg 拉取远程音频并裁剪为 44.1k 单声道 wav（rvc 输入要求 wav）。"""
    src = os.path.join(workdir, "src.wav")
    tmp = os.path.join(workdir, "src_raw.wav")
    run_ffmpeg(["-i", url, "-vn", "-ac", "1", "-ar", "44100", tmp])
    out = os.path.join(workdir, "trim.wav")
    ss = max(0, int(start))
    run_ffmpeg(["-i", tmp, "-ss", str(ss), "-t", str(dur), "-ac", "1", "-ar", "44100", out])
    return out


def process_job(job):
    jid = job["job_id"]
    workdir = os.path.join(JOBS_DIR, "work_" + jid)
    os.makedirs(workdir, exist_ok=True)
    try:
        job["status"] = "pending"
        job["message"] = "正在下载并裁剪音频..."
        wav = fetch_and_trim(job["url"], job.get("start", 30), job.get("dur", 25), workdir)
        job["message"] = "正在 AI 换声（CPU 推理，20 秒约 1-4 分钟）..."
        pth = locate_pth(job["model"])
        if not pth:
            raise RuntimeError("找不到音色模型: %s" % job["model"])
        out_wav = os.path.join(workdir, "out.wav")
        rvc_cli(pth, wav, out_wav)
        mp3 = os.path.join(JOBS_DIR, jid + ".mp3")
        run_ffmpeg(["-i", out_wav, "-b:a", "128k", mp3], timeout=120)
        job["status"] = "done"
        job["message"] = "完成"
        job["audio_url"] = "/audio/%s.mp3" % jid
    except Exception as e:
        log("任务 %s 失败: %s" % (jid, e))
        job["status"] = "error"
        job["message"] = str(e)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def start_job(payload):
    model = str(payload.get("model") or "").strip()
    if model not in list_models():
        raise RuntimeError("音色模型不存在，可用: %s" % (", ".join(list_models()) or "无"))
    url = str(payload.get("url") or "").strip()
    if not re.match(r"^https?://", url):
        raise RuntimeError("url 需为 http(s) 直链")
    start = int(payload.get("start", 30) or 30)
    dur = min(int(payload.get("dur", 25) or 25), 40)
    with JOBS_LOCK:
        now = time.time()
        for old in [k for k, v in JOBS.items() if now - v["ts"] > 3600]:
            JOBS.pop(old, None)
        running = [v for v in JOBS.values() if v["status"] in ("queued", "pending")]
        if len(running) >= WORKERS:
            raise RuntimeError("已有任务在合成中，请稍后再试（并发 1）")
        jid = uuid.uuid4().hex[:12]
        job = {"job_id": jid, "url": url, "model": model, "start": start, "dur": dur,
               "status": "queued", "message": "排队中", "ts": now}
        JOBS[jid] = job
    threading.Thread(target=process_job, args=(job,), daemon=True).start()
    return jid


from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def send_json(h, code, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    h.send_response(code)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(body)))
    h.end_headers()
    h.wfile.write(body)


class Req(BaseHTTPRequestHandler):
    server_version = "AISing/1.0"

    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/health":
            send_json(self, 200, {"ok": True, "models": list_models(), "cpu": True})
        elif path.startswith("/job/"):
            jid = path.split("/")[-1]
            job = JOBS.get(jid)
            if not job:
                return send_json(self, 404, {"error": "job not found"})
            resp = {"job_id": jid, "status": job["status"], "message": job["message"]}
            if job.get("audio_url"):
                resp["audio_url"] = job["audio_url"]
            send_json(self, 200, resp)
        elif path.startswith("/audio/"):
            fname = path.split("/")[-1]
            if not re.match(r"^[0-9a-f]{12}\.mp3$", fname):
                return send_json(self, 400, {"error": "bad name"})
            fp = os.path.join(JOBS_DIR, fname)
            if not os.path.exists(fp):
                return send_json(self, 404, {"error": "not found"})
            sz = os.path.getsize(fp)
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(sz))
            self.end_headers()
            with open(fp, "rb") as f:
                while True:
                    c = f.read(65536)
                    if not c:
                        break
                    self.wfile.write(c)
        else:
            send_json(self, 404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/job":
            return send_json(self, 404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            jid = start_job(payload)
            send_json(self, 200, {"job_id": jid})
        except Exception as e:
            send_json(self, 400, {"error": str(e)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    if not shutil.which("ffmpeg"):
        print("缺少 ffmpeg，先执行：apt-get install -y ffmpeg")
        sys.exit(1)
    if not os.path.exists(VENV_PY):
        print("未安装环境，先执行 bash install.sh")
        sys.exit(1)
    print("可用音色模型: %s" % (", ".join(list_models()) or "（无，请按 models/音色名/音色名.pth 放置）"))
    ThreadingHTTPServer((a.host, a.port), Req).serve_forever()


if __name__ == "__main__":
    main()
