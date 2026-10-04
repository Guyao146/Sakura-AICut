# Sakura AI Cut

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
