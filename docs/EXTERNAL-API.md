# 外部系统备货需求与发货接口

接口前缀：`http://<服务器地址>:<对外端口>/api/v1`。经Vite代理时可使用现有前端端口；直接访问API时使用部署的后端端口。

## 身份与权限

调用既有`POST /auth/login`，传入`employeeNo`、`password`，取响应`data.token`。后续携带`Authorization: Bearer <token>`。Token有效期沿用系统配置（当前2小时），过期重新登录。请使用具备授权产品品类的备货接口人账号；管理员也可调用。写入接口拒绝跨品类、停用账号及其他角色。发货记录查询另允许GTM，权限见第3节。浏览器跨域调用时，服务器`CORS_ORIGINS`还需包含调用页面来源；服务器间调用不受浏览器CORS限制。

## 1. 查询需求

`GET /integrations/stocking-demands`

| 参数 | 必填 | 含义 |
| --- | --- | --- |
| productModel | 是 | 产品型号，与BOM编码同时精确匹配同一启用SKU |
| bomCode | 是 | 产品BOM编码 |
| mssDomain | 否 | MSS业务领域，支持ID、编码、名称及“GTM样机”等明确后缀 |
| region | 否 | 区域ID或名称 |
| office | 否 | 代表处ID或名称 |
| country | 否 | 国家ID或名称 |
| stage | 否 | 样机阶段；空或不传取最新正式计划，传入取该阶段最新正式计划 |

省略或传空字符串的维度取全部；已填写的条件同时生效。例如仅填产品型号+BOM取所有领域、区域、代表处和国家；填到区域则合计该区域全部代表处；填到代表处则合计该代表处所有国家以及尚未分配到国家的记录。上级可省略；同名的下级节点会在所有符合上级条件的组织中汇总，不会随机选一个。拼错名称、停用主数据、父子关系不一致返回422，不会回退为全量查询。

```bash
curl --get "$BASE_URL/integrations/stocking-demands" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'productModel=HUAWEI WATCH 5 46mm' \
  --data-urlencode 'bomCode=55020HKC' \
  --data-urlencode 'mssDomain=MKT领域' \
  --data-urlencode 'region=欧洲MKT'
```

```json
{
  "code": "OK",
  "message": "查询成功",
  "data": {
    "productModel": "HUAWEI WATCH 5 46mm",
    "bomCode": "55020HKC",
    "filters": {"mssDomain":"MKT领域","region":"欧洲MKT","office":null,"country":null,"stage":null},
    "planId": "计划ID",
    "planNo": "PLAN-202610-0001",
    "stage": "V3",
    "quotaMode": "AGGREGATE",
    "demandQuantity": 100,
    "appliedQuantity": 40,
    "shippedQuantity": 30,
    "remainingToApply": 60,
    "officeUnallocatedDemandQuantity": 0,
    "officeUnallocatedAppliedQuantity": 0
  }
}
```

- `demandQuantity`：申请需求数量，来源为正式领域反馈确认的需求；草稿不计入。
- `shippedQuantity`：累计发货数量，包括既有TSMP导入和新增API入账。
- `remainingToApply`：`max(0, demandQuantity - appliedQuantity)`，按总量先汇总再扣减；发货API同步增加等量累计申请，余额随之减少（最低0）。
- 只有代表处填报时，其已下发国家复用同一共享配额（`quotaMode=OFFICE_SHARED`）；国家查询返回整个共享池，不能把多个国家结果相加。同一计划/领域/SKU/代表处出现国家填报（含明确的0）后，改按国家明细，未填国家为0。`officeUnallocatedDemandQuantity`及`officeUnallocatedAppliedQuantity`是已计入主指标的共享量说明。

## 2. 新增发货数量

`POST /integrations/shipments`

六个产品/组织维度均必填，名称必须定位到唯一完整组织路径；重名时使用ID。须存在对应领域、代表处和型号的正式确认需求，国家可关联该代表处未分配到国家的正式需求。

额外参数：

| 参数 | 必填 | 含义 |
| --- | --- | --- |
| shippedQuantity | 是 | 本次新增发货数量；1至2147483647的正整数 |
| stage | 否 | 样机阶段；不传绑定最新正式计划，传入绑定该阶段最新正式计划 |
| Idempotency-Key请求头 | 是 | 同一调用账号下唯一业务流水号，最长128字符 |
| applicationNo / shipmentNo | 否 | 申请单号 / 发货单号，各最长256字符 |
| applicantName / applicantEmployeeNo | 否 | 申请人姓名 / 工号，与实际处理人独立，各最长256字符 |
| handlerEmployeeNo | 否 | 实际处理人工号；不传默认调用账号。备货接口人只能指定本人；管理员可指定该产品获授权且启用的备货接口人 |
| shippedAt | 否 | 实际发货时间，ISO 8601且必须带时区，例如2026-10-15T15:42:10+08:00；不传为接收时间 |
| sourceSystem | 否 | 来源系统名，最长256字符；不传INTEGRATION_API |
| note | 否 | 发货备注，最长2000字符 |

每次调用同时新增等量申请和发货执行事实，不覆盖需求或历史快照；不自动调整库存。真实发货超计划时按实际数记录，不静默截断。

```bash
curl "$BASE_URL/integrations/shipments" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: external-delivery-20261015-0001' \
  -d '{"productModel":"HUAWEI WATCH 5 46mm","bomCode":"55020HKC","mssDomain":"MKT领域","region":"欧洲MKT","office":"德国代表处","country":"德国","shippedQuantity":20}'
```

```json
{"code":"OK","message":"更新成功","data":{"success":true,"deliveryId":"流水ID","shippedQuantityAdded":20,"replayed":false}}
```

相同账号和业务流水号重试相同数据，返回相同`deliveryId`且`replayed=true`，不再次累加；同流水号传不同数量、维度或上述业务元数据返回409（空白可选文本按未填处理）。每一笔新业务必须使用新流水号。流水、申请及发货两条执行事实、发货业务快照、审计与成功调用日志在同一事务提交，失败全部回滚。失败调用另记零影响日志。网络超时应保留原流水号重试，不能直接生成新流水号。

同一真实发货请选择API或TSMP文件一种入账渠道。本接口的业务流水去重不会自动识别TSMP文件中无共同业务标识的同一笔发货，双渠道同步可能重复累计。

## 错误与部署

通用响应保留`code`、`message`、`requestId`；数量或字段错误可能包含`details`。401为身份失败，403为范围/角色无权限，409为流水冲突，422为参数或业务校验错误。调用方应检查HTTP状态及`data.success`。

更新代码后执行前后端构建；后端启动自动执行后续迁移。017新增接口流水表；018移除旧型号唯一约束并保留SKU ID；020移除已部署版本的型号+BOM唯一索引。产品型号/BOM由人工保证不重复。外部查询和发货写入仍需定位唯一SKU；如果人工录入了完全相同的型号+BOM，请先核对主数据，接口不会随机选择一条。

`stockedQuantity`已从请求中移除，携带该字段将返回422；响应也不再包含`stockedQuantityAdded`及备货统计。已成功的历史流水用相同组织、阶段和发货数重试仍返回原流水，不重复发货。仅含旧备货增量而发货为0的记录不应作为新发货请求重试。

例如传`shippedQuantity=20`，所选计划/领域/区域/代表处/国家的累计申请和累计发货各增加20；同一流水重试两项均不再增加。升级前已成功的流水只返回原结果，不因重试补写申请；此规则从新流水开始生效。

## 3. 发货详单、汇总、接口日志与导出

发货审批页移除审批核对，暂不开放逐笔详情入口。沿用原POST接口；以下为新增只读接口，均需Bearer token。

| 接口 | 返回data |
| --- | --- |
| GET /integrations/shipments | items有效发货记录、total、page、pageSize、totals |
| GET /integrations/shipments/summary | items分组汇总（九维任选）、分页、totals |
| GET /integrations/shipments/logs | items接口尝试（SUCCESS/REPLAY/FAILURE）、分页、totals有效发货统计 |
| GET /integrations/shipments/options | productId、handlerId、mssDomainId、regionId、officeId、countryId、stage、sourceSystem选项数组 |
| GET /integrations/shipments/export | fileName、content（带BOM的UTF-8 CSV）、rowCount；完整筛选结果，不受分页影响 |

权限统一由服务器执行：备货接口人只看实际处理人为本人的记录；GTM看当前负责产品品类的全部处理人记录；管理员看全部。筛选条件不能扩大范围。GTM没有写入权限。申请人、实际处理人和调用账号分别记录；产品或接口人改派不会把旧发货重新分配给新接口人。新记录保留当时姓名、型号及组织名称。历史记录按已有API流水账号或TSMP导入账号识别处理人；无法识别时显示未记录，仅产品获授权GTM和管理员可见，不推断现任处理人。

通用查询参数（均可选；ID、阶段、来源、申请单号的空文本等于不传）：

| 参数 | 含义 |
| --- | --- |
| productId / skuId | 稳定产品ID / SKU ID；同型号及BOM的不同SKU不合并 |
| handlerId | 实际处理人用户ID，不是申请人工号 |
| mssDomainId / regionId / officeId / countryId | 精确维度ID，同时生效，支持级联筛选 |
| stage / sourceSystem / applicationNo | 精确阶段、来源、申请单号 |
| from / to | YYYY-MM-DD，含边界的北京时间业务日期；默认不限制时间；日志按发货日期，无有效发货时间时按接收日期 |
| keyword | 申请单、发货单、申请人及工号、处理人及工号、产品、型号、BOM、流水号、请求ID，大小写不敏感包含搜索，最长256字符 |
| page / pageSize | 从1开始；默认1 / 20，pageSize最大100；超出最后一页返回空items及真实total |
| groupBy | region（默认）、office、country、sku、domain、stage、handler、product、application |
| groupValue | 使用汇总返回的value精确下钻，必须同时传原groupBy；__UNKNOWN__代表未记录维度 |
| outcome | 仅日志生效：SUCCESS、REPLAY、FAILURE |
| tab | 仅导出决定内容：details（默认）、summary、logs |

总计totals含shippedQuantity、recordCount、applicationCount、countryCount，始终基于完整当前筛选的有效发货，不是当前页。申请单按来源系统+申请单号去重，未记录单号不计；国家数排除未记录国家。summary的items含groupBy、value（稳定分组键）、label、description、shippedQuantity、recordCount、applicationCount、countryCount、latestShippedAt。新API成功及TSMP成功匹配行计入；失败、重试、重复导入及未匹配行不计。

扩展请求示例（原最小请求继续有效）：

```json
{
  "productModel":"HUAWEI WATCH 5 46mm", "bomCode":"55020HKC",
  "mssDomain":"MKT领域", "region":"欧洲MKT", "office":"德国代表处", "country":"德国",
  "shippedQuantity":20, "applicationNo":"TSMP-20261015-0026",
  "applicantName":"张明", "applicantEmployeeNo":"100026",
  "shipmentNo":"FH-20261015-0106", "shippedAt":"2026-10-15T15:42:10+08:00",
  "sourceSystem":"TSMP", "note":"上市门店展示"
}
```

详单返回示例（字段为示例ID，GET路径下过滤参数使用实际返回的稳定ID）：

```json
{"code":"OK","message":"查询成功","data":{"items":[{"id":"fact-id","deliveryId":"delivery-id","productId":"product-id","skuId":"sku-id","productName":"HUAWEI WATCH 5","productModel":"HUAWEI WATCH 5 46mm","bomCode":"55020HKC","applicationNo":"TSMP-20261015-0026","applicantName":"张明","applicantEmployeeNo":"100026","handlerId":"handler-user-id","handlerName":"陈涛","handlerEmployeeNo":"chentao","callerId":"caller-user-id","shipmentNo":"FH-20261015-0106","shippedAt":"2026-10-15T07:42:10.000Z","sourceSystem":"TSMP","shippedQuantity":20,"planId":"plan-id","planNo":"PLAN-202610-0001","stage":"V3","mssDomainId":"mss-id","mssDomainName":"MKT领域","regionId":"region-id","regionName":"欧洲MKT","officeId":"office-id","officeName":"德国代表处","countryId":"country-id","countryName":"德国","idempotencyKey":"external-delivery-20261015-0001","note":"上市门店展示"}],"total":1,"page":1,"pageSize":20,"totals":{"shippedQuantity":20,"recordCount":1,"applicationCount":1,"countryCount":1}},"requestId":"request-id"}
```

日志字段包括id、requestId、callerId、handlerId、productId、deliveryId（未成功时为空）、receivedAt、outcome、quantityAdded、code、message及安全业务快照。SUCCESS的quantityAdded为申请与发货各增加的数量；REPLAY/FAILURE均为0。日志不保存Token或任意原始请求体。字段或幂等键校验失败也记日志；未登录或无写入角色的请求在认证/鉴权阶段拒绝。

所有响应时间采用带时区的ISO 8601，页面转换为北京时间。导出在JSON的content字段中返回CSV，使用同一套权限、筛选和统计规则，文本单元格已防护公式注入。022迁移新增shipment_record和integration_shipment_call；历史事实通过兼容读取保留，不改写历史累计量。历史调用没有事后补造接口尝试日志。旧/shipment-approval/check只保留兼容能力，页面不再使用。
