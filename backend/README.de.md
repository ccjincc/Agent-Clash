# Backend (FastAPI)

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md)

Das Backend befindet sich in `backend/`, stellt eine API mit SSE-Streaming bereit und verwendet SQLite fuer die lokale Persistenz.

## Start

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

Health-Check: `GET /health`

## Umgebungsvariablen

- `UPSTREAM_TIMEOUT_SECONDS`: Timeout fuer Upstream-Modell-APIs in Sekunden, Standard `120`
- `NEXT_PUBLIC_BACKEND_URL`: vom Frontend verwendete Backend-URL, Standard `http://127.0.0.1:8001`
