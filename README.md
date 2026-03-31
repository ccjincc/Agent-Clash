# Agent-Clash

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Frontend](https://img.shields.io/badge/frontend-Next.js-black)](frontend/)
[![Backend](https://img.shields.io/badge/backend-FastAPI-009688)](backend/)

Agent‑Clash 是一个可本地运行的多智能体对话竞技场：用可视化侧边栏快速配置规则与智能体（模型/人设/静音/头像），支持一键加载玩法模板、导入导出配置、轮次推进与随机/顺序轮转；支持 `@智能体` 强制插话且不打断原队列；支持可选的记忆检索（RAG）与摘要；前端提供基础 Markdown 渲染与思考内容折叠展示，后端基于 FastAPI + SQLite 持久化会话历史，支持新建/恢复/删除对话。

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [使用说明](#使用说明)
- [API 速查](#api-速查)
- [环境变量](#环境变量)
- [常见问题](#常见问题)
- [隐私与安全](#隐私与安全)
- [项目结构](#项目结构)
- [开发与贡献](#开发与贡献)

## 功能特性

- 多智能体竞技场：支持任意数量智能体，顺序轮转或随机轮转
- 玩法模板：一键加载预设玩法（规则/轮次/开关/智能体列表）
- 会话历史：新建对话、删除对话、点击恢复历史对话并继续推进轮次
- 强制插话：输入 `@智能体` 可强制指定智能体回复，且不打断原始轮次队列
- 流式输出：后端 SSE 推流，前端实时渲染并支持“贴底自动滚动 + 手动滚动不被打断”
- 记忆检索（RAG）：开启后，模型可用 `<SEARCH>...</SEARCH>` 请求检索；提示仅对用户可见，不进入其他模型上下文
- 摘要：支持摘要模型下拉选择与触发阈值，方便压缩长对话上下文
- 信息展示：思考内容折叠、基础 Markdown 渲染、可选显示耗时与 token

## 技术栈

- 前端：Next.js（App Router）+ TypeScript + Tailwind CSS
- 后端：FastAPI + SQLAlchemy + SQLite
- 通信：REST + SSE（流式消息）
- 模型：OpenAI‑compatible API（可替换 Base URL）

## 架构概览

```
Browser (http://localhost:3000)
  └─ Next.js Frontend (SSE client)
       ├─ 左侧：玩法/智能体/模型与开关配置
       ├─ 中间：对话区（流式渲染、编辑/删除、滚动跟随）
       └─ 会话：新建/恢复/删除（基于 session-id）
             │
             │ REST + SSE (http://127.0.0.1:8001)
             ▼
        FastAPI Backend
          ├─ /api/send /api/reply /api/next_turn (SSE)
          ├─ /api/sessions/* /api/state
          └─ SQLite (backend/app/db/*.db)
                 ├─ sessions
                 ├─ agents
                 ├─ messages
                 └─ session_meta (runtime)
```

## 快速开始

### 依赖

- Node.js 18+（推荐 20+）
- Python 3.10+（开发环境已验证 3.13 可用）

### 1) 启动后端（Windows）

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

健康检查：`http://127.0.0.1:8001/health`

### 2) 启动前端（Windows）

```bash
cd frontend
npm install
npm run dev
```

默认访问：`http://localhost:3000/`（启动后会自动打开浏览器）。

## 使用说明

### 配置模型 API

在左侧栏的“全局 API 设置”中填写：

- Base URL：你的 OpenAI-compatible 接口地址（例如 `https://api.openai.com/v1` 或自建网关地址）
- API Key：你的密钥

提示：配置保存在浏览器存储中，不同访问地址（`localhost` / `127.0.0.1` / 局域网 IP）之间不会共享。

### 玩法模板 / 导入导出

- 玩法模板：下拉选择预设玩法，点击“一键加载”会自动配置规则、智能体列表、轮次与相关开关
- 导出配置：导出当前 `settings + agents` 到 JSON 文件（自动脱敏，不包含 API Key）
- 导入配置：从 JSON 文件恢复 `settings + agents`（会保留当前的 Base URL / API Key）

### 历史对话

- 点击顶部“历史对话”按钮打开面板
- 新对话：创建新会话（独立历史、独立轮次推进）
- 点击条目：恢复某个历史对话并继续推进（下一轮会按原有轮次/队列继续）
- 删除：删除该历史对话（不可恢复）

### 记忆检索（RAG）

- 打开“开启记忆检索 (RAG)”开关，并选择“检索模型”
- 触发方式：模型输出 `<SEARCH>检索问题</SEARCH>` 时会触发检索
- 可见性：检索提示仅对用户可见，不进入其他模型上下文；`<SEARCH>...</SEARCH>` 不会显示在对话文本中

## API 速查

后端默认：`http://127.0.0.1:8001`

- `GET /health`：健康检查
- `GET /api/state`：获取当前会话状态（agents、history、round 等）
- `POST /api/send`：发送用户消息
- `POST /api/reply`：用户消息触发的 `@智能体` 强制回复（SSE）
- `POST /api/next_turn`：推进下一轮（SSE）
- `POST /api/stop`：停止流式生成
- `GET /api/sessions`：列出历史会话
- `POST /api/sessions/new`：创建新会话
- `POST /api/sessions/delete`：删除会话
- `POST /api/models`：从上游拉取可用模型列表

## 环境变量

后端：

- `UPSTREAM_TIMEOUT_SECONDS`：上游模型 API 超时（秒），默认 120

前端：

- `NEXT_PUBLIC_BACKEND_URL`：前端请求的后端地址（默认 `http://127.0.0.1:8001`）

## 常见问题

### 401 Invalid Token

说明上游接口鉴权失败。检查 Base URL 与 API Key 是否匹配，且没有带多余前缀/空格。

### Request timed out

说明上游模型响应慢或网络抖动。可通过环境变量调大后端超时：

```bash
set UPSTREAM_TIMEOUT_SECONDS=180
```

## 隐私与安全

- 本项目不会把 API Key 写入后端数据库；API Key 仅保存在浏览器本地存储中
- 导出配置会自动脱敏，不包含 API Key
- 建议在 GitHub 开启 Secret scanning / Push protection，防止误提交密钥

## 项目结构

```
Agent-Clash/
  frontend/                Next.js 前端
  backend/                 FastAPI 后端
  CONTRIBUTING.md
  SECURITY.md
  LICENSE
  README.md
```

## 开发与贡献

开发脚本：

```bash
cd frontend
npm run lint
npm run build

cd ..\backend
python -m compileall app
```

贡献方式请看 [CONTRIBUTING.md](CONTRIBUTING.md)。

