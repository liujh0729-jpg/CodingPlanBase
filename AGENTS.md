# CodingPlan Base 开发约定

本仓库是开源编程底座，开发数据库为仓库内 SQLite（`backend/prisma/dev.db`，`DATABASE_URL="file:./dev.db"`）。不要引入远端数据库、外部账号服务或任何厂商专属配置。

- 后端从被 Git 忽略的 `backend/.env` 读取 `DATABASE_URL`；不要把它改成远端库或在本机起 PostgreSQL 顶替。仓库只提交无密钥的 `.env.example`。
- 不要把用户名、密码、API Key、支付凭据或完整连接串写入文档、日志、命令行参数或 Git。支付与联合登录凭据只从环境变量读取，管理界面不回显明文。
- `*.db` / `*.db-shm` / `*.db-wal` 已被 Git 忽略，属于本机会话数据，禁止提交。造测试数据前先确认能清理，不要在演示库里留下真实业务数据。
- 迁移走 Prisma：`pnpm prisma:migrate:dev` 生成、`pnpm prisma:migrate:deploy` 应用。SQLite 不认 `ALTER COLUMN`，涉及表结构重定义时先备份库文件再演练。
- 本仓不用 npx：一律 `backend/node_modules/.bin/{prisma,tsc,nest}` 与 `frontend/node_modules/.bin/tsc`。前端没有 dayjs，需要日期输入时用「天数」输入框而不是 antd DatePicker。
- 前端所有后端调用经 Next BFF（`/api/backend/*`）与 httpOnly Cookie，浏览器不直连 Nest；后台页面权限由 `useSession()` 的 `isAdmin` / `isRoot` 门控。
