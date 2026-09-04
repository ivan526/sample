# 给豆包的 Vibe Coding 执行指令

你要在现有工程中把MSS样机备货管理平台从高保真原型演进为可联调产品。不要重新设计UI，不要改变已确认业务边界。

## 一、开始前必须阅读

按顺序阅读：

1. `AGENTS.md`
2. `docs/MSS-sample-stocking-platform-PRD-v1.0.md`
3. `docs/TECHNICAL-ARCHITECTURE.md`
4. `docs/TRACEABILITY-MATRIX.md`
5. `docs/openapi.yaml`
6. `db/schema.sql`
7. `src/App.jsx`、`src/BusinessFlowPages.jsx`、`src/OperationalPages.jsx`、`src/productData.js`、`src/styles.css`
8. `qa/final-01-gtm-plan.png`、`qa/final-02-mss-tasks.png`、`qa/final-03-domain-feedback.png`、`qa/final-04-region-entry.png`

## 二、不可违反的产品约束

- GTM、MSS领域接口人、区域/代表处接口人是三套独立需求收集工作台。
- GTM不进行区域填报，不得出现“查看填报”和“模拟收齐”。
- 区域提交后先进入领域汇总；只有MSS点击“提交领域汇总给GTM”才算正式反馈。
- 产品属于产品领域，GTM和领域备货接口人从领域继承，不在产品上重复维护。
- 新品创建只要求产品名称和领域；SKU/BOM均可后补。
- 多产品是首要能力，不得硬编码Chitu B19。
- 执行情况默认按产品，展开到SKU，再通过区域→代表处→国家筛选。
- 申请和发货都是累计值；不增加执行状态/操作列，不恢复零散发货记录卡片。
- TSMP Excel字段固定映射：业务领域→MSS领域、地区部→区域、代表处→代表处、国家/地区→国家、BOM编码→产品BOM编码、发货数量→实际发货数量；未匹配和重复数据不能累计。
- 所有布局、配色、表格密度、按钮层级、文案与高保真一致。

## 三、实现方式

不要一次重写整个前端。采用“接口契约不变、页面逐个接入”的方式：

### Sprint 1：工程和主数据

1. 将`server/`骨架迁移为TypeScript Fastify/NestJS服务。
2. 根据`db/schema.sql`创建PostgreSQL迁移和Repository。
3. 接入`GET /config/catalog`，保持当前配置页面结构不变。
4. 完成产品、领域、组织的新增/编辑/启停及并发版本校验。
5. 测试无SKU/BOM产品可创建。

### Sprint 2：需求收集闭环

1. 接入GTM计划列表、新建计划、下发计划。
2. 接入MSS领域任务列表和区域进度。
3. 接入区域草稿自动保存、Excel粘贴、提交。
4. 接入领域汇总、确认清单、正式反馈GTM。
5. 接入GTM导出快照和导出审计。
6. 对照四张`qa/final-*`截图完成视觉回归。

### Sprint 3：TSMP执行

1. 实现导入任务、字段校验、标准化、去重和匹配。
2. 接入执行KPI和产品→SKU表。
3. 接入区域→代表处→国家联动筛选。
4. 移除页面中的比例缩放mock，所有数字使用真实聚合。
5. 验证执行表固定九列且无处理操作。

### Sprint 4：运营总览与上线准备

1. 总览复用执行聚合服务，不另写一套公式。
2. 接入库存只读接口和产品线排产数据。
3. 补齐SSO、RBAC、审计、异常重试和性能指标。
4. 运行完整单元、API、E2E和视觉回归测试。

## 四、每次提交的输出格式

每次只完成一个可验收切片，并输出：

1. 本次完成的需求ID。
2. 修改文件列表。
3. 接口/数据库变化。
4. 测试命令和结果。
5. 对照的高保真截图。
6. 尚未完成和已知风险。

禁止只回复“已完成”。禁止在测试失败时继续下一阶段。

## 五、第一条执行提示词

```text
请严格阅读AGENTS.md、docs/MSS-sample-stocking-platform-PRD-v1.0.md、docs/TECHNICAL-ARCHITECTURE.md、docs/TRACEABILITY-MATRIX.md、docs/openapi.yaml和db/schema.sql。先不要重做UI。

本次只完成Sprint 1：把server/基础接口迁移为TypeScript的生产结构，按DDL建立PostgreSQL数据层，接通配置管理的catalog/product/domain/organization接口，并让现有ConfigurationPage在不改变DOM结构、CSS类名和高保真视觉的前提下改用真实接口。产品名称和所属领域是唯一必填，SKU/BOM可为空；产品责任人必须从领域继承。完成后运行全部现有测试、新增API测试，并对照qa/domain-responsibility-final.jpg与qa/organization-config-final.jpg做截图核验。不要提前实现Sprint 2—4。
```

## 六、代码审查清单

- [ ] 没有在组件中复制后端状态机。
- [ ] 没有用产品/组织名称做数据库关联键。
- [ ] 没有把BOM改成必填。
- [ ] 没有混合GTM、MSS和区域按钮。
- [ ] 没有使用前端比例缩放伪造区域数据。
- [ ] 没有用单一状态表示多次申请/发货。
- [ ] 没有改变高保真结构和视觉token。
- [ ] 所有写操作有服务端鉴权、校验、并发控制和审计。
- [ ] 导入有幂等键和异常明细。
- [ ] 测试覆盖合法与非法状态跳转。
