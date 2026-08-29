# Design QA

## Comparison target

- Source visual truth: `/workspace/scratch/0acd67834fda/generated_images/exec-272e554b-d742-4b99-b0c7-97885edcb497.png`
- Browser-rendered implementation: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/implementation-final.jpg`
- Full-view comparison: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/comparison-final.jpg`
- Focused form/table comparison: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/comparison-focus-final.jpg`
- Operational overview: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/overview-final.jpg`
- Prior demand-execution baseline: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/execution-final.jpg`
- Revised product/SKU tracking view: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/execution-tracking-final.jpg`
- Current simplified execution view: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/execution-tracking-simplified-final.jpg`
- Current execution comparison: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/execution-tracking-simplified-comparison.jpg`
- Inventory reconciliation: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/inventory-final.jpg`
- Four-screen design-system comparison: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/operational-pages-comparison.jpg`
- Demand view with inherited domain responsibility: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/demand-responsibility-final.jpg`
- Product-domain responsibility configuration: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/domain-responsibility-final.jpg`
- Region/representative-office organization configuration: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/organization-config-final.jpg`
- Responsibility and organization comparison: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/responsibility-config-comparison.jpg`
- End-to-end collection-plan screen: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/collection-flow-final.jpg`
- TSMP shipment-approval verification: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/shipment-approval-final.jpg`
- TSMP export import-and-match execution view: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/tsmp-execution-final.jpg`
- Four-screen business-flow comparison: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/business-flow-comparison.jpg`
- Role-redesign source, GTM plan screen: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/audit-01-gtm-plan.png`
- Role-redesign source, regional entry screen: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/audit-02-mss-feedback.png`
- Revised GTM plan workbench: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/final-01-gtm-plan.png`
- Revised MSS domain-task workbench: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/final-02-mss-tasks.png`
- Revised domain feedback confirmation: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/final-03-domain-feedback.png`
- Revised regional entry: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/final-04-region-entry.png`
- Role-redesign GTM comparison: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/design-qa-gtm-comparison.jpg`
- Role-redesign entry comparison: `/workspace/scratch/0acd67834fda/mss-sample-stocking-platform/qa/design-qa-entry-comparison.jpg`
- State: 欧洲MKT selected; first quantity input focused; 4 SKU quantities populated; Chitu-B19D demand basis intentionally incomplete; footer validation and right-side pre-submit checks visible.

## Viewport and normalization

- Browser CSS viewport: `1363 × 936` CSS px.
- Browser implementation capture: `1348 × 926` px at device density `1`; the browser capture excludes scrollbar gutters.
- Source image: `1487 × 1058` px.
- Normalization: source was proportionally fit inside a `1348 × 926` white canvas without stretching. The complete source frame remains visible; narrow white side padding accounts for the source's slightly taller aspect ratio.

## Evidence reviewed

- Full view: reviewed global navigation proportions, top bar, page title and batch metadata, region tabs, main form/right-rail split, footer height, action placement, and viewport containment using `qa/comparison-final.jpg`.
- Focused view: reviewed table headers, column widths, row density, input/select/date anatomy, focus and warning states, SKU/BOM copy, quantities, dates, demand-basis values, status labels, and inline validation using `qa/comparison-focus-final.jpg`.
- A focused crop was required because form typography, cell states, and table controls are too small to judge reliably in the full-frame comparison.
- Operational extension: reviewed the overview, demand-execution, and inventory-reconciliation screenshots together with the selected visual source. Confirmed that header/sidebar geometry, typography, surface borders, table density, blue action hierarchy, green completion states, and restrained amber warning states remain part of one coherent system.
- Execution redesign: reviewed the prior queue-style execution screen and the current product/SKU tracking screen together in `qa/execution-tracking-simplified-comparison.jpg`. The functional hierarchy changed intentionally while the established visual system remained stable.
- Multi-product extension: reviewed the browser-rendered GTM product master, product-aware demand entry, all-product execution summary, product-level organization drill-down, and product-filtered inventory. The new configuration modal and product selectors retain the established surface, typography, border, and control anatomy.
- Responsibility and organization extension: reviewed the demand-entry metadata, product-domain ownership table, and expandable region/representative-office/country tree together in `qa/responsibility-config-comparison.jpg`. Confirmed that the added configuration density remains consistent with the selected blue-white visual system and that all new surfaces fit the 1363px viewport without document-level horizontal overflow.
- End-to-end business-flow extension: reviewed the selected regional demand-entry source together with the collection-plan, TSMP approval, and TSMP execution-import screens in `qa/business-flow-comparison.jpg`. The new workflow cards, KPI strips, dense tables, approval comparison, and import mapping panel preserve the source's header/sidebar proportions, blue-white palette, typography hierarchy, compact control anatomy, and restrained amber exception treatment.
- Role-separation redesign: reviewed the source and revised GTM screens together in `qa/design-qa-gtm-comparison.jpg`, and the source/revised regional entry together in `qa/design-qa-entry-comparison.jpg`. The redesign intentionally changes workflow ownership while preserving the established header, navigation, KPI strip, compact table, right-rail, form control, and sticky-action visual system.

## Required fidelity surfaces

- Fonts and typography: system Chinese sans stack matches the visual weight and proportions of the reference. Heading, body, metadata, table, and button hierarchy align; no material wrapping or truncation remains.
- Spacing and layout rhythm: 72px header, 220px sidebar, full-height content frame, right support rail, table row rhythm, and fixed action footer match the reference hierarchy. Frame and footer meet without hiding persistent controls.
- Colors and visual tokens: white/#F7F9FC surfaces, MSS blue primary, pale blue selected navigation, green completion states, and restrained amber warnings match the source. No gradient or decorative background drift.
- Image and asset fidelity: the selected source contains no hero or product raster imagery. All UI icons use the Tabler icon library; no handcrafted SVG, CSS drawing, or placeholder asset substitutes are present.
- Copy and content: title, batch metadata, regions, Chitu SKU names, BOM codes, quantities, demand bases, dates, totals, checks, progress labels, and footer actions match the selected source.
- Extension consistency: the three new pages keep the source's calm blue-white MSS system. KPI cards use simple separators instead of decorative card effects; execution and inventory tables retain the same compact data-entry density; no gradients, illustration substitutes, or unrelated visual motifs were introduced.
- Revised execution content: the screen now uses product aggregation, nested SKU rows, organization filters through representative office and country, cumulative application/shipment amounts, remaining gaps, dual progress, and a compact shipment-count summary. The former status and operation columns are absent; detailed shipment-record cards are intentionally omitted.

## Browser interaction verification

- Opened “从Excel粘贴”, parsed a four-value row, filled all four SKU quantities, and confirmed the total recalculated.
- Filtered the table by BOM `444` and verified a single matching row.
- Completed the missing demand basis and verified the validation state changed to “全部信息已完善”.
- Submitted 欧洲MKT and verified the success toast “欧洲MKT需求已提交给GTM”.
- Switched to 东南亚MKT and verified both the heading and submit action updated to that region, then returned to 欧洲MKT.
- Saved a draft and verified the save-success toast.
- Navigated through 运营总览, 需求执行, 库存核对, and 备货需求申报; verified the active navigation state and role context update on each page.
- Expanded and collapsed the product summary and verified the four Chitu SKUs follow the product row.
- Filtered from 全球MSS to 欧洲MKT → 德国代表处 → 德国 and verified KPI values, table totals, and scope label updated together.
- Verified the revised execution table contains no status or operation columns and no detailed shipment-record cards.
- Enabled “仅看差异” in inventory reconciliation and verified only two variance rows remained.
- Opened a variance item, reconciled the physical count to system stock, selected a difference reason, completed the check, and verified the filtered variance list reduced from two rows to one.
- Checked browser console warnings/errors; no application-origin warnings or errors were present. One Chrome-extension metadata message was excluded as non-application noise.
- Switched demand entry from Chitu B19 to Chitu B21 and verified the title, stage, GTM owner, deadline, three SKU/BOM rows, quantities, checks, total, and template context updated together.
- Created a fourth product with two SKU/BOM mappings through the GTM configuration modal and verified it appeared immediately in the configuration table and demand-entry product selector with two editable rows.
- Reloaded to the baseline catalog, verified 运营总览 defaults to three product rows and supports all/single-product selection, then verified 需求执行 defaults to three collapsed product summaries and expands Chitu B21 to three SKU rows.
- Filtered execution to 欧洲MKT → 德国代表处 → 德国 and verified the organization path and product/SKU metrics synchronized.
- Filtered inventory to Chitu B21 and verified three matching inventory rows, B21-only KPIs, coverage rows, and a product-specific variance reminder.
- Switched configuration among 产品配置、领域与责任人、区域与代表处 and verified all three views render and retain the shared table/control anatomy.
- Edited the 穿戴 domain GTM from 王璐 to 王璐A and verified both Chitu products inherited the change in the product table and the demand-entry metadata immediately; reloaded afterward to restore the baseline catalog.
- Added 北欧代表处 under 欧洲MKT with owner 许文 and countries 瑞典、挪威、芬兰, then verified the new office and countries appeared immediately in the execution drill-down selectors; reloaded afterward to restore the baseline organization tree.
- Verified the product modal derives GTM and 领域备货接口人 from the selected product domain instead of collecting duplicate product-level owner fields.
- Verified demand, domain-responsibility, and organization-configuration views have no document-level horizontal overflow at the 1363px browser viewport.
- Opened Chitu B21 from the collection-plan table and verified the role switched from GTM to MSS领域接口人, the selected product changed, and the region/SKU demand grid loaded the correct three-row dataset.
- Switched the demand grid to Chitu B23新品项目 and verified a product-level provisional row appears with “型号待补充” and “待产品线补充” while demand quantity, basis, date, note, draft, and submit controls remain available.
- Created a temporary Nova手机新品项目 from configuration with only product name and domain; verified the record saved successfully with inherited 手机-domain owners and no SKU/BOM requirement, then reloaded to restore the baseline catalog.
- Opened the Bookmarklet setup dialog and verified the three installation steps, installation script, production permission note, and copy action are present.
- Queried and switched among three TSMP approval examples; verified pass, over-demand, and no-demand recommendation logic is based on product model, region, representative office, remaining confirmed demand, and inventory.
- Opened the TSMP import dialog, verified the four exported-field mappings, completed an import, and confirmed the automatic-match count changed from 412 to 424.
- Verified collection plan (`1363 × 936`), shipment approval (`1363 × 936`), and TSMP execution (`1348 × 926`, scrollbar gutter excluded) have no document-level horizontal overflow.
- Switched among GTM、MSS领域接口人、区域/代表处接口人 and verified each role lands on its own workbench instead of sharing status-dependent actions on one page.
- Opened B19 from the MSS task list, reviewed 区域收集进度、领域需求汇总、反馈GTM, submitted the formal domain feedback, and verified the state changed to “待GTM收口”.
- Switched back to GTM and verified “查看领域反馈” and “导出排产” became available without entering the regional form.
- Entered the B21 欧洲MKT regional task, submitted it to the domain owner, returned to the task list, and verified the regional status and MSS progress changed from `3/5` to `4/5`.
- Re-ran the primary role-switch and domain-feedback flow in a fresh browser tab. No application-origin warnings or errors were present; only browser-extension metadata noise existed in the older shared tab and was excluded.
- Verified the final 1363 × 936 viewport has `scrollWidth === innerWidth` on the MSS task/feedback flow, so no document-level horizontal overflow remains.

## Comparison history

### Iteration 1

- Earlier P2 findings: region tabs rendered an unnecessary scrollbar; native date inputs clipped the final date digits; table header/column compression caused BOM wrapping; the shorter footer sat below the reference position and overlapped the content frame.
- Fixes: removed tab overflow, changed visible date controls to stable `YYYY-MM-DD` text inputs with calendar affordance, widened/rebalanced table columns, tightened row and toolbar rhythm, and increased the fixed footer height while making the content frame viewport-aware.
- Post-fix evidence: `qa/implementation-initial.jpg` and the later `qa/comparison-final.jpg` show all six tabs, complete dates, single-line BOM header, and unobscured footer actions.

### Iteration 2

- Earlier P2 findings: visible dates differed by one year from the selected mock; the active 欧洲MKT status dot remained amber; right-rail validation icons were outlined instead of filled.
- Fixes: aligned dates to `2025-12-15`, `2025-12-20`, `2025-12-30`, and `2026-01-05`; forced the active tab status dot to MSS blue; replaced right-rail checks and warning with matching filled library icons.
- Post-fix evidence: `qa/comparison-focus-final.jpg` shows the corrected dates and active state; `qa/comparison-final.jpg` shows matching status icon treatment.

### Operational extension

- Added the requested 运营总览, 需求执行, and 库存核对 screens without changing the selected demand-entry visual direction.
- Initial inventory review exposed a P2 horizontal table overflow at the 1363px browser viewport. The minimum table width was reduced from 920px to 810px while preserving column clarity and row density.
- Post-fix evidence: `qa/inventory-final.jpg` shows every inventory column and action in the main panel without a horizontal scrollbar. `qa/operational-pages-comparison.jpg` confirms all four screens share the same navigation, spacing, border, color, and typography system.

### Execution tracking redesign

- Replaced the earlier row-by-row approval/reminder queue with a product-first tracking model. The default view shows a product summary and its SKU hierarchy.
- Added dependent region, representative-office, and country filters. KPIs and table quantities recalculate for the selected organization range.
- The first redesign iteration included expandable shipment-record cards. User feedback identified these records as too fragmented, so the detail expansion was removed while cumulative shipment quantity and shipment count were retained.
- Post-fix evidence: `qa/execution-tracking-simplified-final.jpg` shows the complete product/SKU table without horizontal page overflow or fragmented detail cards; `qa/execution-tracking-simplified-comparison.jpg` confirms visual continuity with the prior operational screen.

### GTM product master and multi-product extension

- Added a dedicated GTM product configuration page with list/search, enable/disable, edit, and add-product flows. The modal supports one-to-many SKU/BOM rows and validates required product/time/owner fields.
- Reworked demand-entry state from one hard-coded Chitu B19 table into product → region → SKU data. Product switching updates all contextual metadata, row count, totals, validation, Excel paste count, and template contents.
- Reworked overview, execution, and inventory to share the same product catalog. All-product mode aggregates product-level metrics; single-product mode exposes SKU-level details where relevant.
- First visual review found a P2 horizontal overflow in the nine-column GTM master table. Column widths, minimum width, and cell padding were tightened; the 1363px viewport now has `scrollWidth === clientWidth` and all edit/enable controls remain visible.

### Product-domain responsibility and organization configuration

- Replaced per-product GTM entry with a product-domain relationship. Chitu products belong to 穿戴, while phone and tablet products can inherit their own domain responsibility without duplicating owner data across product rows.
- Added a 领域与责任人 configuration tab for the domain name, description, GTM, 领域备货接口人, linked-product count, and enable state. Owner edits propagate to downstream product and demand metadata in the same session.
- Added a 区域与代表处 tab with expandable region rows, region owners, representative-office owners, and configurable country/region members. The execution screen consumes this tree for dependent region → representative-office → country filtering.
- Reviewed the three new configuration surfaces against the selected source in `qa/responsibility-config-comparison.jpg`; no P0, P1, or P2 visual findings were introduced.

### End-to-end collection, TSMP approval, and execution matching

- Reframed demand entry around a collection-plan entity. The plan table now exposes the product/domain, release scope, regional-feedback progress, consolidated demand, BOM readiness, workflow node, deadline, and the correct next action.
- Added a product-level provisional demand row for new projects whose model/SKU or BOM is not yet available. Product configuration now requires only product name and domain; supply timing, default deadline, model, and BOM may be completed later.
- Added a dedicated 发货审批 page for TSMP-side checks. The stocking owner can query an application, compare requested quantity with the applicant region's confirmed demand balance and current inventory, copy the conclusion, and open an installation guide for the Bookmarklet.
- Reworked 执行情况 to make TSMP export/import the explicit shipment data source. The import panel displays product-model + shipping-region + representative-office matching, automatic-match coverage, mapping gaps, and unmatched records before the existing product/SKU cumulative execution table.
- The first combined visual comparison in `qa/business-flow-comparison.jpg` found no actionable P0, P1, or P2 drift: all three new screens remain within the established surface density, color, typography, and navigation system.

### Role-separated collection workbenches

- Earlier P1 workflow finding: the GTM plan list exposed “查看填报” and “模拟收齐”, then silently changed the active user to MSS领域接口人. The source also lacked a domain-level confirmation step between regional entry and GTM handoff.
- Fix: split demand collection into three permission-aware workbenches: GTM计划管理、MSS领域任务、区域/代表处填报. GTM actions are now limited to create/release/progress/feedback/export; MSS owns region progress, domain summary, and formal feedback; regional users submit only into the domain summary.
- Earlier P2 implementation finding: the first regional-entry revision added enough batch metadata to collide with the fixed product selector at the 1348px screenshot width.
- Fix: allowed batch metadata to wrap with controlled row spacing while keeping the product selector fixed; the deadline now remains visible and no content overlaps.
- Earlier P2 data-consistency finding: initial KPI and feedback totals combined unreleased plans or partial seed data, and the regional profile name differed from the configured region owner.
- Fix: pending-region KPIs now include active collection plans only; all six B19 and five B21 regional seed totals reconcile to `2,482` and `1,180` Pcs; the regional role profile matches configured owner `AAA`.
- Post-fix evidence: `qa/final-01-gtm-plan.png`, `qa/final-02-mss-tasks.png`, `qa/final-03-domain-feedback.png`, and `qa/final-04-region-entry.png`. Side-by-side comparisons in `qa/design-qa-gtm-comparison.jpg` and `qa/design-qa-entry-comparison.jpg` show the existing visual system was preserved.

## Findings

- No actionable P0, P1, or P2 differences remain.

## Follow-up polish

- [P3] The browser-native number input caret/spinner rendering is slightly different from the generated mock's static control chrome. This does not change hierarchy, density, or interaction clarity.
- [P3] The cloud browser viewport is slightly wider than the source aspect ratio, so the normalized source comparison contains narrow side padding. The responsive implementation preserves the same proportions and complete content.

## Implementation checklist

- [x] Match selected regional-entry visual direction.
- [x] Preserve Excel-style data entry and Chitu sample data.
- [x] Implement all visible core controls and validation states.
- [x] Add operational KPIs, product/SKU execution, multi-shipment tracking, inventory-demand matching, and stock variance closure.
- [x] Replace queue-style execution with product → SKU tracking.
- [x] Keep multi-shipment information at cumulative quantity and batch-count level; omit detailed shipment records.
- [x] Support organization drill-down through region, representative office, and country.
- [x] Remove execution status and operation columns.
- [x] Verify layout and interactions in the cloud browser.
- [x] Add GTM product master with one-to-many SKU/BOM configuration.
- [x] Support all-product aggregation and single-product selection across demand, overview, execution, and inventory.
- [x] Configure GTM and 领域备货接口人 by product domain and inherit them across all related products.
- [x] Configure the shared region → representative office → country/region organization tree and reuse it in execution filters.
- [x] Support GTM new-product creation before model/SKU or BOM data is available.
- [x] Add collection-plan release, regional feedback, domain handoff, and GTM production-plan export.
- [x] Separate TSMP shipment approval verification from shipment execution tracking.
- [x] Import TSMP shipment exports and match by product model + shipping region + representative office.
- [x] Separate GTM plan management, MSS domain tasks, and regional/representative-office entry into role-specific workbenches.
- [x] Add the explicit domain-summary confirmation and “提交领域汇总给GTM” handoff.
- [x] Remove “查看填报” and “模拟收齐” from the GTM plan table.
- [x] Resolve all P0/P1/P2 visual differences.

final result: passed
