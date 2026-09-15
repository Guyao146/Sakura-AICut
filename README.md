# Sakura AI Cut

> 无限画布式 AI 短剧 / 电影生成与在线剪辑平台 · Docker 一键部署 · [LGPL-2.1](#-许可证)

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
- **自定义 API 接入** —— NewAPI / OneAPI / 火山引擎 / OpenAI / Claude / Gemini / Kling / MiniMax / DashScope 等通用与专用标准，**支持同步 / 异步任务**
- **按能力选模型** —— 文字、图片、视频三类能力各自指定路由，模型可任意组合
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

> 首次使用请先到 **设置 → API 接入** 填写你的模型服务（NewAPI / OneAPI / 各家官方 API）。

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

本项目采用 **GNU Lesser General Public License v2.1**（[LGPL-2.1](./LICENSE)）。

- 你可以自由使用、修改、分发本作品（包括商业用途）；
- 对本项目的**修改**必须以 LGPL-2.1 开源；
- 通过动态链接 / 独立模块方式调用本项目，你的程序可以不受 LGPL 约束。

```
Sakura AI Cut - 无限画布 AI 短剧生成与剪辑平台
Copyright (C) 2026 Guyao146

This library is free software; you can redistribute it and/or
modify it under the terms of the GNU Lesser General Public
License as published by the Free Software Foundation; either
version 2.1 of the License, or (at your option) any later version.
```
