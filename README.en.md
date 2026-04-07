# Agent-Clash

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Frontend](https://img.shields.io/badge/frontend-Next.js-black)](frontend/)
[![Backend](https://img.shields.io/badge/backend-FastAPI-009688)](backend/)

Agent-Clash is a locally runnable multi-agent conversation arena. You can configure rules and agents from a visual sidebar, load preset game modes, import/export setups, advance turns manually, and force an interjection with `@agent` without breaking the existing turn queue. The frontend supports basic Markdown rendering and collapsible thinking blocks, while the backend persists chat history with FastAPI + SQLite.

## Highlights

- Multi-agent arena with any number of agents, sequential or random turn order
- Preset game templates for quick setup
- Session history with create, restore, and delete support
- `@agent` forced reply without resetting the original queue
- SSE streaming output with auto-scroll behavior on the frontend
- Optional RAG-style memory retrieval through `<SEARCH>...</SEARCH>`
- Optional summary model and threshold for long-context compression
- Local-first design: API keys stay in browser storage and are not written into the backend database

## Tech Stack

- Frontend: Next.js (App Router) + TypeScript + Tailwind CSS
- Backend: FastAPI + SQLAlchemy + SQLite
- Transport: REST + SSE
- Model access: OpenAI-compatible API endpoints

## Architecture

```text
Browser (http://localhost:3000)
  -> Next.js frontend
  -> REST + SSE
FastAPI backend (http://127.0.0.1:8001)
  -> SQLite persistence
```

## Quick Start

### Requirements

- Node.js 18+ (20+ recommended)
- Python 3.10+

### Start the backend

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

Health check: `http://127.0.0.1:8001/health`

### Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000/` after the dev server starts.

## Usage Notes

- Fill in `Base URL` and `API Key` in the sidebar with your OpenAI-compatible provider.
- Templates can preload rules, turn limits, switches, and agent lists.
- Exported configuration strips API keys automatically.
- Session history lets you create a fresh session or resume an old one.
- When RAG is enabled, `<SEARCH>query</SEARCH>` can trigger retrieval without exposing the retrieval prompt to other agents.

## API Quick Reference

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

## Environment Variables

- Backend: `UPSTREAM_TIMEOUT_SECONDS`
- Frontend: `NEXT_PUBLIC_BACKEND_URL`

## Development

```bash
cd frontend
npm run lint
npm run build

cd ..\backend
python -m compileall app
```

For the original Chinese reference, see [README.md](README.md).
