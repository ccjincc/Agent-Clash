# Backend (FastAPI)

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md)

백엔드는 `backend/` 디렉터리에 있으며, SSE 스트리밍 API 를 제공하고 SQLite 로 로컬 영속화를 수행합니다.

## 실행

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

헬스 체크: `GET /health`

## 환경 변수

- `UPSTREAM_TIMEOUT_SECONDS`: 업스트림 모델 API 타임아웃(초), 기본값 `120`
- `NEXT_PUBLIC_BACKEND_URL`: 프런트엔드에서 사용하는 백엔드 URL, 기본값 `http://127.0.0.1:8001`
