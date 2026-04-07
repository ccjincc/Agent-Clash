# Agent-Clash

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Deutsch](README.de.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Frontend](https://img.shields.io/badge/frontend-Next.js-black)](frontend/)
[![Backend](https://img.shields.io/badge/backend-FastAPI-009688)](backend/)

Agent-Clash は、ローカルで実行できるマルチエージェント会話アリーナです。視覚的なサイドバーからルールとエージェントを設定し、テンプレートを読み込み、設定をインポート/エクスポートし、ターンを進め、既存の順番を壊さずに `@agent` で割り込み発話を指定できます。フロントエンドは Markdown 表示と折りたたみ可能な思考ブロックを提供し、バックエンドは FastAPI + SQLite で会話履歴を保持します。

## 主な機能

- 任意人数のエージェントによる会話対戦
- プリセットテンプレートによる素早い設定
- 会話セッションの作成、復元、削除
- `@agent` による強制返信
- SSE によるストリーミング出力
- `<SEARCH>...</SEARCH>` を使った任意の RAG 検索
- 長文対話向けの要約モデルとしきい値設定
- API Key はブラウザ保存のみで、バックエンド DB に保存しない構成

## 技術スタック

- フロントエンド: Next.js (App Router) + TypeScript + Tailwind CSS
- バックエンド: FastAPI + SQLAlchemy + SQLite
- 通信: REST + SSE
- モデル接続: OpenAI 互換 API

## クイックスタート

### 必要環境

- Node.js 18+（20+ 推奨）
- Python 3.10+

### バックエンド起動

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

### フロントエンド起動

```bash
cd frontend
npm install
npm run dev
```

フロントエンドは `http://localhost:3000/`、バックエンドのヘルスチェックは `http://127.0.0.1:8001/health` です。

## API 一覧

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

## 環境変数

- バックエンド: `UPSTREAM_TIMEOUT_SECONDS`
- フロントエンド: `NEXT_PUBLIC_BACKEND_URL`

## 開発コマンド

```bash
cd frontend
npm run lint
npm run build

cd ..\backend
python -m compileall app
```

詳細な中国語版は [README.md](README.md) を参照してください。
