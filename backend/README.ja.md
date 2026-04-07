# Backend (FastAPI)

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md)

バックエンドは `backend/` にあり、SSE ストリーミング API を提供し、SQLite でローカル永続化を行います。

## 起動

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

ヘルスチェック: `GET /health`

## 環境変数

- `UPSTREAM_TIMEOUT_SECONDS`: 上流モデル API のタイムアウト秒数、既定値 `120`
- `NEXT_PUBLIC_BACKEND_URL`: フロントエンドから見たバックエンド URL、既定値 `http://127.0.0.1:8001`
