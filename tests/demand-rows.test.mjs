import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveEntryRows } from '../src/utils/demandRows.js';

test('entry totals share office quota, switch each SKU to country detail and restore after clearing', () => {
  const rows = [
    { id:'sku-a',officeId:'office',qty:100 },
    { id:'sku-a',officeId:'office',countryId:'one',qty:'' },
    { id:'sku-a',officeId:'office',countryId:'two',qty:'' },
    { id:'sku-b',officeId:'office',qty:60 },
    { id:'sku-a',officeId:'other-office',qty:40 },
  ];
  const total=()=>effectiveEntryRows(rows).reduce((sum,row)=>sum+Number(row.qty),0);
  assert.equal(total(),200);
  rows[1].qty=0; assert.equal(total(),100);
  rows[1].qty=20; rows[2].qty=10; assert.equal(total(),130);
  rows[1].qty=''; rows[2].qty=''; assert.equal(total(),200);
  assert.equal(rows[0].qty,100,'office original remains intact');
});
