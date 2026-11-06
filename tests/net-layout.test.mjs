import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import netLayout from '../assets/net-layout.js';

const data = new Function(readFileSync(new URL('../assets/data.js', import.meta.url),'utf8') + ';return AXON_DATA;')();
const rackIds = data.racks.map(r => r.id).filter(id => id !== 'R01');
const options = {servers: data.servers, netDevices: data.netDevices, rackIds};
const overlaps = (a,b) => Math.abs(a.x-b.x) < (a.w+b.w)/2 && Math.abs(a.y-b.y) < (a.h+b.h)/2;

function verifyBounds(plan) {
  for (const [id,p] of plan.positions) {
    assert.ok(p.x-p.w/2 >= 0 && p.x+p.w/2 <= plan.width, `${id}: horizontal bounds`);
    assert.ok(p.y-p.h/2 >= 0 && p.y+p.h/2 <= plan.height, `${id}: vertical bounds`);
    assert.ok(p.w >= 104 && p.h >= 48, `${id}: readable fixed node size`);
    assert.equal(netLayout.hitTest(plan.positions,p.x,p.y),id);
    for (const [other,q] of plan.positions) if (other !== id) assert.ok(!overlaps(p,q), `${id} overlaps ${other}`);
  }
}

test('full network keeps all 26 devices within readable non-overlapping bounds', () => {
  for (const width of [320,640,900,1280,1440,1920]) {
    const plan = netLayout.layout({...options,width});
    assert.equal(plan.positions.size, data.servers.length + data.netDevices.length);
    verifyBounds(plan);
  }
});

test('every focused rack fits narrow screens without overlapping device hit targets', () => {
  for (const rackId of data.racks.map(r => r.id)) for (const width of [320,375,419,420,640,1280]) {
    const plan = netLayout.layout({...options,width,rackId});
    assert.equal(plan.width,width);
    verifyBounds(plan);
    const expected = [...data.servers,...data.netDevices].filter(n => n.location.rack === rackId);
    for (const n of expected) assert.ok(plan.positions.has(n.id), `${rackId} missing ${n.id}`);
  }
});

test('server rack focus retains its ToR, redundant cores and BMC but excludes unrelated servers', () => {
  const plan = netLayout.layout({...options,width:375,rackId:'R02'});
  for (const id of ['sw-tor-kbb','sw-core-01','sw-core-02','sw-bmc']) assert.ok(plan.positions.has(id));
  assert.equal([...plan.positions.keys()].filter(id=>id.startsWith('srv-')).length,4);
  assert.ok(!plan.positions.has('srv-cpu-01'));
  assert.equal(netLayout.hitTest(plan.positions,10,10),null);
});

test('network rack focus includes both cores and all downstream ToRs', () => {
  const plan = netLayout.layout({...options,width:320,rackId:'R01'});
  assert.equal(plan.positions.size,7);
  for (const n of data.netDevices.filter(n=>n.kind==='core'||n.kind==='tor')) assert.ok(plan.positions.has(n.id));
});

test('additional rack members extend rows instead of overlapping or escaping the canvas', () => {
  const servers = [...data.servers, ...Array.from({length:7},(_,i)=>({id:`extra-${i}`,location:{rack:'R02'}}))];
  for (const rackId of [null,'R02']) {
    const plan=netLayout.layout({...options,servers,width:375,rackId});
    verifyBounds(plan);
  }
});

test('fitted labels preserve text when possible and truncate Unicode safely within measured width', () => {
  const measure = text => Array.from(text).length * 10;
  assert.equal(netLayout.fitText('R01',30,measure),'R01');
  assert.equal(netLayout.fitText('业务知识库节点',40,measure),'业务知…');
  assert.equal(netLayout.fitText('😀机柜标记',20,measure),'😀…');
  assert.equal(netLayout.fitText('label',9,measure),'');
  for (const width of [10,20,35,80,120]) assert.ok(measure(netLayout.fitText('设备名称 01 / 扩展节点',width,measure))<=width);
});
