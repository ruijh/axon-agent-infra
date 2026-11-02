import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTopologyModel,createTopologyState,topologyLayout,placeLabels,nodeTitle} from '../assets/topology-model.js';
import {setTopologyPose} from '../assets/topology-camera.js';
import {OrthographicCamera} from '../assets/vendor/three.core.js';
// Exercise the vendored controls in Node, resolving their browser import map.
const controlsSource=readFileSync(new URL('../assets/vendor/addons/controls/OrbitControls.js',import.meta.url),'utf8')
  .replace("from 'three'",`from '${new URL('../assets/vendor/three.module.js',import.meta.url).href}'`);
const {OrbitControls}=await import('data:text/javascript;base64,'+Buffer.from(controlsSource).toString('base64'));
const data=new Function(readFileSync(new URL('../assets/data.js',import.meta.url),'utf8')+';return AXON_DATA')();
const graph=data.buildGraph(),model=createTopologyModel(graph);
const fixture={nodes:[['server',0],['service',1],['agent',3],['other',3],['task',4],['possible',3]].map(([id,layer])=>({id,layer,type:layer===3?'agent':layer===4?'task':'server',ref:{interruptible:id!=='task'}})),edges:[{from:'service',to:'server'},{from:'agent',to:'service'},{from:'other',to:'service'},{from:'task',to:'agent'},{from:'possible',to:'service',inferred:true},{from:'agent',to:'missing'}]};
test('dependency closure follows consumer to resource without pulling in co-consumers',()=>{
  const a=createTopologyModel(fixture).analyze('agent');assert.deepEqual([...a.visible],['agent','service','server','task']);assert.equal(a.counts.nonInterrupt,1);assert.ok(!a.visible.has('other'));
});
test('reverse impact includes root and all transitive consumers with a witness path',()=>{
  const a=createTopologyModel(fixture).analyze('server','impact');assert.equal(a.visible.size,6);assert.equal(a.counts.agents,3);assert.equal(a.counts.servers,0);
  assert.deepEqual(a.pathTo('task').map(e=>e.to),['service','agent','task']);assert.ok(a.visible.has('server'));assert.ok(a.edges.some(e=>e.to==='server'));
});
test('inferred-only reachability is explicit and filter changes scope and counts',()=>{
  const m=createTopologyModel(fixture),all=m.analyze('server','impact'),declared=m.analyze('server','impact',false);
  assert.deepEqual([...all.potential],['possible']);assert.equal(all.counts.potential,1);assert.equal(all.pathTo('possible').at(-1).inferred,true);
  assert.ok(!declared.visible.has('possible'));assert.equal(declared.counts.agents,2);assert.ok(declared.edges.every(e=>!e.inferred));
});
test('cycles, diamonds, dangling edges and multiple paths do not double count',()=>{
  const g=structuredClone(fixture);g.edges.push({from:'server',to:'service'},{from:'agent',to:'server'},{from:'possible',to:'server'});
  const a=createTopologyModel(g).analyze('server','impact');assert.equal(a.visible.size,6);assert.equal(a.counts.potential,0);assert.deepEqual(a.pathTo('agent').map(e=>e.to),['agent']);
  assert.equal(createTopologyModel(g).analyze('unknown').visible.size,0);
});
test('Agent sample traverses to four hosts and only its two own tasks',()=>{
  const a=model.analyze('ag-cs');assert.equal(a.visible.size,15);assert.equal(a.edges.length,16);
  assert.deepEqual(a.counts,{servers:4,services:8,agents:0,tasks:2,nonInterrupt:0,potential:0});
  assert.ok(a.visible.has('srv-cpu-01'));assert.ok(a.visible.has('T26-0712'));assert.ok(!a.visible.has('ag-coder'));
});
test('server sample reaches six Agents and ten tasks including four noninterruptible',()=>{
  const a=model.analyze('srv-cpu-01','impact');assert.equal(a.visible.size,27);assert.equal(a.edges.length,39);
  assert.deepEqual(a.counts,{servers:0,services:10,agents:6,tasks:10,nonInterrupt:4,potential:0});
  assert.equal(a.pathTo('T26-0677')[0].from,'srv-cpu-01');
});
test('selection is shared and inspecting a member preserves the analysis root',()=>{
  const c=createTopologyState(graph);const seen=[];c.subscribe((s,r)=>seen.push([s.selectedId,r]));
  c.explore('srv-cpu-01','impact');c.select('ag-cs');assert.equal(c.state.rootId,'srv-cpu-01');assert.equal(c.state.selectedId,'ag-cs');
  c.armImpact(true);c.select('srv-gpu-01');assert.equal(c.state.rootId,'srv-gpu-01');assert.equal(c.state.impactArmed,false);
  c.clear();assert.equal(c.analysis,null);assert.equal(c.state.selectedId,null);assert.ok(seen.length>=4);
});
test('reset, inference preference and removed roots cannot leave stale selection',()=>{
  const c=createTopologyState(graph);c.setInferred(false);c.clear();assert.equal(c.state.includeInferred,false);
  c.explore('ag-cs','dependencies');c.refresh({nodes:[],edges:[]});assert.equal(c.analysis,null);assert.equal(c.state.selectedId,null);
  c.reset();assert.equal(c.state.mode,'all');assert.equal(c.state.includeInferred,true);
});
test('all graph nodes support analysis, deterministic finite layout and reachable witness paths',()=>{
  for(const n of graph.nodes)for(const mode of ['dependencies','impact']){
    const a=model.analyze(n.id,mode),l=topologyLayout(graph,a.visible);assert.equal(l.positions.size,a.visible.size);
    for(const p of l.positions.values())assert.ok([p.x,p.y,p.z].every(Number.isFinite));
    for(const id of a.distance.keys())if(id!==n.id){const path=a.pathTo(id);assert.equal(path[0].from,n.id);assert.equal(path.at(-1).to,id);}
  }
  assert.deepEqual(topologyLayout(graph),topologyLayout(graph));
});
test('collision policy preserves priority, rejects out-of-bounds labels and keeps fixed sizes',()=>{
  const a=placeLabels([{id:'low',x:90,y:100,w:100,h:34,priority:1},{id:'root',x:100,y:100,w:100,h:34,priority:100},{id:'edge',x:0,y:20,w:100,h:34,priority:1},{id:'other',x:250,y:170,w:100,h:34,priority:1}],400,300);
  assert.deepEqual(a.shown.map(n=>n.id),['root','other']);assert.deepEqual(a.hidden,['edge','low']);assert.equal(a.shown[0].w,100);
});
test('server names preserve ordinal and search supports exact IDs and asset numbers',()=>{
  assert.match(nodeTitle(model.nodes.get('srv-cpu-01')),/01/);assert.equal(model.search('AST-10243')[0].id,'srv-cpu-01');assert.equal(model.search('ag-cs')[0].id,'ag-cs');assert.deepEqual(model.search(''),[]);
});
test('reset and search poses drain residual orbit damping and remain exact on subsequent frames',()=>{
  const camera=new OrthographicCamera(-600,600,300,-300,1,4000),controls=new OrbitControls(camera);
  camera.position.set(55,105,1500);controls.enableDamping=true;controls.update();
  for(const pose of [{},{position:[355,205,1510],target:[300,100,10],zoom:1.65}]){
    controls.autoRotate=true;controls.update(.5);controls.autoRotate=false;
    setTopologyPose(camera,controls,pose);
    for(let i=0;i<120;i++)controls.update();
    const expected=pose.position||[55,105,1500];camera.position.toArray().forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-7));
    controls.target.toArray().forEach((v,i)=>assert.ok(Math.abs(v-(pose.target||[0,0,0])[i])<1e-7));
    assert.equal(camera.zoom,pose.zoom||1);assert.equal(controls.enableDamping,true);
  }
});
