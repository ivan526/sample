# 高保真—PRD—接口追踪矩阵

| 需求ID | 高保真页面/组件 | 主要代码 | 接口 | 核心验收 |
| --- | --- | --- | --- | --- |
| FW-01 | 顶栏、220px侧栏、八项导航 | `src/App.jsx`、`src/styles.css` | `GET /meta` | 1363px无页面横向溢出；导航顺序一致 |
| FW-02 | 统一KPI条、表格、Toast、弹窗 | `src/OperationalPages.jsx`、`src/BusinessFlowPages.jsx` | 通用响应 | loading/empty/error/成功反馈完整 |
| OV-01 | `qa/overview-final.jpg` KPI条 | `OverviewPage` | `GET /overview` | 五项KPI与筛选同步 |
| OV-02 | 新品备货全流程 | `OverviewPage` | `GET /overview` | 固定五节点，数据来自同一读模型 |
| OV-03 | 产品/SKU执行、库存匹配、需关注 | `OverviewPage` | `GET /overview` | 全产品看产品，单产品看SKU |
| DC-01 | `qa/final-01-gtm-plan.png` | `CollectionPlanPage` | `GET/POST /collection/plans` | GTM只管理创建、下发、进度、反馈、导出 |
| DC-02 | 新建计划弹窗 | `CollectionPlanPage` | `POST /collection/plans` | 无BOM产品可建计划 |
| DC-03 | `qa/final-02-mss-tasks.png` | `DomainTaskPage` | `GET /collection/plans` | 无“新建计划”；只看本领域 |
| DC-04 | 区域进度/领域汇总/反馈页签 | `CollectionTaskDetailPage` | `GET /collection/plans/{id}` | GTM只读，MSS可代录与反馈 |
| DC-05 | `qa/final-03-domain-feedback.png` | `CollectionTaskDetailPage` | `POST /collection/plans/{id}/domain-feedback` | 全区域提交+确认后才可反馈 |
| DC-06 | 区域任务列表 | `RegionalTaskPage` | `GET /collection/plans` | 仅展示授权区域任务 |
| DC-07 | `qa/final-04-region-entry.png` | `App.jsx` entry view | `PUT .../draft`、`POST .../submit` | Excel粘贴、草稿、校验、提交均可用 |
| EX-01 | TSMP导入匹配面板 | `TsmpImportPanel` | `POST /execution/imports` | 显示总数、匹配、映射、未匹配 |
| EX-02 | 发货审批实时核对 | `ShipmentApprovalPage` | `POST /shipment-approval/check` | SKU+区域+代表处需求余额及库存结论 |
| SEC-01 | 角色数据范围隔离 | 全局范围提示、只读快照 | 所有领域接口 | GTM/MSS/区域/代表处/备货跨范围返回403 |
| CFG-03 | 稳定主数据编辑 | 产品与组织配置 | `PUT /config/products/{id}`、`PUT /config/organizations/{id}` | 被引用SKU/组织不删除，移除时停用 |
| EX-02 | 组织范围级联筛选 | `ExecutionPage` | `GET /execution` | 区域→代表处→国家同步KPI和表格 |
| EX-03 | 产品→SKU执行表 | `ExecutionPage`、`MemoRows` | `GET /execution` | 九列固定；无状态/操作/零散发货卡 |
| CFG-01 | 产品配置页签 | `ConfigurationPage` | `/config/products` | 产品仅需名称+领域；SKU/BOM可后补 |
| CFG-02 | 领域与责任人页签 | `ConfigurationPage` | `/config/domains` | 产品自动继承GTM和备货接口人 |
| CFG-03 | 区域与代表处页签 | `ConfigurationPage`、`OrganizationRows` | `/config/organizations` | 区域→代表处→国家统一组织树 |

## 实现守门规则

1. 修改任一页面前，先定位本表对应高保真、PRD章节和接口。
2. 只替换数据来源时，保留现有组件层级和CSS类名。
3. 每个需求ID至少有一个自动化测试或明确的E2E步骤。
4. 新增字段必须先更新PRD、OpenAPI、DDL和本矩阵，再改UI。
