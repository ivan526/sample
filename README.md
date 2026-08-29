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

## 运行接口骨架

```bash
npm run dev:api
```

默认地址：`http://localhost:8787`。本地接口使用`X-Role`模拟角色。

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
