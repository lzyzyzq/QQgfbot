# NapCat 真实 QQ 号同步 — Termux 部署指南

## 问题原因

面板「成员同步」测试连接报 `fetch failed`，是因为填写的地址在**机器人服务器**上不可达：

- 之前误填了 `https://3001-xxxx.monkeycode-ai.online`（该端口无服务，返回 501/530）
- 现在填写的 `http://127.0.0.1:5700` 指向机器人服务器自身，服务器上并没有跑 NapCat，所以连接被拒绝

OneBot 地址必须是**机器人服务器能访问到的真实地址**。NapCatQQ 需要真实 QQ 账号登录（扫码），通常跑在手机 Termux 上，因此需要把手机上的 5700 端口暴露给服务器。

## 方案一：Termux 部署 NapCat（推荐）

### 1. 手机安装 Termux

在手机上安装 Termux（F-Droid / 应用商店），授予存储权限，然后执行：

```bash
# 下载一键安装脚本并执行
pkg install -y wget
wget -O termux-napcat-install.sh "http://3000-6f61dc7363389b7a.monkeycode-ai.online/scripts/termux-napcat-install.sh" || true
# 也可以把 当前工作区/scripts/termux-napcat-install.sh 的内容复制到 Termux 保存后执行
bash termux-napcat-install.sh
```

脚本会自动：更新源 → 安装 nodejs/git → 下载 NapCat.Shell → 启动。

### 2. 登录机器人 QQ

脚本启动后，用手机浏览器打开 `http://127.0.0.1:6099/webui`，用**机器人 QQ** 扫码登录。登录成功后 NapCat 就能读到群成员真实 QQ 号。

### 3. 配置 OneBot HTTP 服务

在 NapCat WebUI 的「网络配置」中新增 HTTP 服务：

- 监听地址：`0.0.0.0`
- 端口：`5700`
- Access Token：建议设置，例如 `yzq5201314`（面板侧也填同一个值）

### 4. 把地址填到面板

机器人服务器无法直接访问手机内网，二选一：

**A. 公网隧道（推荐，无需服务器可达手机）**

```bash
# Termux 中安装 cloudflared
pkg install -y cloudflared

# 把本机 5700 端口暴露为公网 HTTPS 地址
cloudflared tunnel --url http://127.0.0.1:5700
```

把输出的 `https://xxx.trycloudflare.com` 填到面板「OneBot HTTP 地址」。

**B. 局域网直连**

如果手机与机器人服务器在同一可互通网络（例如内网穿透环境），填：

```
http://<手机局域网IP>:5700
```

手机 IP 在 Termux 中通过 `ip addr` 或 `ifconfig` 查看。

### 5. 面板配置

1. 打开面板侧边栏「成员同步」
2. 填写 OneBot HTTP 地址 + Access Token
3. 点「测试连接」→ 应显示机器人 QQ 号
4. 点「一键同步 QQ 号」→ 群成员真实 QQ 写入数据库
5. 在「所有群成员」视图查看带 `napcat` 来源标签的真实 QQ 号

## 方案二：不使用 NapCat，手动绑定

- 群管理弹窗的「成员列表」中可直接为成员绑定纯数字 QQ 号（来源标记为 `mapped`）
- 真实 QQ 号会用于「个人信息」回复的 用户QQ 字段

## 注意事项

- Access Token 可为空（自动跳过鉴权），有则必须与 NapCat 侧一致
- 隧道地址（trycloudflare.com）每次重启 cloudflared 会变化，变化后需重新填到面板
- `127.0.0.1` 永远指向机器人服务器自身，不要填 Termux 手机上的回环地址
- 服务器侧无法在当前 Linux 容器内直接运行完整 NapCatQQ（需要图形环境扫码登录 QQ），因此使用 Termux 方案
