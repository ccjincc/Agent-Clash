# Agent-Clash

多智能体对话竞技场（本地运行 + 调用模型 API）。支持一键加载玩法模板、导入导出配置、轮次推进、@ 指定智能体强制回复、思考过程展示与基础 Markdown 渲染。

## 目录结构

- `frontend/`：Next.js 前端
- `backend/`：FastAPI 后端（SQLite 持久化，API only）

## 快速开始（Windows）

### 1) 启动后端

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

健康检查：`http://127.0.0.1:8001/health`

### 2) 启动前端

```bash
cd frontend
npm install
npm run dev
```

默认访问：`http://localhost:3000/`（启动后会自动打开浏览器）。

## 配置模型 API

在左侧栏的“全局 API 设置”中填写：

- Base URL：你的 OpenAI-compatible 接口地址（例如 `https://api.openai.com/v1` 或自建网关地址）
- API Key：你的密钥

提示：配置保存在浏览器存储中，不同访问地址（`localhost` / `127.0.0.1` / 局域网 IP）之间不会共享。

## 玩法模板 / 导入导出

- “玩法模板”：下拉选择预设玩法，点击“一键加载”会自动配置规则、智能体列表、轮次与相关开关。
- “导出配置”：导出当前 `settings + agents` 到 JSON 文件。
- “导入配置”：从 JSON 文件一键恢复 `settings + agents`（会保留当前的 Base URL / API Key）。

## 常见问题

### 拉取模型失败（401 Invalid Token）

说明上游接口鉴权失败。检查 Base URL 与 API Key 是否匹配，且没有带多余前缀/空格。

### Request timed out

说明上游模型响应慢或网络抖动。后端默认超时为 120s，可通过环境变量调整：

```bash
set UPSTREAM_TIMEOUT_SECONDS=180
```

## 开发脚本

```bash
cd frontend
npm run lint
npm run build
```

