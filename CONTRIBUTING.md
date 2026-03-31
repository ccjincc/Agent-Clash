# Contributing

欢迎提交 Issue / PR。

## 本地开发

### Backend

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## 代码规范

- 不要提交密钥/Token（`.env*`、私钥文件等）
- 保持 TypeScript / Python 风格一致

## 提交前检查

```bash
cd frontend
npm run lint
npm run build

cd ..\backend
python -m compileall app
```
