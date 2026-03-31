# Security Policy

## Supported Versions

本项目为本地运行的前后端应用示例，建议始终使用最新提交。

## Reporting a Vulnerability

如发现以下问题，请不要在公开 Issue 里直接贴敏感内容：

- 可能泄露 API Key / Token / 私钥
- 任意代码执行、鉴权绕过、越权读取会话数据
- 其它安全漏洞

请通过 GitHub 私信或邮件联系维护者，提供：

- 复现步骤
- 影响范围
- 可能的修复建议（如有）

## Notes

- 本项目不会把 API Key 写入后端数据库；API Key 仅在前端本地存储中保存。
- 请勿将 `.env*`、`.db`、`.pem`、`.key` 等文件提交到仓库（已在 `.gitignore` 中默认忽略）。
