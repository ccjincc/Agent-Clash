# Agent-Clash

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Frontend](https://img.shields.io/badge/frontend-Next.js-black)](frontend/)
[![Backend](https://img.shields.io/badge/backend-FastAPI-009688)](backend/)

Agent-Clash ist eine lokal ausfuehrbare Multi-Agenten-Dialogarena. Regeln und Agenten werden ueber eine visuelle Seitenleiste konfiguriert, Vorlagen lassen sich laden, Einstellungen importieren oder exportieren, Runden koennen weitergeschaltet werden, und mit `@agent` ist eine gezielte Zwischenmeldung moeglich, ohne die bestehende Reihenfolge zu unterbrechen. Das Frontend bietet Markdown-Darstellung und einklappbare Denk-Inhalte, waehrend das Backend den Verlauf mit FastAPI + SQLite speichert.

## Funktionen

- Multi-Agenten-Arena mit beliebig vielen Agenten
- Vordefinierte Spielvorlagen fuer schnellen Einstieg
- Sitzungsverlauf erstellen, wiederherstellen und loeschen
- Erzwungene Antwort per `@agent`
- Streaming-Ausgabe ueber SSE
- Optionales RAG mit `<SEARCH>...</SEARCH>`
- Zusammenfassungsmodell und Schwellwert fuer lange Kontexte
- API-Schluessel bleiben im Browser und werden nicht in der Backend-Datenbank gespeichert

## Tech-Stack

- Frontend: Next.js (App Router) + TypeScript + Tailwind CSS
- Backend: FastAPI + SQLAlchemy + SQLite
- Kommunikation: REST + SSE
- Modellzugriff: OpenAI-kompatible APIs

## Schnellstart

### Voraussetzungen

- Node.js 18+ (20+ empfohlen)
- Python 3.10+

### Backend starten

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

### Frontend starten

```bash
cd frontend
npm install
npm run dev
```

Das Frontend ist unter `http://localhost:3000/` verfuegbar, der Health-Check des Backends unter `http://127.0.0.1:8001/health`.

## API-Uebersicht

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

## Umgebungsvariablen

- Backend: `UPSTREAM_TIMEOUT_SECONDS`
- Frontend: `NEXT_PUBLIC_BACKEND_URL`

## Entwicklung

```bash
cd frontend
npm run lint
npm run build

cd ..\backend
python -m compileall app
```

Die ausfuehrlichere chinesische Referenz steht in [README.md](README.md).
