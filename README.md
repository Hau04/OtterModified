# OtterHub

<p align="center">
  <img width="100" alt="OtterHub icon" src="public/otterhub-icon.svg">
</p>
<p align="center"><strong>Stash your files like an otter</strong></p>

<p align="center">
  基于 Cloudflare Worker 的私人云盘，并提供 Express + SQLite 的 Node.js VPS 部署模式
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Pages%20%2B%20KV%20%2B%20R2-orange?logo=cloudflare" />
  <img src="https://img.shields.io/badge/Storage-Telegram-blue?logo=telegram" />
  <img src="https://img.shields.io/badge/Frontend-Next.js-black?logo=next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript" />
</p>

---

## 👋 为什么有 OtterHub？

现有基于 **Cloudflare + Telegram** 的文件存储方案，例如：

- [Telegraph-Image](https://github.com/cf-pages/Telegraph-Image) 
- [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)

它们都很优秀，但要么偏向**图床与轻量分享**，要么为了通用性引入了**较高的复杂度**，并不完全适合**长期自用的私人云盘**。

### OtterHub 的定位

> 像水獭一样，把文件悄悄藏好，需要时再拿出来 🦦

OtterHub 是一个 **为个人使用场景定制** 的私人云盘方案：

- **Cloudflare 模式**：Cloudflare Pages + KV，使用 Telegram Bot 作为实际文件存储
- **Node.js VPS 模式**：Express + SQLite，文件与上传分片存储在 VPS 本地磁盘
- 两种模式均保留 **分片上传** 和 **HTTP Range**，支持视频与大文件访问
- 架构克制、状态最小化，优先长期可维护性

它不追求"什么都支持"，而是专注于**刚好够用、稳定、好维护**。


>  [!IMPORTANT]
> 体验站点：[OtterHub Demo](https://otterhub-demo.pages.dev/)
>
> 账号：`OtterHub` | 密码：`123456`
>
> 提示：演示站的默认文件不可删；请勿在公开演示环境存放私密内容。

![网站截图](public/website-screenshot.png)



## ✨ 核心能力

- **私人文件存储**：
  - 支持图片 / 音频 / 视频 / 文档
  - Cloudflare 模式使用按类型划分的 KV Key (`img:` / `audio:` / `video:` / `doc:`)；Node.js VPS 模式使用 SQLite 元数据
- **大文件支持**：
  - 分片上传（≤20MB/片），已实测稳定上传并预览 **100MB** 文件，理论最大 1GB
  - 支持 HTTP Range，视频/音频按需加载，支持断点续传
- **实时预览**：
  - 通过文件 URL 直接打开，无需下载
  - 支持：图片 / 音频 / 视频 / 文本（txt、pdf 等）
- **媒体相册（Emby 风格）**：先创建命名相册，再将照片和视频上传到选中的相册；可选择照片作为海报，打开相册后按需分页加载媒体
- **可控性能与流量**：
  - Cloudflare 模式下非 Range 请求走 Cloudflare Cache，Range 请求直出避免缓存污染
  - 图片加载策略：默认 / 省流（>5MB 不加载）/ 无图
- **安全与私密**：
  - 账号密码登录（Basic Auth）
  - NSFW 图片客户端检测（nsfw.js），安全模式下自动遮罩
- **基础管理功能**：批量下载 / 删除，搜索 / 收藏 / 排序 / 标签

---

## 🚀 快速开始

### 前置要求

- Node.js 20.9+ to build the frontend; Node.js 18+ to run the VPS backend (Node 19 is end-of-life; use a maintained LTS release when available)
- Cloudflare 账号（免费）
- Telegram Bot Token

### 本地开发

#### 开发模式（推荐）

1. **启动后端** (`127.0.0.1:8080`)

```bash
npm install
npm run start:backend
```

2. **启动前端** (`127.0.0.1:3000`)

```bash
cd frontend && npm install
npm run dev
```

> [!TIP]
> 开发环境下采用本地 R2 存储，可以直接上传文件，方便调试。
> 修改 functions 代码后，可运行 `npm run ci-test` 快速测试文件上传和下载功能是否正常。

#### 预览模式

如需预览打包后的前端资源，可在根目录执行：

```bash
npm start
```

> 该命令会先打包前端，然后启动后端（前端无热更新）

---

## 🟢 Node.js VPS deployment (Cloudflare alternative)

The standalone **Express + SQLite** backend in `node-vps/` serves the exported Next.js frontend and stores metadata/albums in SQLite through `sql.js` WebAssembly. Set `STORAGE_BACKEND=telegram`, `TG_BOT_TOKEN`, and `TG_CHAT_ID` to store uploaded file bytes in Telegram using the original Worker adapter behavior; without those settings, local disk storage remains available. The release archive includes the prebuilt frontend; building it from source requires Node.js 20.9+. The backend runtime supports Node.js 18+. The existing Cloudflare Worker remains available in `functions/` and is unchanged.

> **Data migration:** the Node.js VPS backend has its own SQLite metadata/folder database. Existing files and album metadata in Cloudflare KV/R2 or Telegram are **not copied into the VPS SQLite database automatically**; export/import them separately if you need the VPS interface to list existing Worker albums.

### Run locally

Use Node.js 20.9 or later to build the static frontend; the Node API runtime supports Node.js 18 or later. Build the static frontend, then start the Node API:

```bash
cd frontend
npm ci
npm run build

cd ../node-vps
npm ci
cp .env.example .env
```

For local use, edit `node-vps/.env` to use development credentials and paths (all paths are relative to `node-vps/`):

```env
APP_ENV=development
BASIC_USER=
BASIC_PASS=
DATA_DIR=./data
DATABASE_PATH=./data/otterhub.sqlite3
STORAGE_DIR=./data/files
CHUNKS_DIR=./data/chunks
TEMP_UPLOAD_DIR=./data/uploads
FRONTEND_DIR=../frontend/out
```

Then run:

```bash
npm test
npm start
```

Open `http://localhost:8000`.

### Prepare an Ubuntu/Debian VPS (one time)

Install a maintained Node.js LTS release and npm system-wide (the systemd unit expects `/usr/bin/node`) and Nginx. The VPS backend uses SQLite compiled to WebAssembly, so it does not need a native SQLite addon, a C++ compiler, or a matching GLIBC prebuild. Node.js 18+ works for the API; the frontend build requires Node.js 20.9+. Node.js 19 is end-of-life and should only be used if the host cannot offer a maintained version. Keep enough persistent disk for your files and backups. Run the initial setup from a repository checkout on the VPS and replace `DEPLOY_USER` with the SSH account GitHub Actions will use:

```bash
sudo apt update
sudo apt install -y nginx curl
node --version  # must be 22 or newer
npm --version
sudo useradd --system --home-dir /var/lib/otterhub --create-home \
  --shell /usr/sbin/nologin otterhub
sudo install -d -o otterhub -g otterhub -m 0750 /var/lib/otterhub
sudo install -d -o "$USER" -g otterhub -m 0755 \
  /opt/otterhub/releases /opt/otterhub/shared
sudo cp node-vps/.env.example /opt/otterhub/shared/otterhub.env
sudoedit /opt/otterhub/shared/otterhub.env
sudo chown root:otterhub /opt/otterhub/shared/otterhub.env
sudo chmod 640 /opt/otterhub/shared/otterhub.env
sudo chown "$USER":otterhub /opt/otterhub /opt/otterhub/releases /opt/otterhub/shared
sudo chmod 755 /opt/otterhub /opt/otterhub/releases /opt/otterhub/shared

sudo cp deploy/otterhub.service /etc/systemd/system/otterhub.service
sudo systemctl daemon-reload
sudo systemctl enable otterhub
# Do not start it yet: the first release creates /opt/otterhub/current.
```

In `otterhub.env`, set `APP_ENV=production`, `NODE_ENV=production`, a unique `BASIC_USER` and `BASIC_PASS`, and keep the SQLite metadata paths under `/var/lib/otterhub`. To send file bytes to Telegram like the original Worker, set `STORAGE_BACKEND=telegram` and configure `TG_BOT_TOKEN` and `TG_CHAT_ID`; metadata/albums still live in SQLite. Generate a hex password (for example, `openssl rand -hex 32`) to avoid environment-file quoting issues. The service reads this shared file; do not commit secrets or put them in the release archive.

Make sure the SSH deploy account owns `/opt/otterhub` and can traverse/read release directories. Give it only the required passwordless systemd commands, adjusting the systemctl path if needed:

```bash
sudo visudo -f /etc/sudoers.d/otterhub-deploy
# Add this line, replacing DEPLOY_USER:
DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl cat otterhub, /usr/bin/systemctl restart otterhub, /usr/bin/systemctl stop otterhub
```

Configure Nginx from [`deploy/nginx.conf.example`](deploy/nginx.conf.example): set your domain, enable the site, obtain a TLS certificate (for example with Certbot), and serve the app only over HTTPS. The example allows 25 MiB request bodies for 20 MiB chunks. Node listens on `127.0.0.1:8000` and should not be exposed directly to the public internet.

### Configure GitHub Actions and release

Add these repository **Actions secrets** before deploying:

- `VPS_HOST` — VPS hostname or IP
- `VPS_USER` — SSH deploy account
- `VPS_PORT` — optional SSH port (defaults to `22`)
- `VPS_SSH_PRIVATE_KEY` — private key matching that account's `authorized_keys`
- `VPS_KNOWN_HOSTS` — verified SSH host-key line(s) for the VPS

The workflow [`.github/workflows/node-vps-release.yml`](.github/workflows/node-vps-release.yml) tests the Node API, checks/builds the frontend, and publishes a GitHub Release. Push a version tag such as `v1.0.0` to publish **and deploy** it. Or run **Actions → Node.js VPS release → Run workflow**, enter a version, and choose whether to deploy. Deployments keep the current and previous releases and restore the previous symlink if the health check fails.

Back up `/var/lib/otterhub` (SQLite metadata, and local media if `STORAGE_BACKEND=local`) together. With Telegram storage, the binary files remain in the configured Telegram chat while their index/folder metadata remains in SQLite. For a consistent snapshot, stop `otterhub`, archive that directory, then start the service again. The Worker and VPS indexes are independent; deploying the Node VPS workflow does not delete or alter Cloudflare data.

---

## 📦 Cloudflare Pages 部署

本项目使用 **Cloudflare Pages + Pages Functions**：静态前端由 Pages 提供，`functions/` 中的 API 通过 Worker 运行。

### 1. 创建 Pages 项目

在 Cloudflare Dashboard 连接此 GitHub 仓库。项目根目录保持仓库根目录：

- **构建命令**：`npm run build:frontend`
- **构建输出目录**：`frontend/out`
- 确保 `functions/` 目录随仓库一起部署，Pages 会自动注册 `/api/*` 和 `/file/*` 路由。

### 2. 配置 Pages 环境变量与密钥

在 Preview/Production 对应环境配置：

```env
BASIC_USER=your_username
BASIC_PASS=your_private_password
TG_CHAT_ID=your_tg_chat_id
TG_BOT_TOKEN=your_tg_bot_token
```

将 `TG_BOT_TOKEN` 设为 Secret。使用 Telegram 存储时，必须同时设置 `TG_BOT_TOKEN` 和 `TG_CHAT_ID`。不要把 token 提交到仓库或发到聊天中。

### 3. 绑定已有 KV Namespace

Pages Functions 使用 KV 保存文件索引、相册和相册成员索引；媒体二进制文件本身发送到 Telegram。

- **优先绑定你原来存有 OtterHub 数据的 KV namespace**，不要为了部署新建空 namespace，否则原有相册会看起来消失。
- 代码兼容现有变量名 `oh_file_url_demo` 和 `oh_file_url`。如果两者都绑定，请设置普通环境变量 `OTTERHUB_KV_BINDING` 为真正包含数据的绑定名。

> `TG_CHAT_ID` 和 `TG_BOT_TOKEN` 需在 Telegram 中获取。
> 💡 详细流程可参考：[Telegraph-Image](https://github.com/cf-pages/Telegraph-Image)

### 4. 先建相册，再上传照片/视频

在前端切换到 **Albums → New album** 并命名。新建后该相册会自动成为上传目标；也可在上传框上方手动选择目标相册。上传的照片和视频会归入选中相册；音频和文档仍可上传，但不会加入相册。
---

## 🔧 技术原理

### 文件上传与相册

1. 在 **Albums** 中先创建并命名相册；创建后它会被自动选为接下来的上传目标。
2. 选择照片或视频上传。普通文件直接发送到 Telegram；超过 20 MiB 的文件按顺序拆成不超过 50 个、每个不超过 20 MiB 的分片上传。
3. Telegram 返回的 `file_id` 与文件元数据保存在 KV。上传到相册的媒体还会有独立的相册成员索引，打开一个相册时只读取该相册的项目页，不扫描其他相册。
4. 分片在确认 Telegram 接收成功后再更新进度。临时分片 KV 项一小时后过期；完成后的文件索引不会过期。
5. 最大文件大小为 1,000 MiB。分片请求逐个完成，避免并发更新丢失上传进度。

### 文件下载
> 以大文件流式获取流程为例

1. **读取元数据**

   - 从 KV 读取文件元数据和分片信息
   - 解析 chunks 数组中的 file_id

2. **流式拉取**

   - 从 Telegram API 流式拉取所有分片
   - 支持 HTTP Range 请求
   - 边拉取边返回给客户端

3. **断点续传**
   - 支持 Range 请求头
   - 可指定下载指定字节范围

### 数据存储结构
> 以 30MB 文件为例

#### KV Key + Metadata 结构

```json
{
  "name": "video:chunk_7yHZkP0bzyUN5VLE.mp4",
  "metadata": {
    "fileName": "示例视频-1080P.mp4",
    "fileSize": 30202507,
    "uploadedAt": 1768059589484,
    "liked": false,
    "chunkInfo": {
      "total": 2,
      "uploadedIndices": [1, 0]
    }
  }
}
```

#### KV Value 结构（chunks 数组）

```json
[
  {
    "idx": 1,
    "file_id": "BQACAgUAAyEGAASJIjr1AAIDa2lictGSBOJ24LnypIN5JCmV2u77AAJ_HwAC...",
    "size": 9230987
  },
  {
    "idx": 0,
    "file_id": "BQACAgUAAyEGAASJIjr1AAIDbGlictIJ9om0qQ66ZW4GssRXCARUAAKAHwAC...",
    "size": 20971520
  }
]
```

#### 存储容量分析

- **单文件占用**：< 500 字节（key + metadata + value 结构）
- **KV 总容量**：1GB（免费版）
- **理论存储数量**： **≥ 200万个**

> 计算公式：`1GB / 500字节 ≈ 200万`

---

## ❓ 常见问题

<details>
<summary>1. 上传完成后立即查看，为什么文件不完整？</summary>

大文件按分片逐个发送；每个分片成功后才更新进度，最后一片完成后才出现在相册索引中。若网络中断，可从界面中的未完成上传状态继续上传。
</details>

<details>
<summary>2. Telegram 单文件限制 20MB，OtterHub 如何支持大文件？</summary>

通过 **分片上传 + 流式合并** 实现：

- 前端将文件拆分为多个 ≤20MB 的分片
- 每个分片独立上传到 Telegram
- 服务端记录分片 `file_id`
- 下载时按顺序流式拉取并合并

👉 当前最大支持 **1GB 文件（50 × 20MB）**。
</details>

<details>
<summary>3. Cloudflare Workers / KV 用量会怎样增长？</summary>

文件存放期间不会自动调用 Worker。浏览器只请求相册/文件元数据及实际显示或打开的媒体；未打开相册中的照片不会被全部下载。设置了封面时，目录中可见的封面仍会按需加载。媒体二进制存放在 Telegram，KV 保存索引和相册成员关系。

Cloudflare Free Workers 有 100,000 次请求/天，但 Free KV 的写入额度较低（1,000 次/天）。每张加入相册的普通照片至少写入文件记录和相册成员索引各一次，因此空闲账号约可上传 500 张这类照片/天，30,000 张至少需要约 60 天；创建相册、设置海报及其他操作会占用额外额度。大于 20 MiB 的分片文件还会产生临时分片和进度写入。Workers Paid 的 KV 写入额度按月计算，更适合集中批量上传。

查看当前官方额度：
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)

</details>

<details>
<summary>4. 如何获取 Telegram Bot Token 和 Chat ID？</summary>

以下为 AI 生成，详细流程可参考：[Telegraph-Image](https://github.com/cf-pages/Telegraph-Image)

**Bot Token**

1. 在 Telegram 搜索 `@BotFather`
2. 发送 `/newbot`
3. 保存返回的 Token

**Chat ID**
- 搜索 `@userinfobot` 并发送任意消息
- 或访问：
  `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
  </details>

---

## 📂 项目结构

```
OtterHub/
├── node-vps/         # Express + SQLite backend for Node.js VPS deployment
├── deploy/           # systemd and Nginx examples for the VPS backend
├── .github/workflows/node-vps-release.yml
├── frontend/
├── functions/         # Cloudflare Pages Functions
│   ├── api/
│   │   ├── upload/   # 文件上传（普通+分片）
│   │   ├── list.ts
│   │   ├── delete/[key].ts
│   │   ├── editFileMeta/[key].ts
│   │   ├── _middleware.ts    # 认证中间件
│   │   ├── ...
│   ├── file/[key].ts  # 文件获取（支持 Range 请求）
│   ├── utils/
│   │   ├── db-adapter/  # 存储适配器（抽象层）
│   │   │   ├── base-adapter.ts    # 适配器基类
│   │   │   ├── tg-adapter-v2.ts    # Telegram 适配器
│   │   │   ├── r2-adapter-v2.ts     # R2 适配器
│   │   ├── ...
│   └── _middleware.ts    # 全局中间件（CORS）
├── public/           # 静态资源
├── package.json
└── README.md
```

---

## 🔍 参考资料

- [Cloudflare API](https://developers.cloudflare.com/api)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegraph-Image](https://github.com/cf-pages/Telegraph-Image) - CF + TG 文件存储方案来源
- [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) - DB 适配器 & 分片上传设计的灵感来源
- [Solara](https://github.com/akudamatata/Solara)

---

## 📋 TODO

- [ ] 优化 NSFW 检测
  - [x] 集成 NSFWJS 库，客户端检测
  - [ ] 评估 NSFWJS 性能开销，是否改用 Moderate Content/Sightengine 的免费 API
  - [ ] 支持视频、音频检测？

- [ ] 文件类型定制
  - [ ] 图片
    - [x] 静态 Masonry 瀑布流布局
    - [ ] 动态瀑布流支持，虚拟滚动加载
    - [ ] 适配GIF格式
    
  - [ ] 音频：播放列表功能，对接 GD's Studio API
  - [ ] 视频：在线播放支持
  - [ ] 文档：预览支持
  
- [ ] 其他
  - [ ] 实现分页获取
  - [ ] 批量操作
    - [ ] 批量分享
  - [ ] 支持 Docker 部署
  - [ ] 实现 Private 功能，仅授权用户可访问标有 Private 标签的文件

---

## 🤝 Contributing

欢迎提交 **Issue** 反馈问题或建议新功能，也欢迎 **Pull Request** 一起完善项目！
觉得有用的话，点个 ⭐️ 支持一下吧！
