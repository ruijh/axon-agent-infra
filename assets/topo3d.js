/* Stable, directed topology with screen-space labels and on-demand rendering. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { topology } from './topology-state.js';
import { topologyLayout, placeLabels, nodeTitle } from './topology-model.js';
import { installTopologyBenchmark } from './topology-benchmark.js';
import { setTopologyPose } from './topology-camera.js';

(() => {
  const canvas=document.querySelector('#topo3d-canvas'),wrap=canvas.parentElement,labels=document.querySelector('#topo-labels');
  const CV=window.AXON_CV,params=new URLSearchParams(location.search),diagnostics=params.has('topoDiagnostics');
  let renderer;
  try {renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});} catch(e) {
    document.querySelector('#topo-scope').textContent='当前环境不支持 WebGL2，已切换 2D';AXON.setTopoMode('2d');return;
  }
  renderer.setPixelRatio(diagnostics?1:Math.min(devicePixelRatio||1,1.75));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  if(diagnostics&&params.has('topoBenchSize'))wrap.style.cssText='width:830px;height:500px;flex:none';
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-600,600,300,-300,1,4000);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=!REDUCED;controls.dampingFactor=.12;controls.minZoom=.65;controls.maxZoom=3;
  controls.minAzimuthAngle=-.22;controls.maxAzimuthAngle=.22;
  controls.minPolarAngle=Math.PI/2-.22;controls.maxPolarAngle=Math.PI/2+.12;controls.screenSpacePanning=true;
  scene.add(new THREE.AmbientLight(0xffffff,1.5));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-300,500,900);scene.add(light);
  const bodyGeo=new THREE.BoxGeometry(170,38,5),bandGeo=new THREE.BoxGeometry(1,1,2);
  const arrowGeo=new THREE.ConeGeometry(2.2,6,3),flowGeo=new THREE.SphereGeometry(2,6,4);
  const bodyMat=new THREE.MeshStandardMaterial({roughness:.85,metalness:.05}),bandMat=new THREE.MeshBasicMaterial({transparent:true,opacity:.35});
  const arrowMat=new THREE.MeshBasicMaterial(),flowMat=new THREE.MeshBasicMaterial();
  let body,bands,arrows,flow,lines=[],curves=[],layout,nodeOrder=[],labelMap=new Map(),layerLabels=[];
  let W=0,H=0,raf=0,disposed=false,frameCount=0,bench=null,fitPending=true;
  const active=()=>AXON.view==='topo'&&AXON.topoMode!=='2d'&&!document.hidden;
  const moving=()=>!REDUCED&&document.querySelector('#topo-motion').checked&&!!topology.analysis;
  const matrix=new THREE.Matrix4(),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),color=new THREE.Color();
  function invalidate(){if(!disposed&&active()&&!raf)raf=requestAnimationFrame(frame);}
  controls.addEventListener('change',invalidate);
  function removeMesh(mesh){if(mesh){scene.remove(mesh);mesh.dispose();}}
  function colors(id){
    const n=topology.model.nodes.get(id),a=topology.analysis,s=topology.state;
    if(s.mode==='impact'&&a?.visible.has(id))return id===a.root?CV.hex('crit'):a.potential.has(id)?CV.hex('warn'):a.distance.get(id)===1?CV.hex('crit'):CV.hex('warn');
    return LAYER_META[n.layer].color;
  }
  function rebuild(preserveCamera=false){
    const focusedLabel=document.activeElement?.dataset.nodeId;
    const graph=topology.graph,a=topology.analysis,visible=a?.visible||new Set(graph.nodes.map(n=>n.id));
    layout=topologyLayout(graph,visible);nodeOrder=graph.nodes.filter(n=>visible.has(n.id));
    [body,bands,arrows,flow].forEach(removeMesh);
    lines.forEach(l=>{scene.remove(l);l.geometry.dispose();l.material.dispose();});lines=[];curves=[];
    body=new THREE.InstancedMesh(bodyGeo,bodyMat,nodeOrder.length);scene.add(body);
    labels.replaceChildren();labelMap.clear();layerLabels=[];
    nodeOrder.forEach((n,i)=>{
      const p=layout.positions.get(n.id);matrix.makeTranslation(p.x,p.y,p.z);body.setMatrixAt(i,matrix);
      const button=document.createElement('button');button.className='topo-node-label';button.dataset.nodeId=n.id;
      button.title=`${nodeTitle(n)} · ${n.id}`;button.setAttribute('aria-label',button.title);
      const title=document.createElement('span'),sub=document.createElement('small');title.textContent=nodeTitle(n);sub.textContent=n.id;button.append(title,sub);
      button.onclick=()=>topology.select(n.id);button.ondblclick=()=>topology.explore(n.id,'dependencies');
      labels.append(button);labelMap.set(n.id,button);
    });
    bands=new THREE.InstancedMesh(bandGeo,bandMat,5);scene.add(bands);
    layout.layers.forEach((l,i)=>{
      dummy.position.set(l.x,0,-24-i*5);dummy.scale.set(l.width+10,layout.height-35,1);dummy.rotation.set(0,0,0);dummy.updateMatrix();bands.setMatrixAt(i,dummy.matrix);bands.setColorAt(i,color.set(CV.hex('node')));
      const el=document.createElement('div');el.className='topo-layer-label';el.textContent=`L${i}  ${LAYER_META[i].name} · ${l.count}`;labels.append(el);layerLabels.push({el,l});
    });
    const edges=a?.edges||topology.model.edges.filter(e=>topology.state.includeInferred||!e.inferred),groups=new Map();
    const path=a?.pathTo(topology.state.selectedId)||[];
    const pathEdges=new Set(path.flatMap(e=>[e.from+'|'+e.to,e.to+'|'+e.from]));
    edges.forEach(e=>{
      const a=layout.positions.get(e.from),b=layout.positions.get(e.to);if(!a||!b)return;
      const p0=new THREE.Vector3(a.x-88,a.y,a.z),p3=new THREE.Vector3(b.x+88,b.y,b.z),d=Math.max(28,(p0.x-p3.x)*.43);
      const curve=new THREE.CubicBezierCurve3(p0,new THREE.Vector3(p0.x-d,p0.y,p0.z-7),new THREE.Vector3(p3.x+d,p3.y,p3.z-7),p3);
      const col=topology.state.mode==='impact'?colors(e.from):topology.analysis?CV.hex('accentSoft'):CV.hex('steel');
      const dim=path.length&&!pathEdges.has(e.from+'|'+e.to);
      const key=col+(e.inferred?'d':'s')+(dim?'dim':'lit');if(!groups.has(key))groups.set(key,{col,dim,points:[]});
      const points=curve.getPoints(32),group=groups.get(key);
      for(let j=0;j<32;j++){if(e.inferred&&j%4>=2)continue;group.points.push(points[j],points[j+1]);}
      curves.push({curve,e,col,dim});
    });
    groups.forEach(g=>{const l=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(g.points),new THREE.LineBasicMaterial({color:g.col,transparent:true,opacity:g.dim ? .12 : topology.analysis ? .82 : .36}));scene.add(l);lines.push(l);});
    arrows=new THREE.InstancedMesh(arrowGeo,arrowMat,curves.length);scene.add(arrows);
    flow=new THREE.InstancedMesh(flowGeo,flowMat,curves.length);flow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);flow.visible=false;scene.add(flow);
    curves.forEach(({curve,col,dim},i)=>{
      const impact=topology.state.mode==='impact',t=impact ? .16 : .84;
      dummy.position.copy(curve.getPoint(t));dummy.quaternion.setFromUnitVectors(up,curve.getTangent(t).multiplyScalar(impact?-1:1));dummy.scale.setScalar(dim?0:1);dummy.updateMatrix();arrows.setMatrixAt(i,dummy.matrix);arrows.setColorAt(i,color.set(col));flow.setColorAt(i,color);
    });
    paint();if(!preserveCamera)fitPending=true;resize();
    if(focusedLabel)labelMap.get(focusedLabel)?.focus({preventScroll:true});
  }
  function paint(){
    scene.background=new THREE.Color(CV.hex('bg1'));const a=topology.analysis;
    nodeOrder.forEach((n,i)=>{
      const selected=n.id===topology.state.selectedId,col=colors(n.id);
      body.setColorAt(i,color.set(CV.hex('node')).lerp(new THREE.Color(col),selected ? .28 : .07));
      const el=labelMap.get(n.id);el.style.setProperty('--node-color',col);el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));
      el.classList.toggle('impact-root',n.id===topology.state.rootId&&topology.state.mode==='impact');el.classList.toggle('potential',!!a?.potential.has(n.id));
    });
    if(body.instanceColor)body.instanceColor.needsUpdate=true;invalidate();
  }
  function fit(){
    if(!W||!H)return;
    const ps=[...layout.positions.values()],minY=Math.min(...ps.map(p=>p.y),0)-25,maxY=Math.max(...ps.map(p=>p.y),0)+25;
    const scale=Math.min((W-32)/(layout.width+28),(H-110)/(maxY-minY));
    camera.left=-W/(2*scale);camera.right=W/(2*scale);camera.top=H/(2*scale);camera.bottom=-H/(2*scale);
    setTopologyPose(camera,controls);fitPending=false;
  }
  function resize(){
    const r=wrap.getBoundingClientRect();if(!r.width||!r.height)return;
    const w=Math.round(r.width-2),h=Math.round(r.height-2);
    if(w!==W||h!==H){W=w;H=h;renderer.setSize(W,H,false);fitPending=true;}
    if(fitPending)fit();invalidate();
  }
  const projected=new THREE.Vector3();
  function project(p){projected.set(p.x,p.y,p.z).project(camera);return{x:(projected.x+1)*W/2,y:(1-projected.y)*H/2};}
  function projectLabels(){
    const scale=W/(camera.right-camera.left)*camera.zoom,w=Math.max(84,Math.min(165,170*scale)),s=topology.state;
    const candidates=nodeOrder.map(n=>({...project(layout.positions.get(n.id)),id:n.id,w,h:32,priority:n.id===s.selectedId?100:n.id===s.rootId?90:n.layer===3?20:1}));
    const placed=placeLabels(candidates,W,H),shown=new Set(placed.shown.map(c=>c.id));
    candidates.forEach(c=>{const el=labelMap.get(c.id);el.hidden=!shown.has(c.id);if(!el.hidden){el.style.width=`${w}px`;el.style.transform=`translate(${c.x-w/2}px,${c.y-16}px)`;}});
    layerLabels.forEach(({el,l})=>{const p=project({x:l.x,y:0,z:0});el.style.left=`${p.x}px`;el.hidden=p.x<30||p.x>W-30;});
    document.querySelector('#topo-label-hint').textContent=placed.hidden.length?`${placed.hidden.length} 个标签已收起 · 放大或搜索定位`:'';
    canvas.dataset.labels=String(shown.size);canvas.dataset.hiddenLabels=String(placed.hidden.length);
  }
  function frame(now){
    raf=0;if(!active()){bench?.cancel();return;}
    const start=performance.now();bench?.before();controls.update();camera.updateMatrixWorld();projectLabels();
    flow.visible=moving();
    if(flow.visible){curves.forEach(({curve,dim},i)=>{let t=(now/3200+i*.137)%1;if(topology.state.mode==='impact')t=1-t;matrix.makeTranslation(...curve.getPoint(t).toArray());if(dim)matrix.scale(new THREE.Vector3(0,0,0));flow.setMatrixAt(i,matrix);});flow.instanceMatrix.needsUpdate=true;}
    renderer.info.reset();renderer.render(scene,camera);frameCount++;canvas.dataset.ready='true';
    if(diagnostics){canvas.dataset.frames=String(frameCount);canvas.dataset.selected=topology.state.selectedId||'';canvas.dataset.scope=topology.state.mode;canvas.dataset.camera=JSON.stringify([camera.zoom,...camera.position.toArray(),...controls.target.toArray()]);}
    bench?.after(performance.now()-start,now);if(moving()||bench?.running)invalidate();
  }
  const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();let down=null;
  canvas.addEventListener('pointerdown',e=>{if(e.button===0)down={x:e.clientX,y:e.clientY};});
  canvas.addEventListener('pointerup',e=>{
    if(!down)return;const distance=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(distance>5)return;
    const r=canvas.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);ray.setFromCamera(ndc,camera);
    const hit=ray.intersectObject(body)[0];if(hit)topology.select(nodeOrder[hit.instanceId].id);else topology.clear();
  });
  canvas.addEventListener('pointercancel',()=>down=null);
  canvas.addEventListener('keydown',e=>{if(e.key==='Home'){e.preventDefault();fitPending=true;resize();}});
  canvas.tabIndex=0;canvas.setAttribute('aria-label','三维拓扑画布；Home 恢复镜头，Escape 清除选择，可通过搜索定位节点');
  const unsubscribe=topology.subscribe((s,reason)=>{if(['scope','data','reset'].includes(reason))rebuild();else if(topology.analysis)rebuild(true);else paint();});
  AXON.on('topo-locate',id=>{resize();const p=layout.positions.get(id);if(!p)return;setTopologyPose(camera,controls,{target:[p.x,p.y,p.z],position:[p.x+55,p.y+105,p.z+1500],zoom:1.65});invalidate();});
  AXON.on('theme',()=>rebuild(true));AXON.on('topo-motion',invalidate);
  const visibility=()=>{if(active())resize();else{cancelAnimationFrame(raf);raf=0;bench?.cancel();}};
  AXON.on('view',visibility);AXON.on('topo-mode',()=>{labels.hidden=AXON.topoMode==='2d';visibility();});
  document.addEventListener('visibilitychange',visibility);
  const observer=new ResizeObserver(()=>{if(active())resize();});observer.observe(wrap);
  rebuild();labels.hidden=AXON.topoMode==='2d';
  if(diagnostics)bench=installTopologyBenchmark({renderer,canvas,active,frameCount:()=>frameCount,invalidate,
    scenario:name=>{if(name==='agent')topology.explore('ag-cs','dependencies');else if(name==='impact')topology.explore('srv-cpu-01','impact');else topology.reset();},
    orbit:n=>{camera.position.set(55+Math.sin(n*.012)*110,105,1500);camera.lookAt(controls.target);},
    snapshot:()=>({nodes:nodeOrder.length,edges:curves.length,labels:Number(canvas.dataset.labels),scope:topology.state.mode})});
  window.addEventListener('pagehide',e=>{
    if(e.persisted)return;disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();unsubscribe();
    [body,bands,arrows,flow].forEach(removeMesh);lines.forEach(l=>{l.geometry.dispose();l.material.dispose();});
    [bodyGeo,bandGeo,arrowGeo,flowGeo,bodyMat,bandMat,arrowMat,flowMat].forEach(o=>o.dispose());renderer.dispose();
  });
})();
