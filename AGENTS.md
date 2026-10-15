# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product-specific decisions

- The selected visual direction is the region-focused demand entry screen: one MSS/MKT region completes all demand items and submits them into its MSS domain summary; the domain owner feeds the completed summary back to GTM.
- Preserve the familiar Excel workflow with fast grid inputs and an explicit "从Excel粘贴" action.
- The visible matrix uses HUAWEI WATCH 5 46mm/42mm/Pro/eSIM with BOM 55020HKC/55020HKD/55020HKE/55020HKF and Europe quantities 307/405/170/109.
- Keep the product calm and guidance-oriented: MSS blue/white palette, restrained amber for incomplete data, no punitive red styling, no gradients, no decorative dashboard clutter.
- The platform includes seven connected navigation entries: 运营总览、需求收集、发货审批、执行情况、库存核对、提醒中心、配置管理. “数据明细” has been removed; preserve one consistent navigation and visual system across the remaining entries.
- 配置管理 owns the shared product master: product name, product domain, sample stage, supply time, collection deadline, collection scope, and one-to-many SKU/BOM mappings.
- GTM responsibility is configured by product domain rather than product by product. Products reference a domain (for example, HUAWEI WATCH → 穿戴), and inherit that domain's GTM owner and 领域备货接口人 automatically.
- Product domains and their GTM/领域备货接口人 are configurable shared master data; changing a domain owner must propagate immediately to product configuration, demand entry, and execution views.
- The organization master is configurable as 区域 → 代表处 → 国家/地区, with an owner at region and representative-office levels. Demand collection and execution drill-down must reuse this shared organization tree.
- The source-of-truth business flow is: GTM creates a new-product record → GTM releases a collection plan to MSS domains → each MSS domain owner collects regional demand → the domain owner feeds the completed summary back to GTM → GTM exports the consolidated Excel for product-line production planning.
- Product creation must not require a BOM. A new project can start with only product name and product domain; model/SKU and BOM mappings may be added later. Demand collection must still support a product-level provisional row while model/BOM data is unavailable.
- A collection plan is a first-class object distinct from product master data. It owns the release scope, collection deadline, region feedback progress, current node, and GTM export action.
- 发货审批 and 执行情况 are separate workflows. 发货审批 supports a TSMP-page Bookmarklet/API query that checks an applicant's product, region, representative office, confirmed demand balance, and inventory before the stocking owner makes the actual approval in TSMP.
- 执行情况 uses TSMP-exported shipment data rather than manual shipment records. Match records to confirmed demand using product model + shipping region + representative office; show import coverage and unmatched/mapping counts before product/SKU execution tracking.
- Multiple products are a first-class platform concept. Demand entry switches one active product; overview, execution, and inventory support both all-product aggregation and single-product filtering. Never hard-code those pages to one product.
- 运营总览 must foreground inventory and execution signals. 库存核对 owns system-vs-physical inventory differences and closure notes.
- 执行情况 is a tracking view, not a row-by-row processing queue: default to product aggregation, expand to SKU, and allow geographic filtering down to region, representative office, and country. Model application and fulfillment as cumulative, multi-shipment progress; avoid status and operation columns.
- Keep multi-shipment tracking summarized as cumulative shipped quantity and shipment count; do not show fragmented batch-record cards unless the user asks to add them back.
- 需求收集必须按角色拆分工作台，不能在一张计划表里用状态按钮混合角色动作。GTM只管理计划创建、下发、进度、领域反馈和导出；MSS领域接口人拥有独立任务列表、区域进度、领域汇总与正式反馈GTM；区域/代表处接口人只处理本范围填报并提交至领域接口人。
- “查看填报”和“模拟收齐”不是GTM业务动作，不应出现在GTM计划管理中。区域收齐后必须经过“提交领域汇总给GTM”的正式交接，GTM收到后再进行收口和导出排产。
- Production implementation is contract-first: `docs/MSS-sample-stocking-platform-PRD-v1.0.md`, `docs/openapi.yaml`, `db/schema.sql`, and `docs/TRACEABILITY-MATRIX.md` define the build contract. When replacing seed state with APIs, preserve existing component hierarchy, CSS class names, visible copy, and high-fidelity layout unless the PRD explicitly requires a change.
- Confirmed demand must come from submitted regional data captured in the formal domain-feedback snapshot. Draft data must never enter GTM exports or execution totals.
- Production execution filters must use real product/SKU/organization aggregation. The prototype's display-only regional scaling must not survive backend integration.
- TSMP imports must be idempotent and auditable. Duplicate, mapping-required, unmatched, and invalid rows remain outside cumulative shipment totals until resolved.
- The high-fidelity shell always shows the signed-in role's effective data scope. ADMIN is global; GTM, MSS, regional/office, and stocking roles only see assigned products or organizations.
- Submitted regional demand is a locked snapshot. GTM/ADMIN and submitted-region access are read-only until a formal return flow reopens the task.
- Demand entry switches first-class collection plans rather than arbitrary products. The plan determines product, deadline, scope, and submission state.
- 本地开发与验收种子数据统一使用HUAWEI品牌产品，覆盖手机、平板、穿戴及BOM待补场景；内部稳定主键可继续沿用以保障自动化回归测试兼容。
- 样机阶段基础枚举固定为V3、V4、VN1、VN2；MSS业务领域使用独立的“MSS业务领域”主数据配置，不在基础枚举中重复维护。
- 区域每次正式提交都保留不可变版本快照；区域只读填报页和MSS区域进度必须可查看V1…Vn的提交人、时间、合计与SKU/BOM/代表处明细，归档或取消后仍可追溯。
- 顶栏区域选择器仅对区域/代表处接口人显示，MSS领域接口人通过领域任务内的区域进度工作，不显示全局区域选择器。
- TSMP业务领域与MSS领域匹配支持名称、编码以及末尾“样机/领域/业务领域”的确定性标准化（如GTM样机→GTM领域），禁止用模糊包含匹配；未命中提示必须带原始值、启用配置及已尝试规则。
- TSMP整文件导入指纹包含匹配规则版本；规则升级后允许原待映射文件重新执行，但已成功发货行继续通过行级指纹去重，禁止重复累计。
- 区域和代表处均允许先创建后分配接口人，未分配时显示“待配置”；创建区域/代表处接口人并选择对应区域或代表处后自动回填组织负责人，避免组织与用户主数据循环依赖。
- 区域删除采用安全删除：无计划、需求或执行引用时物理删除区域及下级组织；存在历史业务引用时整体停用并保留稳定ID和历史记录，且不再出现在新业务选择或用户负责范围中。
- Beta数据重置只清空计划、需求、导出、TSMP导入、执行、库存和审计等业务过程数据，必须保留用户、权限及全部基础配置；SQLite执行前自动备份，并要求显式确认口令。

- 需求填报页的区域、代表处选择必须支持大量选项：名称完整显示且自动换行，列表可滚动，数量较多时提供搜索；两个层级分区显示，禁止固定单行高度裁切或选项重叠。

- 产品型号及型号+BOM组合不做重复校验，由人工保证；手填、复制、Excel导入均允许重复，每行保留独立SKU ID。复制不复用原ID，编辑按ID保留历史引用，不按相同名称或BOM合并行。
- 外部发货同步采用本次增量；剩余待申请=确认需求-已申请（下限0）。写入必须有业务流水号并幂等，禁止覆盖正式需求与历史快照。
- Windows部署沿用现有update入口：更新脚本负责停止本项目旧服务、更新与编译、自动启动，无需用户额外执行命令行重启；同一版本定时检查不反复重启在线服务。
- GTM可在收集中/待领域反馈时提前完成：已正式反馈的领域快照保留，未反馈领域（包括仅有草稿、区域已提交或尚未下发）建立明确标识的GTM按0完成快照。原填报和提交历史保留，未反馈草稿不能计入导出/执行；界面必须区分正式反馈与按0结束，后续修改沿用正式退回/变更审批流程。

- 领域任务下发组织必须按区域→代表处→国家分层展示，提供搜索、展开、全选/半选。`organizationNodeIds`支持任意层级；按所选范围固化组织快照，填报不得越界。
- 需求最小层次为国家，保留代表处共享配额。按同一计划/领域/SKU/代表处判断：任一国家显式填数量（含0）后，国家明细覆盖代表处配额，未填国家0；原行和历史保留。空国家输入不保存，不自动生成零值触发覆盖。
- 外部需求查询可选stage，选择该SKU该阶段（或不限阶段）按计划创建时间最新的正式批次后再过滤组织；返回planId/planNo/stage。共享模式国家查询使用整个共享池和执行余额，不累加国家共享结果。发货增量关联计划，重试返回原流水。

- 取消无实际业务意义的已备货/产品线已排产数量：发货API只接受正整数shippedQuantity，移除stockedQuantity及相关返回统计；总览、执行表和导出不显示备货数量。历史PRODUCTION事实和流水保留，旧流水忽略已废弃备货字段后仍须保证发货幂等。GTM需求导出排产流程保留。
- 新建收集计划每次打开弹窗，收集截止时间默认浏览器本地当前时间后一周，保留时分；允许手动修改，不能写死日期或用UTC字符串直接显示为本地时间。
