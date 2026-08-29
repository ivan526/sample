import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server/app.mjs";
import { PLAN_STATUS, ROLES } from "../shared/domain.mjs";

function makeClient(app) {
  return async function call(path, { method = "GET", role = ROLES.GTM, regionId, body } = {}) {
    const result = await app.handle(new Request(`http://local.test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-role": role,
        "x-user-id": "test-user",
        ...(regionId ? { "x-region-id": regionId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return { status: result.status, payload: await result.json() };
  };
}

test("health endpoint is available", async () => {
  const call = makeClient(createApp());
  const result = await call("/healthz");
  assert.equal(result.status, 200);
  assert.equal(result.payload.data.status, "ok");
});

test("GTM can create a product without SKU or BOM and owners are inherited", async () => {
  const app = createApp();
  const call = makeClient(app);
  const created = await call("/api/v1/config/products", {
    method: "POST",
    role: ROLES.GTM,
    body: { name: "Nova手机新品", domainId: "mobile", skus: [] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.data.skus.length, 0);
  assert.equal(created.payload.data.gtm, "李娜");
  assert.equal(created.payload.data.stockingOwner, "陈涛");
});

test("collection plan follows GTM to region to domain handoff", async () => {
  const app = createApp();
  const call = makeClient(app);
  const created = await call("/api/v1/collection/plans", {
    method: "POST",
    role: ROLES.GTM,
    body: { productId: "chitu-b21", regionIds: ["europe"], deadline: "2026-10-01T18:00:00+08:00" },
  });
  assert.equal(created.status, 201);
  const planId = created.payload.data.id;

  const released = await call(`/api/v1/collection/plans/${planId}/release`, { method: "POST", role: ROLES.GTM, body: { version: 1 } });
  assert.equal(released.payload.data.status, PLAN_STATUS.COLLECTING);

  const saved = await call(`/api/v1/collection/plans/${planId}/regions/europe/draft`, {
    method: "PUT",
    role: ROLES.REGIONAL_OWNER,
    body: { items: [{ productItemKey: "b21f", quantity: 20, basis: "重点客户PoC" }] },
  });
  assert.equal(saved.status, 200);

  const submitted = await call(`/api/v1/collection/plans/${planId}/regions/europe/submit`, {
    method: "POST",
    role: ROLES.REGIONAL_OWNER,
    body: { version: saved.payload.data.version },
  });
  assert.equal(submitted.payload.data.status, PLAN_STATUS.DOMAIN_REVIEW);
  assert.deepEqual(submitted.payload.data.submittedRegionIds, ["europe"]);

  const feedback = await call(`/api/v1/collection/plans/${planId}/domain-feedback`, {
    method: "POST",
    role: ROLES.MSS_DOMAIN_OWNER,
    body: { version: submitted.payload.data.version, confirmed: true, note: "区域数据已核对，可反馈GTM。" },
  });
  assert.equal(feedback.status, 200);
  assert.equal(feedback.payload.data.status, PLAN_STATUS.GTM_CLOSURE);
  assert.equal(feedback.payload.data.confirmedDemandTotal, 20);

  const exported = await call(`/api/v1/collection/plans/${planId}/export`, { method: "POST", role: ROLES.GTM, body: {} });
  assert.equal(exported.status, 200);
  assert.match(exported.payload.data.fileName, /排产需求\.xlsx$/);
});

test("roles cannot cross collection responsibilities", async () => {
  const call = makeClient(createApp());
  const createdByRegion = await call("/api/v1/collection/plans", {
    method: "POST",
    role: ROLES.REGIONAL_OWNER,
    body: { productId: "chitu-b19", regionIds: ["europe"], deadline: "2026-10-01T18:00:00+08:00" },
  });
  assert.equal(createdByRegion.status, 403);
  assert.equal(createdByRegion.payload.code, "FORBIDDEN");

  const feedbackByGtm = await call("/api/v1/collection/plans/PLAN-2608-01/domain-feedback", {
    method: "POST",
    role: ROLES.GTM,
    body: { confirmed: true, note: "错误角色" },
  });
  assert.equal(feedbackByGtm.status, 403);
});

test("demand validation requires a basis when quantity is positive", async () => {
  const call = makeClient(createApp());
  const result = await call("/api/v1/collection/plans/PLAN-2608-02/regions/europe/draft", {
    method: "PUT",
    role: ROLES.REGIONAL_OWNER,
    body: { items: [{ productItemKey: "b21f", quantity: 10, basis: "" }] },
  });
  assert.equal(result.status, 422);
  assert.equal(result.payload.code, "VALIDATION_ERROR");
});

test("execution aggregates by product and narrows with organization filters", async () => {
  const call = makeClient(createApp());
  const global = await call("/api/v1/execution?productId=chitu-b19", { role: ROLES.STOCKING_OWNER });
  const europe = await call("/api/v1/execution?productId=chitu-b19&regionId=europe", { role: ROLES.STOCKING_OWNER });
  assert.equal(global.status, 200);
  assert.equal(global.payload.data.products.length, 1);
  assert.equal(global.payload.data.products[0].skus.length, 4);
  assert.equal(global.payload.data.metrics.demand, 2482);
  assert.ok(europe.payload.data.metrics.demand < global.payload.data.metrics.demand);
  assert.equal(europe.payload.data.scopeLabel, "欧洲MKT");
});

test("TSMP import reports duplicate, mapping and unmatched rows without double counting", async () => {
  const call = makeClient(createApp());
  const row = { externalKey: "SHIP-001", sku: "Chitu-B19F", region: "欧洲MKT", office: "德国代表处", shippedQty: 5 };
  const result = await call("/api/v1/execution/imports", {
    method: "POST",
    role: ROLES.STOCKING_OWNER,
    body: { fileName: "tsmp-test.xlsx", rows: [row, row, { externalKey: "SHIP-002", sku: "Unknown", region: "未知区域", office: "未知代表处", shippedQty: 1 }] },
  });
  assert.equal(result.status, 202);
  assert.equal(result.payload.data.matchedRows, 1);
  assert.equal(result.payload.data.duplicateRows, 1);
  assert.equal(result.payload.data.unmatchedRows, 1);
});

test("changing domain owners propagates to products without duplicating owner fields", async () => {
  const app = createApp();
  const call = makeClient(app);
  const updated = await call("/api/v1/config/domains/wearables", {
    method: "PUT",
    role: ROLES.GTM,
    body: { version: 1, gtmOwner: "王璐A", stockingOwner: "赵敏B" },
  });
  assert.equal(updated.status, 200);
  const catalog = await call("/api/v1/config/catalog");
  const product = catalog.payload.data.products.find((item) => item.id === "chitu-b19");
  assert.equal(product.gtm, "王璐A");
  assert.equal(product.stockingOwner, "赵敏B");
  assert.equal("gtm" in app.store.products.find((item) => item.id === "chitu-b19"), false);
});
