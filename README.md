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
- 自动执行数据库迁移、初始化华为验收数据（3个产品品类、4个MSS领域、8个产品、7个区域、9条计划）
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

## 华为核心场景测试数据

全新本地数据库首次启动时会自动加载完整数据。已经初始化过的开发库执行以下命令即可增量补齐，不会清空自行录入的数据：

```bash
npm run data:load:huawei
```

数据包含HUAWEI WATCH、Pura、Mate、MatePad、FreeBuds产品，以及产品建档、待下发、收集中、待领域反馈、待GTM收口、已导出六种计划状态；同时覆盖BOM待补、区域草稿/退回、后配置区域接口人、同账号跨领域任务、导出后变更审批、分批发货、库存盘盈盘亏和TSMP五类匹配结果。完整账号和场景说明见`docs/HUAWEI-TEST-DATA.md`，手工验收步骤见`docs/HUAWEI-MANUAL-TEST-CASES.md`。

## 配置批量导入

### 用户Excel导入

在“基础配置 → 用户管理”页面使用“Excel导入”，支持新增和更新用户，并按角色校验产品品类、MSS业务领域、区域/代表处等责任范围。导入模板由页面直接下载。

### 区域/代表处Excel导入

在“基础配置 → 区域与代表处”页面使用“Excel导入”，支持按Excel批量创建或更新区域、代表处及覆盖国家/地区，并可配置区域接口人和代表处接口人。

Excel字段：

- `区域`：必填；已有区域按名称更新，不存在则创建。
- `区域接口人`：可填写工号或姓名，必须是启用状态的“区域/代表处接口人”。
- `代表处`：可选；填写国家/地区时必须同时填写代表处。
- `代表处接口人`：可填写工号或姓名，必须是启用状态的“区域/代表处接口人”。
- `国家/地区`：多个值可使用顿号、逗号、分号或换行分隔，导入时增量合并。
- `状态`：启用/停用；留空时新建默认启用、更新时沿用原状态。

导入按区域分组；Excel只维护部分代表处时，不会因为未出现在Excel中而删除或停用其他已有代表处。

## Beta验证前清理数据

所有清理命令都应在**停止API服务**后执行。SQLite模式会先在`data/backups/`生成时间戳备份。生产环境或PostgreSQL必须先完成独立数据库备份，并额外设置`ALLOW_BETA_DATA_RESET=true`。

### 1. 只清理业务测试数据

```bash
npm run data:reset:beta -- --confirm RESET_BETA_DATA
```

清理需求计划、区域反馈、版本记录、导出记录、TSMP导入、执行、库存和审计日志；保留用户、权限、产品/BOM、产品品类、MSS业务领域、区域、代表处、国家及字典配置。

### 2. 只清理测试用户

```bash
npm run data:reset:beta:users -- --confirm RESET_BETA_USERS
```

仅保留受保护的`admin`系统管理员账号，删除其他测试用户及其责任范围。执行前要求业务测试数据已经清空，以避免历史业务记录引用被删除的用户。

### 3. 清理产品配置 + 测试用户

```bash
npm run data:reset:beta:config -- --confirm RESET_BETA_CONFIG
```

清理Beta期间录入的产品主数据、产品SKU及SKU映射，同时删除测试用户，仅保留`admin`。**不会删除产品品类、MSS业务领域、区域、代表处、国家/地区及字典配置。**执行前要求业务测试数据已经清空。

推荐重新准备Beta环境时按以下顺序执行：

```bash
# 先清理业务过程数据
npm run data:reset:beta -- --confirm RESET_BETA_DATA

# 再清理产品配置和测试用户
npm run data:reset:beta:config -- --confirm RESET_BETA_CONFIG
```

之后重新导入：

1. 用户Excel
2. 区域/代表处Excel
3. 产品配置Excel

注意：以上清理命令不会自动重新灌入华为演示业务数据；如需重新加载华为验收数据，请使用`npm run data:load:huawei`。

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
- `docs/HUAWEI-TEST-DATA.md`
- `docs/HUAWEI-MANUAL-TEST-CASES.md`
- `docs/openapi.yaml`
- `db/schema.sql`

需求计划、区域草稿/提交、领域反馈、正式Excel导出、执行聚合、TSMP Excel导入和库存核对均已接入真实API。测试会在临时SQLite数据库中跑通完整主链路。
