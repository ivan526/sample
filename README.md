# MSS样机备货管理平台

本仓库包含：

- 与高保真一致的React交互原型。
- 总体框架、需求收集、执行情况、基础配置的详细PRD。
- OpenAPI、PostgreSQL DDL和高保真追踪矩阵。
- 零依赖Node API基础代码与自动化测试。
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
- 本地接口使用`X-Role`请求头模拟角色（GTM/区域接口人/领域接口人等）

### 生产模式（使用PostgreSQL）
配置PostgreSQL连接字符串后启动：
```bash
# 配置环境变量
export DATABASE_URL="postgresql://username:password@localhost:5432/mss_stocking"
npm run dev:api:ts
# 或构建后运行
npm run build:server
node dist/index.js
```

## 启动前后端联调
```bash
# 终端1：启动后端API
npm run dev:api:ts
# 终端2：启动前端Vite服务
npm run dev
```
前端默认访问 `http://localhost:8787` 的API，后端不可用时自动降级使用原型Mock数据。

## 测试

```bash
npm run build
npm run test:sites
npm run test:api
```

## 文档入口

- `docs/MSS-sample-stocking-platform-PRD-v1.0.md`
- `docs/TECHNICAL-ARCHITECTURE.md`
- `docs/DOUBAO-VIBE-CODING-BRIEF.md`
- `docs/TRACEABILITY-MATRIX.md`
- `docs/openapi.yaml`
- `db/schema.sql`

当前前端默认使用原型内存数据，以保证高保真可独立浏览。`src/api/client.js`和`server/`用于后续逐页接入真实数据源。
