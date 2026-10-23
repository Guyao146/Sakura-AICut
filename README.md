# Sakura AI Cut

[![樱落生态成员](https://raw.githubusercontent.com/Guyao146/Sakura-EcoSystem-wiki/main/assets/ConnectEcoSystem.svg)](https://mcylyr.cn)
[![已编写Wiki](https://raw.githubusercontent.com/Guyao146/Sakura-EcoSystem-wiki/main/assets/sakura-wiki.svg)](https://wiki.mcylyr.cn/)

> 无限画布式 AI 短剧 / 电影生成与在线剪辑平台 · Docker 一键部署 · [Sakura-License-1.2](#-许可证)

一个把「AI 剧本 → 资产生成 → 分镜运镜 → 在线剪辑」串成一条流水线的自部署应用。
所有能力按**五步工作台**组织，全程在一张无限画布上推进；内置自动规划 Agent，可以端到端替你跑完整条链路。

---

## ✨ 功能特性

- **无限画布 + 五步工作台**
  1. **项目设置** —— 项目名称、风格、类型
  2. **剧本** —— 手写或让旁边的 **AI 小助手**生成
  3. **资产生成** —— 人物 / 场景 / 道具 图片批量生成
  4. **镜头片段** —— 从内置运镜模板挑选，或自定义运镜提示模板
  5. **在线剪辑** —— 时间线编排、导出成片
- **自定义 API 接入** —— 按协议配置模型服务，覆盖对话、消息、多模态内容与媒体任务接口，**支持同步 / 异步任务**
- **按能力选模型** —— 文字、图片、视频、语音各自指定路由，模型可任意组合
- **所有素材节点支持 AI 优化 / 生成** —— 文字、图片、视频、语音及角色 / 场景 / 道具节点，均可使用新输入或节点已有文字
- **提示词库** —— 内置 12 条模板（剧本 / 镜头 / 风格 / 负面词 / 人物 / 场景 / 道具…），一键复制改造
- **运镜模板** —— 内置固定 / 推拉 / 摇移 / 跟随 / 环绕 / 升降 / 特殊，支持自定义运镜模板
- **自动规划 Agent** —— 一句话需求 → 自动拆解并执行全流程，随时可中断、可追问

## 🚀 快速开始

只需本机有 Docker 与 Docker Compose，**无需编译任何镜像**：

```bash
git clone https://github.com/Guyao146/Sakura-AICut.git
cd Sakura-AICut

# （可选）改一下密钥与端口
cp .env.example .env

# 一键拉起：自动从 ghcr.io 拉取已构建好的镜像
docker compose up -d
```

打开 <http://localhost:3000> 即可使用。容器数据持久化在 `sakura-data` 卷中。

> 首次使用请先设置本地管理员密码，再到 **设置 → API 接入** 选择协议模板，填写接口地址、凭证与实际模型 ID。登录可选接入 Sakura 账号或通用 OIDC。

### 域名部署与登录回调

通过域名部署时，在 `.env` 中设置 `APP_URL=https://cut.example.com`，替换为浏览器实际访问的 AICut 根网址，然后执行 `docker compose up -d web` 使环境变量生效。认证服务的 Issuer 在登录接入设置中单独填写，两者分别指向 AICut 与认证服务。

`APP_URL` 留空时，登录回调和页面跳转依次使用 `X-Forwarded-Host` / `Host` 与 `X-Forwarded-Proto` 解析对外地址。反向代理应覆盖这些请求头，例如：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

容器的 `HOSTNAME=0.0.0.0` 用于监听所有网络接口，应保持该值；`APP_URL` 则用于生成浏览器地址，不能使用 `0.0.0.0`。若登录后跳到 `https://0.0.0.0:3000/`，请升级包含此修复的 Web 镜像，确认 `APP_URL` 正确并重新创建 Web 容器。仅重启容器不会更新环境变量。

### 网关快捷接入

在 **设置 → API 接入 → 网关快捷接入** 填写已部署的网关网址与**本地调用 Key**，点击「验证并拉取配置」。网关需支持 `POST /api/integration/verify` 和 `GET /api/integration/config`（Sakura 网关 2.8.0 及后续兼容版本）。

- 验证的是调用 Key 的当前权限，不是本站登录账号；仅输入网址或已登录另一个站点不能代替授权。不要填写本站密码或上游服务密钥。
- 自动保存受该 Key 权限约束的文本模型、网关接口地址和思考能力元数据；不会导入上游密钥，也不会猜测图片或视频生成能力。已有模型路由不变，需要时在「模型路由」选择文本模型。
- 调用 Key 和独立接入令牌加密存储，不回传给设置页面。选中已有接入后可「刷新已保存配置」，无需再输入 Key；验证时 Key 留空会保留现有值。重复接入相同网址和 Key 会复用记录。
- 无效 Key、停用、撤销、超时或响应格式错误不会覆盖旧配置；成功返回空模型时会清空当前可用模型并提示权限不足或尚未发布模型，不把空列表当作生成能力可用。
- 授权取消后不会退回调用 Key 绕过配置同步限制；需由有权操作的用户显式选择「重新登记接入授权」。取消接入授权或删除本站接入**不会停用模型调用 Key**，彻底禁止调用需在网关停用或删除该 Key。
- 公网地址必须使用 HTTPS；本机 / 内网地址需显式勾选允许，且仅连接可信部署。HTTP 会明文传输凭据。拒绝元数据、链路本地等特殊地址；不跟随重定向，请填写最终部署根网址。容器内的 `localhost` 指向容器自身，请使用服务间可达的地址。

## 🪄 节点 AI 使用

点击任意素材节点上的 **✨ AI**，或右键选择 **AI 优化 / 生成**，打开节点详情：

- **节点文字**：填写正文、图片 / 视频提示词或语音台词；可单独保存，AI 提交也会保存并使用当前草稿。
- **本次输入**：可选。优化时作为修改要求，与已有文字一起交给模型；生成媒体时作为新的提示词或台词，留空则使用节点文字。
- **AI 优化**：所有节点都使用文本模型润色文字 / 提示词 / 台词，不替换已有媒体。角色、场景、道具身份保持不变。
- **生成**：按节点类型生成正文、图片、视频或语音，不自动改变节点类型。原有“文字转图片”入口仍保留。视频支持填写时长，语音支持填写接口音色 ID；实际支持范围由模型决定。
- 任务可在 **任务中心** 查看、取消和重试。生成结果自动回填；已有媒体保留最近 24 条历史，可在节点详情恢复。任务期间更改节点内容会阻止旧结果覆盖新内容，此时应基于最新内容重新提交。

请先配置相应的模型路由，并保持 Worker 运行。这里的“已有内容”指节点文字、提示词或台词，不会自动理解或转写已有图片、视频、音频。取消不能保证撤回已发出的模型请求，重试可能再次计费。

## 🧱 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Next.js 16（App Router）· React · Tailwind · @xyflow/react（无限画布） |
| 后端 | Next.js Route Handlers / Server Actions（Web）+ 独立 Worker（tsx 长驻进程） |
| 任务队列 | SQLite 表队列（Web 投递、Worker 轮询认领，支持异步任务与重试） |
| 数据库 | SQLite（node:sqlite），WAL 模式 |
| 媒体处理 | ffmpeg（时间线合成、导出） |
| 包管理 | pnpm workspace monorepo |

## 📦 仓库结构

```
apps/web          Next.js 应用（含 API / Server Actions）
apps/worker       任务执行器（资产生成、视频生成、Agent）
packages/core     类型 / AI 适配器 / 提示词库 / 运镜库 / Agent 规划
packages/db       SQLite 客户端 / 仓储 / 建表与种子
packages/pipeline 生成流水线（剧本→资产→镜头→时间线）
docker/           Dockerfile（web / worker）
```

## 🛠 本地开发

```bash
pnpm install
pnpm db:migrate      # 建库 + 写入内置提示词
pnpm dev             # 同时启动 web(3000) 与 worker
```

## 🔌 开放 API

`/api/open/*` 是独立于会话登录体系的机器接口，用请求头 **`X-API-Key`** 鉴权。支持「设置 → 生态授权」颁发的动态 Key，也兼容 `AICUT_OPEN_API_KEYS` 静态 Key（英文逗号分隔多个值）。没有有效 Key 时返回 401；即使未配置环境 Key，配对授权仍可使用。静态 Key 保持原有全局访问权限；动态 Key 只能访问该授权创建的项目及其任务。

### SakuraSeeking 配对与连接管理

登录后在「设置 → 生态授权」填写应用名称及对端最终服务地址，生成一次性 6 位配对码（10 分钟有效）。在 Seeking「连接与授权」输入相同名称/地址及配对码，确认交换凭证。默认 scope 为 `projects:read projects:create jobs:status`，`jobs:submit`（提交渲染）和 `screenplay:import`（导入剧本草稿）分别勾选才授予，默认均关闭。已配对应用可点击「允许导入剧本」或「停止剧本导入」即时调整，无需重新配对；Seeking 点击「验证连接」可刷新权限显示。权限实际由各端点执行，不会自动提交渲染或调用模型。

配对入口 `POST /api/ecosystem/pair` 接收 `{code, clientName, kind?, peerBaseUrl, peerToken}`，返回 `{grantId, name, apiKey, scope, capabilities, reverseScope}`，仅此握手返回 Key。AiCut 只保存 Key 摘要，对端令牌用持久化密钥加密；设置页面不接收任何凭证。无会话的调用仅放行配对码核销和专用凭证的状态/撤销端点，不放开管理操作。

在对应授权中点击「读取共享选题」会真正请求 Seeking 的受保护接口，仅返回对端明确共享的来源快照（标题、理由、URL、平台、采集时间），不是所有浏览器收藏。来源仍需人工核验。

两端均可吊销；本地立即失效，随后通知对端，通知失败可重试。动态业务调用每次检查对端状态（无缓存，断网拒绝），避免对端离线时漏掉撤销。删除记录不会复活已消费码。撤销不删除项目或已经读到的副本；重新配对不能自动获得旧授权项目。静态 Key 不受动态撤销影响，必须另行移除环境配置。

若运行过早期配对预览代码，升级时会移除明文凭证并废止旧授权，须重新生成配对码；已有项目不删除。请备份数据库与原有持久化加密密钥后升级。

仅连接可信部署，公网地址须 HTTPS；HTTP 只允许本机/内网，仍为明文。阻止元数据/链路本地地址和 DNS 重绑定，不跟随重定向。容器内 localhost 指向自身，须使用双方可达地址。配对尝试全局持久化限流为 12 次/分钟（不信任转发 IP）；生成码为 10 次/分钟。Seeking 当前仍是本机单用户应用，不能直接公开部署。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/open/projects?limit=n` | 项目列表 `{ projects: [{ id, name, updatedAt }] }` |
| POST | `/api/open/projects` | 创建项目，body `{name, brief?}` → `{id, name, imported: false, reviewRequired: true}`；可带 `Idempotency-Key` 防重复 |
| POST | `/api/open/projects/[id]/screenplay` | 单独授权的剧本草稿导入，必须带 `Idempotency-Key`；首次 201、同项目重放 200，始终 `reviewRequired: true` |
| GET | `/api/open/projects/[id]` | 关联项目阶段、状态与最近任务摘要（有 `jobs:status` 才返回任务） |
| POST | `/api/open/jobs` | 提交时间线导出，body `{ projectId, includeSubtitles?, preset? }` → `{ jobId, status }`（缺省 `includeSubtitles=true`、`preset=vertical-1080p`） |
| GET | `/api/open/jobs/[id]` | 任务状态 `{ jobId, status, error? }`，status 为可读字符串（排队 / 运行中 / 成功 / 失败 / 已取消） |

所有响应均为 JSON；出错时返回 `{ "error": "..." }`（401 未授权 / 403 权限不足 / 400 参数错误 / 404 不存在或不可访问 / 409 已有剧本、阶段或幂等冲突 / 413 请求体超限 / 429 限流 / 503 无法验证对端）。

`brief` 严格白名单：`logline, genres, style, aspectRatio, language, targetDurationSec, episodeCount, audience, notes, provenance`。不接受字符串伪装的数值或非法枚举。结构化 `provenance` 保存生产方、版本、生成时间、关键词、生成方式、`reviewRequired: true` 及来源快照；真实来源必须有 HTTP(S) URL 与采集时间，平台标识只作为来源数据保存。项目设定面板可查看溯源。**创建项目本身不导入剧本**；剧本草稿使用下述独立端点，不编造景别或人物卡。

#### 剧本草稿导入（待人工审核）

`POST /api/open/projects/[id]/screenplay` 需要动态授权的 `screenplay:import` scope；静态 Key 保持全局权限，也可调用，但同样不能覆盖已有剧本。Seeking 必须先关联项目，再由用户点击「导入剧本草稿」并确认，不会因配对或创建项目自动执行。

- 正文白名单：`title`（1–120 字符）、`raw`（1–32000 字符）、可选 `logline`（最多 500）、`synopsis`（最多 6000）、`scenes`（1–20 项）。每项仅有 `durationSec`（1–600 的整数）、`visual`（1–800）、`narration`（1–1200）。拒绝未知字段和数值字符串；UTF-8 请求体最多 65536 字节。
- `Idempotency-Key` 必填，1–160 个字母、数字、下划线、冒号或连字符。同一授权下首次导入返回 201；同一项目重放返回原导入记录和 200，不采用重放的新正文；同键跨项目返回 409。重试仍需有效权限；降权返回 403，吊销返回 401。
- 只接受无剧本、阶段为 `brief` 或 `script` 的项目。已有剧本或进入 `assets` / `shots` / `edit` / `done` 时，新导入返回 409，不覆盖人工工作。成功记录的重放不会覆盖后续改稿或改变阶段。
- 原子写入当前剧本、一个版本快照及幂等记录。人物、场景、道具数组为空；`scenes` 仅映射为故事节拍，不创建素材卡、制作镜头或任务，不调用模型、不渲染。存储来源为 `manual`，版本标题注明 SakuraSeeking 与「待人工审核」。导入原文保留生成方式与来源说明，不代表人工已经审核通过。
- 返回 `{id, screenplayId, version, importedAt, imported: true, reviewRequired: true, repeated}`。`importedAt` 为首次导入时间，重试保持不变；导入记录不是当前制作完成状态。开启/关闭权限不删除已有剧本或版本。
- 全局持久化导入限流为 20 次/分钟。两端应同时升级；旧版不支持此端点时请复制或导出后人工整理。数据库会自动补建导入记录表，升级前仍需备份数据库及持久化密钥。

curl 示例：

```bash
KEY="sk-aicut-open-xxxxxxxxxxxxxxxxxxxxxxxx"

# 列出项目
curl -s -H "X-API-Key: $KEY" http://localhost:3000/api/open/projects

# 创建项目
curl -s -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"我的项目"}' http://localhost:3000/api/open/projects

# 提交导出任务
curl -s -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"projectId":"prj_xxxx","includeSubtitles":true,"preset":"vertical-1080p"}' \
  http://localhost:3000/api/open/jobs

# 查询任务状态
curl -s -H "X-API-Key: $KEY" http://localhost:3000/api/open/jobs/job_xxxx
```

## 🔒 许可证

本项目采用 **Sakura-License v1.2**（固定文本标识 `Sakura-License-1.2`）。完整正文见 [LICENSE](./LICENSE)，采用声明（项目、许可人、适用范围与首次适用提交）见 [NOTICE.md](./NOTICE.md)。

- 它是**源码可用（source-available）**许可证，限制特定商业利用，不是 OSI 批准的开源许可证；
- 阅读、运行、复制、修改、分发与自部署免许可费；但**面向第三方的商业利用（销售、订阅、付费 SaaS、收费托管 / 部署 / 定制 / 支持等）须先取得书面商业授权**；
- 对外分发或提供受覆盖作品时，须保留署名、许可证与来源信息，并**同步公开对应源码**；
- 通过公开 API / HTTP 等协议独立调用本项目的运行实例，不因此构成商用或触发共享义务；
- 历史授权保留：在本仓库此前 LGPL-2.1 下取得副本者，可继续按该许可使用（见 [NOTICE.md](./NOTICE.md)）。

商用授权请在 [Issues](https://github.com/Guyao146/Sakura-AICut/issues) 发起申请（请勿在公开 Issue 中提交敏感资料）。

```
Sakura AI Cut - 无限画布 AI 短剧生成与剪辑平台
Copyright (C) 2026 Guyao146

Licensed under Sakura-License v1.2 (Sakura-License-1.2). Certain
commercial uses require prior written authorization. See ./LICENSE
and ./NOTICE.md.
```
