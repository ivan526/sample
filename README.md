# MSS样机备货管理平台

本仓库包含：

- 与高保真一致的React交互原型。
- 总体框架、需求收集、执行情况、基础配置的详细PRD。
- OpenAPI、PostgreSQL DDL和高保真追踪矩阵。
- Fastify + TypeScript API、SQLite/PostgreSQL迁移与自动化集成测试。
- 可直接交给豆包执行的分阶段Vibe Coding指令。

## 运行高保真

```bash
npm install
npm run dev
```

## 运行后端API服务

### 开发模式（零配置，推荐）
无需安装任何数据库，自动使用SQLite文件数据库：
```bash
npm run dev:api:ts
```
- 首次启动自动创建SQLite数据库文件 `./data/mss_dev.db`
- 自动执行数据库迁移、初始化种子数据（3个领域、4个产品、6个区域测试数据）
- 默认地址：`http://localhost:8787`，API前缀 `/api/v1`
- 使用JWT登录，角色与领域/区域数据范围由服务端校验
- 演示数据只在非生产环境初始化；生产环境需显式设置`SEED_DEMO_DATA=true`才会写入

### 生产模式（使用PostgreSQL）
配置PostgreSQL连接字符串后启动：
```bash
# 配置环境变量
export DATABASE_URL="postgresql://username:password@localhost:5432/mss_stocking"
export JWT_SECRET="replace-with-a-long-random-secret"
npm run dev:api:ts
# 或构建后运行
npm run build:server
npm run start:server
```

## 启动前后端联调
```bash
# 终端1：启动后端API
npm run dev:api:ts
# 终端2：启动前端Vite服务
npm run dev
```
前端默认通过同源 `/api/v1` 访问后端，本地开发时由Vite转发到 `http://127.0.0.1:8787`。也可通过`VITE_API_BASE_URL`和`VITE_DEV_API_TARGET`指定地址。

## 在局域网内使用

推荐让前端通过同源 `/api/v1` 访问后端，Vite会自动转发到本机的 `8787` 端口。局域网内其他电脑只需访问前端端口，不需要把API地址配置成各自的`localhost`。

1. 复制`.env.example`为`.env`，保留以下配置：

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_DEV_API_TARGET=http://127.0.0.1:8787
VITE_DEV_PORT=5173
MSS_API_HOST=0.0.0.0
MSS_API_PORT=8787
```

2. 在服务器电脑的两个终端分别启动：

```bash
npm run dev:api:ts
npm run dev
```

3. 查询服务器电脑的局域网IPv4地址，其他电脑访问：

```text
http://<服务器局域网IP>:<Vite显示的端口>
```

端口通常为`5173`；若该端口已占用，Vite会显示实际使用的端口（例如`5174`）。需要在服务器防火墙中允许Node.js或该前端端口的入站访问。由于API由前端服务转发，通常不需要向局域网单独开放`8787`端口。

若使用电脑名而不是IP访问，将该名称加入`VITE_ALLOWED_HOSTS`。若前端必须跨域直连后端，则将完整前端来源加入`CORS_ORIGINS`，例如`http://192.168.1.20:5173`；多个来源用逗号分隔。

## 测试

```bash
npm run build
npm test
```

## 文档入口

- `docs/MSS-sample-stocking-platform-PRD-v1.0.md`
- `docs/TECHNICAL-ARCHITECTURE.md`
- `docs/DOUBAO-VIBE-CODING-BRIEF.md`
- `docs/TRACEABILITY-MATRIX.md`
- `docs/openapi.yaml`
- `db/schema.sql`

需求计划、区域草稿/提交、领域反馈、正式Excel导出、执行聚合、TSMP Excel导入和库存核对均已接入真实API。测试会在临时SQLite数据库中跑通完整主链路。
