# Agent-Clash

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Frontend](https://img.shields.io/badge/frontend-Next.js-black)](frontend/)
[![Backend](https://img.shields.io/badge/backend-FastAPI-009688)](backend/)

Agent-Clash는 로컬에서 실행할 수 있는 멀티 에이전트 대화 아레나입니다. 사이드바에서 규칙과 에이전트를 설정하고, 템플릿을 불러오고, 설정을 가져오거나 내보내고, 턴을 진행하며, 기존 순서를 깨지 않고 `@agent` 로 특정 에이전트의 개입 응답을 강제할 수 있습니다. 프런트엔드는 Markdown 렌더링과 접을 수 있는 사고 블록을 제공하고, 백엔드는 FastAPI + SQLite 로 대화 기록을 저장합니다.

## 주요 기능

- 여러 에이전트가 참여하는 대화 경기장
- 빠른 시작을 위한 프리셋 템플릿
- 세션 생성, 복원, 삭제
- `@agent` 강제 응답
- SSE 기반 스트리밍 출력
- `<SEARCH>...</SEARCH>` 를 이용한 선택적 RAG 검색
- 긴 문맥 압축을 위한 요약 모델과 임계값
- API Key 는 브라우저에만 저장되고 백엔드 DB에는 저장되지 않음

## 기술 스택

- 프런트엔드: Next.js (App Router) + TypeScript + Tailwind CSS
- 백엔드: FastAPI + SQLAlchemy + SQLite
- 통신: REST + SSE
- 모델 연동: OpenAI 호환 API

## 빠른 시작

### 요구 사항

- Node.js 18+ (20+ 권장)
- Python 3.10+

### 백엔드 실행

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

### 프런트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

프런트엔드는 `http://localhost:3000/`, 백엔드 헬스 체크는 `http://127.0.0.1:8001/health` 입니다.

## API 요약

- `GET /health`
- `GET /api/state`
- `POST /api/send`
- `POST /api/reply`
- `POST /api/next_turn`
- `POST /api/stop`
- `GET /api/sessions`
- `POST /api/sessions/new`
- `POST /api/sessions/delete`
- `POST /api/models`

## 환경 변수

- 백엔드: `UPSTREAM_TIMEOUT_SECONDS`
- 프런트엔드: `NEXT_PUBLIC_BACKEND_URL`

## 개발 명령

```bash
cd frontend
npm run lint
npm run build

cd ..\backend
python -m compileall app
```

더 자세한 중국어 문서는 [README.md](README.md) 를 참고하세요.
