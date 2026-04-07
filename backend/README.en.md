# Backend (FastAPI)

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md)

The backend lives in `backend/`, exposes the API with SSE streaming, and uses SQLite for local persistence.

## Start

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

Health check: `GET /health`

## Environment Variables

- `UPSTREAM_TIMEOUT_SECONDS`: timeout in seconds for upstream model APIs, default `120`
- `NEXT_PUBLIC_BACKEND_URL`: frontend-facing backend URL, default `http://127.0.0.1:8001`
