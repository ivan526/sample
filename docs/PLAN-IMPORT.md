# 线下需求计划导入

GTM及管理员在“需求收集 → 计划管理 → 导入线下计划”中操作。其他角色保留原只读或任务权限，不能导入。先维护产品/SKU、MSS领域和组织主数据。

## 操作

1. 选择产品、阶段，填写线下计划编号和收集截止时间；一份文件对应一个产品/阶段/线下计划。
2. 下载模板，填写“需求明细”。参考页是当前授权产品的SKU和组织信息，不参与导入。
3. 上传Excel并“校验并预览”。校验不写入业务数据，错误显示实际Excel行号；修正或调整计划信息后重新校验。
4. 核对确认需求、历史累计申请和发货，点击“确认导入正式计划”。成功后显示“线下导入”来源标签，进入“待GTM收口”，可导出排产并继续执行跟踪。

## 模板列

| 列 | 要求 |
| --- | --- |
| MSS业务领域 | 必填；领域ID、名称或编码 |
| 产品型号 / BOM编码 | 与当前产品匹配；允许BOM空，但同组合重名时需SKU ID；无SKU产品可留空按产品级需求导入 |
| SKU ID | 优先匹配的稳定主键；型号/BOM相同的两行SKU不会合并；参考页可复制 |
| 区域 / 代表处 | 必填，ID或名称，父子路径必须正确；重名用ID |
| 国家/地区 | 可空；空代表代表处共享配额，不会按国家重复累加 |
| 需求数量 | 必填0至2147483647的整数；空白不是0；计划总需求不得超过2147483647 |
| 需求依据 | 可选；正数需求未填时标记“线下历史确认需求” |
| 计划使用时间 | 可选；YYYY-MM-DD或Excel日期，按北京时间读取 |
| 备注 | 可选，最多500字符 |
| 累计申请数量 / 累计发货数量 | 可选非负整数；两项都空为0；申请空且发货正数时按发货补足申请；明确申请小于发货时校验失败 |

同一领域/SKU/代表处不能混填共享配额与国家明细。同一维度不能重复行，需先在Excel汇总。明确填0的国家仍进入国家明细模式；该代表处未填的其他启用国家按0计入正式反馈。历史执行累计量可以超过需求，预览会提示并按实际记录。

同产品/阶段有进行中计划时不能导入覆盖；请先处理原计划。已导出、已取消或已归档的旧计划不阻止新批次。导入的是已在线下确认的计划，只为文件内领域建立正式任务，未出现的领域不代为确认。

历史申请/发货以同一计划和组织维度的累计基线入账；不伪造申请单、实际处理人或原发货时间。缺失原发货日期时发货时间显示未提供，仅入账时间记录真实导入时间；发货日期筛选不会把未知日期基线当作当天发货。发货明细中的来源为“线下计划历史基线”。相同历史发货不能再次经TSMP或发货API导入，否则属于另一入账渠道而重复累计。

## 接口

沿用Bearer登录，前缀`/api/v1`。GTM只能导入本人负责产品品类，管理员全局。请求体最大12MB，Excel文件界面限制10MB，每批最多10000行。

- `GET /collection/plan-imports/template?productId=…`：返回`fileName、contentType、fileBase64`，文件含空白需求明细、型号参考、领域参考、组织参考、填写说明。
- `POST /collection/plan-imports/preview`：校验并返回`valid、previewHash、errors、errorCount、warnings、rowCount、items、previewTruncated、totals、domainCount、regionCount、replayed、planId`。映射错误以200和`valid=false`返回；结构、权限错误用422/403。错误最多返回500项，警告200项，匹配行预览100条；确认导入整批全部行。
- `POST /collection/plan-imports`：原预览请求增加`confirmed:true、previewHash`；新导入201，幂等重试200，返回`{plan,replayed}`。

```json
{
  "productId":"实际产品ID", "stage":"V3",
  "sourceReference":"OFFLINE-WATCH-V3-202610", "deadline":"2026-10-23T10:00:00+08:00",
  "fileName":"线下需求.xlsx", "note":"线下已确认需求接入",
  "rows":[{
    "sourceRowNo":2, "productSkuId":"实际SKU ID", "productModel":"HUAWEI WATCH 5 46mm", "bomCode":"55020HKC",
    "mssDomain":"MKT领域", "region":"欧洲MKT", "office":"德国代表处", "country":"德国",
    "quantity":100, "basis":"上市展示", "plannedUseDate":"2026-11-01", "note":"",
    "appliedQuantity":20, "shippedQuantity":10
  }]
}
```

校验结果示例：

```json
{"code":"OK","message":"校验完成","data":{"valid":false,"previewHash":"64位SHA256","rowCount":1,"errorCount":1,"errors":[{"row":2,"message":"代表处不存在、已停用或层级不匹配"}],"warnings":[],"items":[],"previewTruncated":false,"totals":{"demandQuantity":0,"appliedQuantity":0,"shippedQuantity":0},"domainCount":0,"regionCount":0,"replayed":false},"requestId":"请求ID"}
```

以`productId + stage + sourceReference`去重，不依赖文件名或行顺序；同有效数据返回原计划，不重复增加申请或发货；同编号不同有效载荷409，不覆盖历史。数量、组织、产品、阶段、截止时间、说明等有效业务信息参与hash；确认时重新校验并比对预览hash，变更后需重新预览。

`CollectionPlan`新增`source=ONLINE|OFFLINE_IMPORT、importReference、importedAt`。原有计划接口及外部查询接口字段兼容；新接口完整定义见OpenAPI。

## 数据一致性

023迁移增加`collection_plan_import`来源流水。计划、流水、领域任务、SKU范围、组织快照、区域SUBMITTED及V1、正式领域反馈、确认需求/执行事实和审计同一事务提交。正式反馈使用正常收集相同的`materializeDomainFeedback`，国家补0、共享池、导出和查询不会形成两套口径。原操作人不伪造成领域/区域接口人，提交及反馈记录标记实际导入人，来源另行保存。

导入后允许原正式退回、修订V2、领域再次反馈；旧V1和反馈失效历史保留，历史执行基线不因改需求而重写。业务重置会清理导入流水和对应业务快照，保留用户及主数据。
