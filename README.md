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

### Windows更新后自动启动

继续使用原来调用`scripts/update-windows.ps1`的更新BAT即可：下载与备份完成后，自动停止本项目服务、覆盖代码、编译，再启动前后端，并等待API与Vite就绪。不需要再打开命令行手动重启。

从旧更新脚本首次升级时，新启动脚本也会自动停止旧进程并启动新版；同一版本的后续检查通过`-KeepRunning`保留在线服务。旧PM2更新入口继续由指定服务名负责重启。

更新失败时会尝试恢复旧代码、重新编译并启动旧服务。`.env`和`data`仍保留，SQLite仍在更新前备份。`-CheckOnly`只检查，`-NoStart`只更新代码和编译，不停止或启动服务；PM2部署继续通过`-Pm2Names`指定需要重启的服务。

脚本分别记录“代码更新成功”和“该版本启动成功”。旧脚本曾提示已是最新、但旧进程没有重启的情况，会自动补做一次重启；同一版本后续定时检查只补启动缺失的窗口服务，不会反复重启在线服务。

### Windows单独重启（可选）

如果已经安装下方的“Windows开机自动启动”，该BAT改为重启后台计划任务，不再打开服务窗口；请以管理员身份运行。

更新代码后，双击项目根目录的`start-windows.bat`，会先停止本项目旧的前后端进程，再打开两个窗口启动最新源码。无需重新编译后端。停止失败或配置端口仍被占用时不会继续启动。

如果已有自己的BAT，在原启动命令前加入以下两行（BAT位于项目根目录）：

```bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-windows.ps1" -RepoPath "%~dp0."
if errorlevel 1 exit /b 1
```

停止脚本按本项目的完整路径识别服务及其子进程，包括Vite自动切换到5174等端口的情况，不会按端口或统一结束所有`node.exe`。通过其他目录以相对路径手动启动、且无法确认归属的进程不会被停止，请在原窗口按`Ctrl+C`。PM2部署请使用`pm2 stop <实际服务名>`或更新脚本的`-Pm2Names`参数。

### Windows开机自动启动（PC重启后无需登录）

更新代码后，在部署电脑的项目根目录右键 `install-windows-autostart.bat` → **以管理员身份运行**，只需安装一次。看到 `Windows autostart installed and services are ready.` 即表示已安装并通过前后端就绪检查。以后PC开机约30秒后开始启动，启动耗时取决于电脑；无需登录、打开窗口或联网下载代码。可在一次正常重启后，从另一台电脑访问原局域网地址验收。

- 使用两个Windows计划任务分别运行API和前端，任务名包含部署目录指纹，多套部署不互相覆盖。以SYSTEM账号运行，无需保存个人密码，不受用户注销影响。
- 后台任务持续守护前后端，程序退出后按1分钟间隔重新启动；正常在线服务不会被周期重启。调度任务另外配置失败重试，最多999次。此机制不检测进程仍在但无响应的情况。
- 任务不设默认的三天运行上限；电池供电也允许启动和继续运行。电脑关机或休眠期间不能提供服务，请按部署需要设置Windows电源选项。
- 日志位于 `data/logs/windows-api.log` 和 `data/logs/windows-web.log`。每次进程启动时，超过10MB的旧日志保留为 `.previous`；运行中的日志继续追加。
- `.env`中的 `MSS_API_PORT` / `VITE_DEV_PORT` 继续生效。后台前端使用严格端口，端口被占用时记录错误，不悄悄切换地址。Node使用安装时检测到的绝对路径；移动项目、删除或切换Node安装后，应重新运行安装BAT。项目及Node必须位于SYSTEM可访问的本地磁盘，不能依赖个人映射盘或个人账号的网络凭据。
- 后续继续使用原update BAT，但需要**以管理员身份运行**：更新前停止计划任务，更新/编译后启动任务，失败时沿用原回滚恢复。安装时会将本目录已存在的交互式自动更新任务改为最高权限，保留原运行账号、下载代理及个人代理凭据；自动更新仍只在该账号登录期间执行，开机启动服务不依赖更新任务。以后重新安装自动更新任务时也需要管理员权限。
- 不与PM2同时管理同一套服务。已有PM2时先通过其原管理方式停止；安装检测到PM2管理的进程会拒绝接管。

需要临时维护时，以管理员身份运行 `scripts/stop-windows.ps1`；它先停止任务再结束本项目遗留子进程。该操作不会删除开机触发器，下次重启仍会启动。要长期停用，请在“任务计划程序”中禁用本项目对应的两个任务；恢复时重新启用并运行 `start-windows.bat`。

### 从w3页面跨域调用局域网API

如果报错显示来源为`https://w3.huawei.com`、请求地址为`http://10.75.18.111:5174/api/v1/...`，在服务器项目根目录的`.env`中配置浏览器页面来源：

```dotenv
CORS_ORIGINS=https://w3.huawei.com
```

已有其他来源时用英文逗号追加；逗号两侧空格会自动去除。这里填写的是发起请求的页面来源，不是API服务器地址，也不包含路径。

Vite默认会先处理OPTIONS预检，再进入`/api`代理，可能导致后端白名单正确但预检仍缺少允许跨域响应头。本项目使用`server.cors.preflightContinue=true`让预检继续交给后端；`vite preview`继承同一配置。后端仍按`CORS_ORIGINS`判断来源，未允许的外部来源不会得到授权响应头。

更新代码和`.env`后，重启前端Vite和后端API进程；生产后端运行编译产物时，先执行`npm run build:server`。后端启动日志中的`CORS policy configured`会列出实际加载的来源白名单。

可在Windows PowerShell中通过实际前端端口验证（请按部署地址调整）：

```powershell
curl.exe -i -X OPTIONS "http://10.75.18.111:5174/api/v1/auth/login" -H "Origin: https://w3.huawei.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
```

应返回204，并包含`Access-Control-Allow-Origin: https://w3.huawei.com`及允许POST的响应头。如果直连API端口正常、经过前端端口异常，应检查前端代理是否已更新和重启。

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

## 外部系统对接

需求汇总与备货/发货增量接口、调用示例和幂等规则见[外部API说明](docs/EXTERNAL-API.md)。型号Excel导入在配置管理的新增/编辑产品弹窗中使用，先下载模板，再导入并检查后保存。
