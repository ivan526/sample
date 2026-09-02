# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product-specific decisions

- The selected visual direction is the region-focused demand entry screen: one MSS/MKT region completes all demand items and submits them into its MSS domain summary; the domain owner feeds the completed summary back to GTM.
- Preserve the familiar Excel workflow with fast grid inputs and an explicit "从Excel粘贴" action.
- The visible matrix uses Chitu-B19F/B19W/B19FB/B19D with BOM 111/222/333/444 and Europe quantities 307/405/170/109.
- Keep the product calm and guidance-oriented: MSS blue/white palette, restrained amber for incomplete data, no punitive red styling, no gradients, no decorative dashboard clutter.
- The platform now includes eight connected navigation entries: 运营总览、需求收集、发货审批、执行情况、库存核对、提醒中心、数据明细、配置管理. Preserve one consistent navigation and visual system across them.
- 配置管理 owns the shared product master: product name, product domain, sample stage, supply time, collection deadline, collection scope, and one-to-many SKU/BOM mappings.
- GTM responsibility is configured by product domain rather than product by product. Products reference a domain (for example, Chitu → 穿戴), and inherit that domain's GTM owner and 领域备货接口人 automatically.
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
