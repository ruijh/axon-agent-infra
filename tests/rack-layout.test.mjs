import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { device, UNITS, PITCH, DETAIL_PITCH } = require('../assets/rack-layout.js');
const data = new Function(readFileSync(new URL('../assets/data.js', import.meta.url), 'utf8') + '; return AXON_DATA;')();
const members = [...data.servers, ...data.netDevices];

test('every real device stays in its U span without overlap at both reading densities', () => {
  for (const pitch of [PITCH, DETAIL_PITCH]) for (const rack of data.racks) {
    const placed = members.filter(d => d.location.rack === rack.id)
      .map(d => ({ id: d.id, ...device(d.location.u, pitch) })).sort((a,b) => a.bottom-b.bottom);
    for (const [i,d] of placed.entries()) {
      assert.ok(d.bottom >= 0 && d.bottom + d.height <= UNITS * pitch, d.id);
      assert.ok(d.height >= (d.units === 1 ? 24 : 42), `${d.id}: readable target and lines`);
      if (i) assert.ok(placed[i-1].bottom + placed[i-1].height < d.bottom, `${d.id}: adjacent U device`);
    }
  }
});

test('U1/U42 and adjacent 1U devices preserve exact boundaries and readable single lines', () => {
  assert.deepEqual(device([1,1]), {units:1,bottom:1,height:24,label:'U1'});
  assert.equal(device([42,42]).bottom + device([42,42]).height,42*PITCH-1);
  assert.equal(device([2,2]).bottom - device([1,1]).bottom,PITCH);
  assert.equal(device([30,31]).label,'U30–31');
  for (const u of [[0,1],[1,43],[3,2],[1.5,2]]) assert.throws(()=>device(u),RangeError);
});

test('rendered 1U uses one line, 2U uses two, names are escaped and all controls expose full details', () => {
  const src = readFileSync(new URL('../assets/views.js',import.meta.url),'utf8');
  const block = src.slice(src.indexOf('function rackDevBlock'),src.indexOf('function rackPicker'));
  const esc = s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const render = new Function('AXON_RACK_LAYOUT','esc',block+'; return rackDevBlock;')({device,PITCH},esc);
  for (const ref of members) {
    const html = render({kind: data.servers.includes(ref)?'server':'net',ref});
    assert.match(html,/<button type="button"/);
    assert.ok(html.includes('aria-label="'+esc(ref.name)),ref.id);
    assert.equal(html.includes('class="rd-sub"'),ref.location.u[1]>ref.location.u[0]);
  }
  assert.ok(render({kind:'server',ref:{...data.servers[0],name:'<bad "name">'}}).includes('&lt;bad &quot;name&quot;&gt;'));
});
