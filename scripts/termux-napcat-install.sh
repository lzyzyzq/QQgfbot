#!/bin/bash
# ============================================================
# NapCatQQ 一键安装脚本（Termux / Android）
# 用途：在手机 Termux 中安装 NapCatQQ，提供 OneBot HTTP 接口
#       供面板"成员同步"拉取群成员真实 QQ 号
# 使用：bash termux-napcat-install.sh
# ============================================================
set -e

echo "==> [1/6] 更新 Termux 软件源..."
pkg update -y
pkg upgrade -y

echo "==> [2/6] 安装 nodejs / git..."
pkg install -y nodejs-lts git unzip

NMP_DIR="$HOME/napcat"
cd "$HOME"

echo "==> [3/6] 下载 NapCat.Shell..."
rm -rf "$NMP_DIR"
mkdir -p "$NMP_DIR"
curl -L -o "$NMP_DIR/NapCat.Shell.zip" \
  "https://github.com/NapNeko/NapCatQQ/releases/latest/download/NapCat.Shell.zip"
cd "$NMP_DIR"
unzip -oq NapCat.Shell.zip

echo "==> [4/6] 创建启动脚本..."
cat > "$NMP_DIR/start.sh" <<'EOF'
#!/bin/bash
cd "$HOME/napcat"
exec node napcat.mjs
EOF
chmod +x "$NMP_DIR/start.sh"

echo "==> [5/6] 首次启动（用于登录 QQ 并配置 OneBot）..."
echo "    请在手机浏览器打开 http://127.0.0.1:6099/webui 扫码登录机器人 QQ"
echo "    登录后在 网络配置 中新增 HTTP 服务："
echo "      - 地址监听 0.0.0.0，端口 5700"
echo "      - 设置一个 Access Token（推荐，例如 yzq5201314）"
echo "    登录完成并配置好后，按 Ctrl+C 退出"
bash "$NMP_DIR/start.sh"

echo "==> [6/6] 安装完成！"
echo "============================================================"
echo " 启动 NapCat：     bash $HOME/napcat/start.sh"
echo " 查看端口状态：   ss -tlnp | grep 5700"
echo ""
echo " 将 OneBot 地址填到面板（二选一）："
echo "  A. 局域网直连： 手机与可访问容器的网络互通时填"
echo "                  http://<手机局域网IP>:5700"
echo "  B. 公网隧道：   安装 cloudflared 后运行"
echo "                  pkg install -y cloudflared"
echo "                  cloudflared tunnel --url http://127.0.0.1:5700"
echo "                  把生成的 https://xxx.trycloudflare.com 填入面板"
echo "============================================================"
