import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Matrix4, Vector3, Quaternion, Box3 } from "../assets/vendor/three.core.js";
import { showDetail, rackView, pickHit } from "../assets/dc3d-policy.js";

const bytes = readFileSync(new URL("../assets/models/dc-a2.glb", import.meta.url));
assert.equal(bytes.toString("ascii", 0, 4), "glTF");
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const layout = JSON.parse(readFileSync(new URL("../tools/dc-layout.json", import.meta.url)));
const dataSource = readFileSync(new URL("../assets/data.js", import.meta.url), "utf8");
const data = new Function(dataSource + "; return AXON_DATA;")();
const parents = new Map();
gltf.nodes.forEach((n, i) => n.children?.forEach(c => parents.set(c, i)));
const world = i => {
  const n = gltf.nodes[i];
  const matrix = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(
    new Vector3(...(n.translation || [0, 0, 0])), new Quaternion(...(n.rotation || [0, 0, 0, 1])), new Vector3(...(n.scale || [1, 1, 1])));
  return parents.has(i) ? world(parents.get(i)).multiply(matrix) : matrix;
};
const index = name => gltf.nodes.findIndex(n => n.name === name);
function bounds(i) {
  const box = new Box3();
  for (const primitive of gltf.meshes[gltf.nodes[i].mesh].primitives) {
    const a = gltf.accessors[primitive.attributes.POSITION];
    box.union(new Box3(new Vector3(...a.min), new Vector3(...a.max)).applyMatrix4(world(i)));
  }
  return box;
}
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 0.001, `${message}: ${a} vs ${b}`);

test("exported racks follow the shared layout and leave a usable cold aisle", () => {
  const floor = data.dcFloor;
  assert.deepEqual(layout.rowY, floor.rowY);
  assert.deepEqual(layout.rackX, floor.rows[0].racks.map((_, i) => floor.rackX(i)));
  assert.ok(floor.rowY.B - floor.rowY.A - floor.rackSize.d >= 1.2);
  assert.ok(floor.rackX(1) - floor.rackX(0) >= floor.rackSize.w);
  for (const row of floor.rows) for (const [i, id] of row.racks.entries()) {
    const ni = index("RACK_" + id); assert.ok(ni >= 0, id);
    const p = new Vector3().setFromMatrixPosition(world(ni));
    near(p.x, floor.rackX(i) - floor.size.w / 2, id + " x");
    near(p.z, floor.size.d / 2 - floor.rowY[row.id], id + " z");
  }
});

test("all four CRAC units stay within the room after parent transforms", () => {
  for (let i = 1; i <= 4; i++) {
    const ni = index(`CRAC_${i}_body`); assert.ok(ni >= 0);
    const b = bounds(ni), ac = layout.crac[i - 1];
    near(b.getCenter(new Vector3()).x, ac.x - layout.size.w / 2, "AC x");
    near(b.getCenter(new Vector3()).z, layout.size.d / 2 - ac.y, "AC z");
    assert.ok(b.min.x >= -11 && b.max.x <= 11 && b.min.z >= -6 && b.max.z <= 6);
  }
});

test("all 26 devices retain their picking IDs, racks and exact U heights", () => {
  const ids = new Set(layout.devices.map(d => d.id));
  for (const n of gltf.nodes) if (n.extras?.devId) assert.ok(ids.has(n.extras.devId));
  for (const d of layout.devices) {
    const ni = index("DEV_" + d.id); assert.ok(ni >= 0, d.id);
    assert.equal(gltf.nodes[ni].extras.devId, d.id);
    const ancestors = []; for (let p = parents.get(ni); p !== undefined; p = parents.get(p)) ancestors.push(gltf.nodes[p].name);
    assert.ok(ancestors.includes("RACK_" + d.rack));
    const b = bounds(ni);
    near(b.min.y, .115 + (d.u[0] - 1) * .04445 + .002, d.id + " bottom");
    near(b.max.y, .115 + d.u[1] * .04445 - .002, d.id + " top");
    assert.ok(gltf.nodes.some(n => n.name.startsWith("LED_") && n.extras?.devId === d.id), d.id + " LED");
  }
});

test("every rack has an independent hinged door and the same material/detail standard", () => {
  for (const rid of layout.rows.flatMap(r => r.racks)) {
    const hinge = index("DOOR_PIVOT_" + rid); assert.ok(hinge >= 0, rid);
    assert.equal(gltf.nodes[parents.get(hinge)].name, "RACK_" + rid);
    const mesh = gltf.nodes.find(n => n.name === `DOOR_${rid}_mesh`);
    assert.equal(parents.get(gltf.nodes.indexOf(mesh)),hinge);
    assert.equal(gltf.materials[gltf.meshes[mesh.mesh].primitives[0].material].name,'M_Door_PerforatedMesh');
    assert.equal(gltf.nodes[index('RACK_'+rid)].extras.detailStandard,'room-v2');
    assert.ok(index('MECHANICS_'+rid) >= 0);
  }
  assert.equal(gltf.materials.find(m => m.name === "M_Door_PerforatedMesh").alphaMode, "MASK");
  assert.ok(gltf.materials.filter(m => m.normalTexture && m.occlusionTexture && m.pbrMetallicRoughness?.metallicRoughnessTexture).length >= 2);
  for (const m of gltf.materials.filter(m => /Panel|DeviceFace|Frame/.test(m.name))) {
    assert.ok(!m.emissiveFactor || m.emissiveFactor.every(v => v === 0), m.name);
  }
});

test("whole-room export stays within the offline asset and batching budgets", () => {
  const triangles = gltf.meshes.flatMap(m => m.primitives).reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0);
  assert.ok(bytes.length < 12_000_000, `GLB ${bytes.length} bytes`);
  assert.ok(gltf.meshes.length < 350, `${gltf.meshes.length} meshes`);
  assert.ok(triangles < 160_000, `${triangles} unique triangles`);
  const placed = gltf.nodes.filter(n => n.mesh !== undefined).reduce((sum,n) => sum +
    gltf.meshes[n.mesh].primitives.reduce((s,p) => s + gltf.accessors[p.indices].count / 3,0),0);
  assert.ok(placed < 220_000, `${placed} triangles with all shared instances expanded`);
  assert.ok(gltf.nodes.filter(n => n.mesh !== undefined).length > gltf.meshes.length + 80, 'repeated meshes are shared');
  assert.ok(gltf.images.every(i => i.bufferView !== undefined && !i.uri));
});

test("all device types retain detailed, pickable fronts at their own U positions", () => {
  for (const d of layout.devices) {
    const detail = gltf.nodes.map((n,i) => ({n,i})).filter(({n}) => n.name.startsWith('DETAIL_') && n.extras?.devId === d.id);
    assert.ok(detail.length >= 2, d.id);
    for (const {i} of detail) {
      const b=bounds(i);
      assert.ok(b.min.y >= .115+(d.u[0]-1)*.04445-.001 && b.max.y <= .115+d.u[1]*.04445+.001, d.id+' detail U');
    }
  }
});

test("camera presets face the correct row and preserve the R04 comparison pose", () => {
  const floor=data.dcFloor;
  for (const row of floor.rows) for (const [i,id] of row.racks.entries()) {
    const v=rackView({id,x:floor.rackX(i),y:floor.rowY[row.id]},floor);
    assert.equal(v.row,row.id);
    assert.equal(Math.sign(v.eye[2]-v.target[2]),row.id === 'A' ? -1 : 1);
    near(v.target[0],floor.rackX(i)-floor.size.w/2,id);
  }
  const r04=rackView({id:'R04',x:11,y:3.4},floor);
  [.65,1.5,-.75].forEach((n,i)=>near(r04.eye[i],n,'R04 eye'));
  [0,1.04,2.55].forEach((n,i)=>near(r04.target[i],n,'R04 target'));
});

test("near details use hysteresis and focused racks never lose their detail", () => {
  assert.equal(showDetail(6,false),false);
  assert.equal(showDetail(6,true),true);
  assert.equal(showDetail(4,false),true);
  assert.equal(showDetail(8,true),false);
  assert.equal(showDetail(20,false,true),true);
});

test("closed doors pick their own devices; cutaway and adjacent racks cannot steal hits", () => {
  const rack=id=>({name:'RACK_'+id,visible:true});
  const a=rack('R04'), b=rack('R14');
  const obj=(name,parent,devId)=>({name,parent,visible:true,userData:{devId}});
  const door=obj('DOOR_R04_mesh',a), gpu=obj('DETAIL_gpu',a,'gpu-01'), other=obj('DEV_other',b,'other');
  const hit=(object,distance)=>({object,distance});
  assert.deepEqual(pickHit([hit(door,1),hit(gpu,1.08)]),{devId:'gpu-01',rackId:'R04'});
  assert.deepEqual(pickHit([hit(door,1),hit(other,1.05)]),{devId:null,rackId:'R04'});
  b.visible=false;
  assert.deepEqual(pickHit([hit(other,.5),hit(gpu,1)]),{devId:'gpu-01',rackId:'R04'});
  assert.deepEqual(pickHit([hit(obj('BODY_blank',a),.9),hit(gpu,1)]),{devId:null,rackId:'R04'});
});

test("environment ownership reuses targets across themes and disposes each once", () => {
  const targets = [];
  class Scene { constructor() { this.children = []; } add(o) { this.children.push(o); } traverse(fn) { this.children.forEach(fn); } }
  class Disposable { dispose() {} }
  const mock = {
    Scene,
    Color: class { multiplyScalar() { return this; } },
    PlaneGeometry: Disposable, MeshBasicMaterial: Disposable,
    Mesh: class { constructor(geometry, material) { Object.assign(this, { geometry, material, isMesh: true, position: { set() {} }, rotation: { set() {} } }); } },
    PMREMGenerator: class extends Disposable { fromScene() { const t = { texture: {}, disposals: 0, dispose() { this.disposals++; } }; targets.push(t); return t; } },
  };
  const src = readFileSync(new URL("../assets/env3d.js", import.meta.url), "utf8")
    .replace('import * as THREE from "three";', "").replaceAll("export function", "function");
  const { applyEnvironment, disposeEnvironment } = new Function("THREE", src + "; return {applyEnvironment,disposeEnvironment};")(mock);
  const a = new Scene(), b = new Scene();
  const tex = applyEnvironment({}, a, {}, .7);
  for (let i = 0; i < 30; i++) assert.equal(applyEnvironment({}, a, {}, .8), tex);
  applyEnvironment({}, b, {}, .5);
  assert.equal(targets.length, 2);
  disposeEnvironment(a); disposeEnvironment(a);
  assert.equal(targets[0].disposals, 1); assert.equal(targets[1].disposals, 0); assert.equal(a.environment, null);
  disposeEnvironment(b); assert.equal(targets[1].disposals, 1);
});
