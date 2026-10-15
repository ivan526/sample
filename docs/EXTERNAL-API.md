# 外部系统备货需求与发货接口

接口前缀：`http://<服务器地址>:<对外端口>/api/v1`。经Vite代理时可使用现有前端端口；直接访问API时使用部署的后端端口。

## 身份与权限

调用既有`POST /auth/login`，传入`employeeNo`、`password`，取响应`data.token`。后续携带`Authorization: Bearer <token>`。Token有效期沿用系统配置（当前2小时），过期重新登录。请使用具备授权产品品类的备货接口人账号；管理员也可调用。跨品类、停用账号及其他角色会被拒绝。浏览器跨域调用时，服务器`CORS_ORIGINS`还需包含调用页面来源；服务器间调用不受浏览器CORS限制。

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
    "filters": {"mssDomain":"MKT领域","region":"欧洲MKT","office":null,"country":null},
    "demandQuantity": 100,
    "appliedQuantity": 40,
    "stockedQuantity": 80,
    "shippedQuantity": 30,
    "remainingToApply": 60,
    "officeUnallocatedDemandQuantity": 0,
    "officeUnallocatedAppliedQuantity": 0
  }
}
```

- `demandQuantity`：申请需求数量，来源为正式领域反馈确认的需求；草稿不计入。
- `shippedQuantity`：累计发货数量，包括既有TSMP导入和新增API入账。
- `remainingToApply`：`max(0, demandQuantity - appliedQuantity)`，按总量先汇总再扣减；发货更新不修改已申请数。
- 当前需求填报主要到代表处。指定国家时，不把代表处未分配需求复制给各国家；这部分单独列在`officeUnallocatedDemandQuantity`及`officeUnallocatedAppliedQuantity`。因此国家主指标可能为0，但代表处汇总不为0。需要国家额度时，应先提供国家级正式需求数据。

## 2. 新增排产备货与发货数量

`POST /integrations/shipments`

六个产品/组织维度均必填，名称必须定位到唯一完整组织路径；重名时使用ID。须存在对应领域、代表处和型号的正式确认需求，国家可关联该代表处未分配到国家的正式需求。

额外参数：

| 参数 | 必填 | 含义 |
| --- | --- | --- |
| stockedQuantity | 是 | 本次新增排产备货数量；非负整数 |
| shippedQuantity | 是 | 本次新增发货数量；非负整数 |
| Idempotency-Key请求头 | 是 | 同一调用账号下唯一业务流水号，最长128字符 |

两项数量不能同时为0，每项不超过2147483647。仅更新排产备货及发货执行事实，不覆盖需求、申请或历史快照；不自动调整库存。真实发货超计划时按实际数记录，不静默截断。

```bash
curl "$BASE_URL/integrations/shipments" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: external-delivery-20261015-0001' \
  -d '{"productModel":"HUAWEI WATCH 5 46mm","bomCode":"55020HKC","mssDomain":"MKT领域","region":"欧洲MKT","office":"德国代表处","country":"德国","stockedQuantity":50,"shippedQuantity":20}'
```

```json
{"code":"OK","message":"更新成功","data":{"success":true,"deliveryId":"流水ID","stockedQuantityAdded":50,"shippedQuantityAdded":20,"replayed":false}}
```

相同账号和业务流水号重试相同数据，返回相同`deliveryId`且`replayed=true`，不再次累加；同流水号传不同数量或维度返回409。每一笔新业务必须使用新流水号。流水、两类执行事实与审计记录在同一事务提交，失败全部回滚。网络超时应保留原流水号重试，不能直接生成新流水号。

同一真实发货请选择API或TSMP文件一种入账渠道。本接口的业务流水去重不会自动识别TSMP文件中无共同业务标识的同一笔发货，双渠道同步可能重复累计。

## 错误与部署

通用响应保留`code`、`message`、`requestId`；数量或字段错误可能包含`details`。401为身份失败，403为范围/角色无权限，409为流水冲突，422为参数或业务校验错误。调用方应检查HTTP状态及`data.success`。

更新代码后执行前后端构建；后端启动自动执行017、018迁移。017新增接口流水表；018调整型号唯一约束且保留SKU ID及历史引用。如旧数据含跨产品的相同启用“型号+BOM”组合，唯一索引会阻止迁移；需先核对并处理重复主数据，不会自动删除历史记录。
