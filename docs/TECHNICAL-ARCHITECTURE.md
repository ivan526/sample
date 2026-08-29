# MSS样机备货管理平台技术架构

## 1. 架构目标

在不改动当前高保真视觉与交互的前提下，把前端内存状态逐步替换为可审计、可并发控制、可接入TSMP的服务端能力。架构必须优先保证角色边界、业务状态机、主数据一致性和导入幂等性。

## 2. 推荐技术栈

| 层 | 生产推荐 | 当前基础代码 |
| --- | --- | --- |
| Web | React 19、Vite、TypeScript、React Router、TanStack Query、Zod | 现有React 19/Vite高保真；新增`src/api/client.js`契约客户端 |
| API | Node.js 22、Fastify或NestJS、TypeScript、Zod/OpenAPI | Node.js原生HTTP，可零依赖启动，路由和状态机可直接迁移 |
| 数据库 | PostgreSQL 16、Prisma或Drizzle | `db/schema.sql`提供完整DDL；骨架使用内存Repository |
| 异步任务 | Redis + BullMQ | TSMP导入骨架同步模拟；生产实现改为异步任务 |
| 文件 | 企业对象存储/OneBox兼容存储 | 本地仅返回导出元数据，不保存敏感文件 |
| 身份 | 企业SSO/OIDC | 本地用`X-Role`和`X-User-Id`模拟 |
| 观测 | OpenTelemetry、结构化日志、指标告警 | 每个响应携带`requestId` |

## 3. 逻辑架构

```mermaid
flowchart TD
  UI["React高保真Web"] --> API["REST API / RBAC"]
  API --> COL["需求收集域"]
  API --> EXE["执行匹配域"]
  API --> CFG["主数据配置域"]
  API --> OVR["运营总览读模型"]
  COL --> DB["PostgreSQL"]
  CFG --> DB
  EXE --> DB
  EXE --> JOB["TSMP导入任务"]
  OVR --> DB
  OVR --> INV["库存只读接口"]
```

## 4. 工程目录

```text
mss-sample-stocking-platform/
├── src/                         # 当前高保真Web
│   └── api/client.js            # REST客户端骨架
├── server/
│   ├── index.mjs                # 本地API入口
│   ├── app.mjs                  # 路由、鉴权、响应封装
│   └── seed.mjs                 # 与高保真一致的样例数据
├── shared/
│   └── domain.mjs               # 状态、角色、聚合与业务规则
├── db/schema.sql                # PostgreSQL目标表结构
├── docs/
│   ├── MSS-sample-stocking-platform-PRD-v1.0.md
│   ├── TECHNICAL-ARCHITECTURE.md
│   ├── openapi.yaml
│   ├── TRACEABILITY-MATRIX.md
│   └── DOUBAO-VIBE-CODING-BRIEF.md
└── tests/api.test.mjs           # API骨架测试
```

## 5. 领域边界

### 5.1 配置域

拥有产品领域、产品、SKU/BOM、区域—代表处—国家组织树和TSMP别名。业务表仅保存稳定ID及必要快照，不复制当前责任人姓名。

### 5.2 需求收集域

拥有收集计划、计划范围快照、区域草稿/提交、领域反馈快照和GTM导出。所有状态变更必须由领域服务完成，控制非法跳转。

### 5.3 执行匹配域

拥有TSMP导入任务、原始行、标准化值、匹配结果和累计执行事实。导入应采用“原始层→标准化层→匹配层→聚合读模型”四层处理，不直接覆盖历史累计值。

### 5.4 总览读模型

不拥有源数据，只按产品、SKU和组织维度聚合确认需求、排产、申请、发货与库存。总览与执行情况必须复用同一聚合服务。

## 6. 身份、RBAC与数据范围

生产请求从SSO令牌解析`userId`、角色和授权范围。本地基础代码使用：

```http
X-Role: GTM | MSS_DOMAIN_OWNER | REGIONAL_OWNER | STOCKING_OWNER
X-User-Id: demo-user
```

鉴权分两层：

1. 路由权限：角色是否允许调用该动作。
2. 数据范围：用户是否负责目标领域、区域或代表处。

配置读取可共享，配置写入首期按高保真允许GTM操作；正式上线建议将领域/组织配置写权限收敛到运营管理员，但不要新增高保真未体现的页面。

## 7. 状态与并发

- 业务状态在`shared/domain.mjs`定义稳定英文code，中文文案由前端映射。
- 更新请求携带`version`或`If-Match`；数据库使用`WHERE id=? AND version=?`更新。
- 状态更新、区域提交、领域反馈和审计日志必须在同一事务完成。
- 区域自动保存使用幂等PUT；正式提交和领域反馈使用幂等键，防止重复点击。

## 8. TSMP导入设计

```mermaid
flowchart TD
  A["上传Excel"] --> B["表头与数量校验"]
  B --> C["标准化SKU和组织名称"]
  C --> D["数据指纹去重"]
  D --> E["关联确认需求"]
  E --> F["保存匹配/异常结果"]
  F --> G["刷新累计执行读模型"]
```

生产实现建议：

- API只负责创建导入任务并返回`jobId`，Worker异步解析文件。
- 原始文件保留受控期限，原始行保存来源行号和指纹。
- 任何重试都按`jobId+fingerprint`幂等，不重复累计。
- 别名映射更新后只重跑未匹配行，不重导已成功记录。

## 9. 前端接入策略

为了保持高保真一致，分三步替换当前内存状态：

1. 先用`src/api/client.js`读取配置、计划和执行数据，保留原组件和CSS。
2. 将页面中的状态更新函数替换为Mutation，成功后刷新对应query；不得重写页面结构。
3. 最后移除`productData.js`和页面seed，但保留为Storybook/测试fixture。

前端缓存Key建议：

```text
['catalog']
['collection-plans', role, domainId, regionId, keyword]
['collection-plan', planId]
['execution', productId, regionId, officeId, country, keyword]
['overview', productId]
```

## 10. 数据一致性

- 产品责任人通过`product.domain_id`实时关联领域，不在产品表重复保存。
- 计划范围下发时保存组织快照；配置变化不改写历史计划。
- 区域草稿与提交分开存储；确认需求只读取已提交且被领域反馈的快照。
- 总计由数据库或领域服务统一计算并返回，前端只做展示性校验。
- TSMP累计值来自匹配事实求和，不使用比例缩放模拟区域数据。

## 11. 错误码

| code | 场景 |
| --- | --- |
| `AUTH_REQUIRED` | 未登录或缺少身份 |
| `FORBIDDEN` | 角色或数据范围不允许 |
| `VALIDATION_ERROR` | 字段校验失败 |
| `PLAN_STATE_CONFLICT` | 当前状态不允许动作 |
| `VERSION_CONFLICT` | 并发版本冲突 |
| `REGIONS_INCOMPLETE` | 领域反馈时仍有区域未提交 |
| `IMPORT_HEADER_INVALID` | TSMP文件缺少必需列 |
| `IMPORT_DUPLICATE` | 文件或数据行已导入 |
| `MATCH_NOT_FOUND` | 无法匹配产品/组织/确认需求 |
| `NOT_FOUND` | 资源不存在 |

## 12. 测试策略

- 单元测试：状态机、汇总公式、TSMP指纹/匹配、角色权限。
- API测试：创建/下发计划、区域提交、领域反馈、配置无BOM产品、执行筛选。
- 集成测试：PostgreSQL事务、并发版本、导入幂等。
- E2E：四类角色完整业务流；逐屏比对高保真。
- 视觉回归：固定1363×936与1440×900截图，比较导航、KPI、表格、弹窗和底栏。

## 13. 本地运行

```bash
npm install
npm run dev
```

另开终端启动接口骨架：

```bash
npm run dev:api
```

接口健康检查：`GET http://localhost:8787/healthz`。前端默认仍使用高保真内存数据；设置`VITE_API_BASE_URL=http://localhost:8787/api/v1`后可按页面逐步接入。

## 14. 生产演进检查单

- [ ] 将`server/seed.mjs`替换为PostgreSQL Repository。
- [ ] 将原生HTTP路由迁移到Fastify/NestJS，保持OpenAPI路径不变。
- [ ] 接入SSO并移除生产环境的`X-Role`模拟。
- [ ] TSMP导入改为对象存储+异步Worker。
- [ ] 接入真实库存只读服务与产品线排产数据。
- [ ] 增加审计查询、导出水印、数据保留和脱敏策略。
