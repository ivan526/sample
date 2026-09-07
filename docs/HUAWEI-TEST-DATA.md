# 华为核心场景测试数据说明

这套数据用于本地开发、产品演示和业务验收。全新开发库会自动初始化；已有开发库执行`npm run data:load:huawei`即可增量补齐。命令可重复执行，只更新固定测试记录，不删除自行录入的数据。

## 1. 测试账号

除管理员外，默认密码均为`123456`。

| 角色 | 账号 | 姓名 | 数据范围 | 建议验证 |
| --- | --- | --- | --- | --- |
| 管理员 | admin / Admin@123 | 系统管理员 | 全量 | 配置、跨领域数据、全部菜单 |
| GTM | wanglu | 王璐 | 穿戴 | WATCH、FreeBuds计划及排产导出 |
| GTM | lina | 李娜 | 手机 | Pura、Mate计划全生命周期 |
| GTM | zhouhang | 周航 | 平板 | MatePad计划创建和下发 |
| MSS领域接口人 | zhaomin | 赵敏 | MKT领域 | 区域收集、退回、变更审批、反馈GTM |
| MSS领域接口人 | sunyue | 孙悦 | 零售领域 | 零售领域下发与反馈 |
| MSS领域接口人 | liuqian | 刘倩 | 服务领域 | 服务领域任务隔离 |
| MSS领域接口人 | chenxi | 陈曦 | GTM领域 | GTM业务领域任务隔离 |
| 区域接口人 | aaa | AAA | 欧洲MKT | 区域填报、提交后撤回/申请变更 |
| 区域接口人 | bbb | BBB | 欧亚MKT | 草稿与已提交任务 |
| 区域接口人 | ccc | CCC | 亚太MKT | 已提交需求查看 |
| 区域接口人 | ddd | DDD | 拉美MKT | MSS退回后修改 |
| 区域接口人 | eee | EEE | 中东非MKT | 多领域任务 |
| 区域接口人 | fff | FFF | 中国区MKT | 中国区需求填报 |
| 代表处接口人 | deowner | 吴凯 | 德国代表处 | 仅编辑本代表处数据、不能提交整区域 |
| 代表处接口人 | broffice | 宋扬 | 巴西代表处 | 代表处级数据隔离 |
| 代表处接口人 | cnoffice | 郭宁 | 中国区代表处 | 零售领域+代表处双重范围 |
| 备货接口人 | chentao | 陈涛 | 手机、平板、穿戴 | 发货审批、TSMP导入、执行和库存核对 |

## 2. 产品数据

| 产品 | 品类 | 型号/BOM特征 | 覆盖场景 |
| --- | --- | --- | --- |
| HUAWEI WATCH 5系列 | 穿戴 | 4个型号，BOM完整 | 完整领域反馈、执行和库存基线 |
| HUAWEI WATCH FIT 4 Pro系列 | 穿戴 | 3个型号，BOM完整 | 区域收集中、提交后撤回与重提 |
| HUAWEI MatePad Pro 13.2系列 | 平板 | 2个型号，BOM完整 | 待GTM下发 |
| HUAWEI Pura新品项目（BOM待补充） | 手机 | 暂无型号和BOM | 新品项目早期建档 |
| HUAWEI Pura 80 Ultra系列 | 手机 | 2个型号，BOM完整 | 全部区域提交、待领域反馈 |
| HUAWEI Mate 70 Pro系列 | 手机 | 2个型号，BOM完整 | 已导出、分批发货、库存差异 |
| HUAWEI MatePad 12 X系列 | 平板 | 2个型号，其中1个BOM待补 | 多领域并行收集与异常状态 |
| HUAWEI FreeBuds Pro 4系列 | 穿戴 | 2个型号，BOM完整 | 已导出后申请变更待审批 |

## 3. 计划场景矩阵

| 计划编号 | 产品 | 当前状态 | 登录角色与核心操作 |
| --- | --- | --- | --- |
| HUAWEI-TEST-001 | HUAWEI Pura新品项目 | 产品建档 | lina补充型号/BOM后再建收集计划 |
| HUAWEI-TEST-002 | HUAWEI MatePad Pro 13.2 | 待下发 | zhouhang将计划下发给全部启用MSS领域 |
| HUAWEI-TEST-003 | HUAWEI MatePad 12 X | 收集中 | zhaomin查看未开始、草稿、已提交、退回修改；sunyue查看待下发领域任务 |
| HUAWEI-TEST-004 | HUAWEI Pura 80 Ultra | 待领域反馈 | 四个领域接口人分别确认并反馈GTM |
| PLAN-2608-01 | HUAWEI WATCH 5 | 待GTM收口 | wanglu导出V1排产文件；验证执行基线 |
| HUAWEI-TEST-005 | HUAWEI Mate 70 Pro | 已导出 | lina查看历史导出；chentao查看分批执行与库存 |
| HUAWEI-TEST-006 | HUAWEI FreeBuds Pro 4 | 已导出/变更审批中 | aaa查看只读申请；zhaomin通过或驳回导出后变更 |
| PLAN-2608-02 | HUAWEI WATCH FIT 4 Pro | 收集中 | aaa填报欧洲需求，提交后在截止前自主撤回修改 |

`HUAWEI-TEST-003`的MKT领域区域状态进一步拆分为：欧洲未开始、欧亚草稿、亚太已提交、拉美被MSS退回。它用于一次验证列表状态、进度统计、区域代录和退回修改。

## 4. TSMP导入诊断数据

导入任务文件名为`TSMP_华为样机发货_核心场景.xlsx`，明细预置5行：

| Excel行 | 结果 | 预置原因 |
| --- | --- | --- |
| 第2行 | 匹配成功 | BOM、MSS领域、区域、代表处、国家均可识别 |
| 第3行 | 待维护映射 | “法国REP”未维护代表处别名 |
| 第4行 | 未匹配 | BOM编码`99999ZZZ`不存在 |
| 第5行 | 重复 | 外部业务键与第2行重复 |
| 第6行 | 无效 | 发货数量读取为0，详细提示包含原值 |

## 5. 库存与执行数据

- HUAWEI Mate 70 Pro黑色：账实一致，同时存在两次发货。
- HUAWEI Mate 70 Pro绿色：盘亏8台，同时存在三次发货。
- HUAWEI Pura 80 Ultra黑色：盘盈6台。
- HUAWEI MatePad 12 X绿色：账实一致但核对原因留空，用于补充说明。
- 执行事实覆盖确认需求、排产、实际申请、实际发货和当前库存五种口径。

## 6. 自动校验

执行`npm run test:seed`会在临时SQLite数据库中完成以下检查：

- 8个启用产品全部为HUAWEI品牌；
- 六种计划状态和四种区域提交状态齐全；
- 四个有效MSS领域均有独立任务；
- 导出后变更申请及版本快照存在；
- 执行、库存、TSMP五类诊断数据完整；
- GTM、领域接口人、代表处接口人的数据权限可正常登录验证。

