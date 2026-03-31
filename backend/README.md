# Backend (FastAPI)

后端工程在 `backend/` 目录，提供 API（SSE 流式输出）并使用 SQLite 做本地持久化。

## 启动

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

健康检查：`GET /health`

## 环境变量

- `UPSTREAM_TIMEOUT_SECONDS`：上游模型 API 超时（秒），默认 120
- `NEXT_PUBLIC_BACKEND_URL`：前端可通过该变量指向后端地址（默认 `http://127.0.0.1:8001`）

