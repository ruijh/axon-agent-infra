/* Dependency edges always point consumer -> dependency. Pure, cycle-safe rules. */
export const edgeKey = e => `${e.from}\u0000${e.to}\u0000${e.kind || ''}\u0000${!!e.inferred}`;
export const nodeTitle = n => n.ref?.name || n.label || n.id;

export function createTopologyModel(graph) {
  const nodes = new Map(graph.nodes.map(n => [n.id,n]));
  const validEdges = graph.edges.filter(e => nodes.has(e.from) && nodes.has(e.to));
  function walk(root, reverse = false, includeInferred = true) {
    const reached = new Set(), distance = new Map(), parent = new Map();
    if (!nodes.has(root)) return {reached,distance,parent};
    reached.add(root); distance.set(root,0);
    const adjacency = new Map();
    for (const e of validEdges) {
      if (e.inferred && !includeInferred) continue;
      const a=reverse?e.to:e.from, b=reverse?e.from:e.to;
      if(!adjacency.has(a)) adjacency.set(a,[]);
      adjacency.get(a).push({id:b,edge:e});
    }
    const queue=[root];
    for(let i=0;i<queue.length;i++) for(const step of adjacency.get(queue[i]) || []) {
      if(reached.has(step.id)) continue;
      reached.add(step.id); distance.set(step.id,distance.get(queue[i])+1);
      parent.set(step.id,{id:queue[i],edge:step.edge}); queue.push(step.id);
    }
    return {reached,distance,parent};
  }
  function analyze(root, mode='dependencies', includeInferred=true) {
    const reverse=mode==='impact';
    const traversal=walk(root,reverse,includeInferred), declared=walk(root,reverse,false);
    const visible=new Set(traversal.reached);
    // Agent view includes its own in-flight tasks, but never another agent
    // merely because it uses the same gateway, tool or server.
    if(!reverse && nodes.get(root)?.type==='agent') {
      for(const e of validEdges) if(e.to===root && nodes.get(e.from)?.type==='task') visible.add(e.from);
    }
    const selectedEdges=validEdges.filter(e=>visible.has(e.from)&&visible.has(e.to)&&(!e.inferred||includeInferred));
    const counts={servers:0,services:0,agents:0,tasks:0,nonInterrupt:0,potential:0};
    for(const id of visible) {
      if(id===root) continue;
      const n=nodes.get(id);
      if(n.layer===0) counts.servers++;
      else if(n.layer<=2) counts.services++;
      else if(n.layer===3) counts.agents++;
      else if(n.layer===4) { counts.tasks++; if(n.ref?.interruptible===false) counts.nonInterrupt++; }
      if(traversal.reached.has(id)&&!declared.reached.has(id)) counts.potential++;
    }
    function pathTo(id) {
      if(!traversal.reached.has(id)) return [];
      const path=[]; let cursor=id;
      while(cursor!==root) {
        const link=traversal.parent.get(cursor); if(!link) return [];
        path.push({from:link.id,to:cursor,inferred:!!link.edge.inferred}); cursor=link.id;
      }
      return path.reverse();
    }
    return {root,mode,visible,edges:selectedEdges,counts,distance:traversal.distance,
      potential:new Set([...traversal.reached].filter(id=>!declared.reached.has(id))),pathTo};
  }
  const search = query => {
    const q=query.trim().toLocaleLowerCase();
    if(!q) return [];
    return [...nodes.values()].filter(n=>`${n.id} ${nodeTitle(n)} ${n.ref?.asset||''}`.toLocaleLowerCase().includes(q))
      .sort((a,b)=>Number(b.id.toLowerCase()===q)-Number(a.id.toLowerCase()===q)||a.layer-b.layer||a.id.localeCompare(b.id));
  };
  return {graph,nodes,edges:validEdges,walk,analyze,search};
}

export function createTopologyState(graph) {
  let model=createTopologyModel(graph);
  let state={selectedId:null,rootId:null,mode:'all',includeInferred:true,impactArmed:false};
  const listeners=new Set();
  let analysisCache;
  const publish=reason=>{analysisCache=undefined;listeners.forEach(fn=>fn(state,reason));};
  return {
    get graph(){return model.graph;}, get model(){return model;}, get state(){return state;},
    get analysis(){if(analysisCache===undefined)analysisCache=state.rootId?model.analyze(state.rootId,state.mode,state.includeInferred):null;return analysisCache;},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    select(id){
      if(id!==null&&!model.nodes.has(id)) return;
      if(id===null){this.clear();return;}
      if(state.impactArmed){this.explore(id,'impact');return;}
      state={...state,selectedId:id};publish('select');
    },
    inspect(id){if(!model.nodes.has(id))return;state={...state,selectedId:id};publish('select');},
    explore(id,mode){
      if(!model.nodes.has(id)||!['dependencies','impact'].includes(mode))return;
      state={...state,rootId:id,selectedId:id,mode,impactArmed:false};publish('scope');
    },
    armImpact(on){
      state={...state,impactArmed:on};
      if(!on){state={...state,rootId:null,mode:'all'};}
      publish('scope');
    },
    setInferred(value){state={...state,includeInferred:!!value};publish('scope');},
    clear(){state={...state,selectedId:null,rootId:null,mode:'all',impactArmed:false};publish('scope');},
    reset(){state={selectedId:null,rootId:null,mode:'all',includeInferred:true,impactArmed:false};publish('reset');},
    refresh(next){
      model=createTopologyModel(next);
      if(state.rootId&&!model.nodes.has(state.rootId))state={...state,rootId:null,mode:'all',impactArmed:false};
      if(state.selectedId&&!model.nodes.has(state.selectedId))state={...state,selectedId:null};
      publish('data');
    },
  };
}

/* Arrange each layer independently; order by barycentre to reduce crossings.
   World dimensions deliberately mirror readable pixel-scale cards. */
export function topologyLayout(graph, visible=new Set(graph.nodes.map(n=>n.id))) {
  const cols=Array.from({length:5},()=>[]), positions=new Map(), layers=[];
  graph.nodes.forEach(n=>{if(visible.has(n.id))cols[n.layer].push(n);});
  cols.forEach(c=>c.sort((a,b)=>a.id.localeCompare(b.id)));
  const rank=new Map(); cols.forEach(c=>c.forEach((n,i)=>rank.set(n.id,i)));
  for(let pass=0;pass<4;pass++) {
    for(const ci of (pass%2?[4,3,2,1,0]:[0,1,2,3,4])) {
      const score=n=>{
        const neighbours=graph.edges.filter(e=>!e.inferred&&(e.from===n.id||e.to===n.id))
          .map(e=>e.from===n.id?e.to:e.from).filter(id=>rank.has(id));
        return neighbours.length?neighbours.reduce((s,id)=>s+rank.get(id),0)/neighbours.length:rank.get(n.id);
      };
      cols[ci].sort((a,b)=>score(a)-score(b)||a.id.localeCompare(b.id));
      cols[ci].forEach((n,i)=>rank.set(n.id,i));
    }
  }
  let cursor=0;
  cols.forEach((col,layer)=>{
    const lanes=Math.max(1,Math.ceil(col.length/10)), width=lanes*184;
    const per=Math.ceil(col.length/lanes);
    col.forEach((n,i)=>positions.set(n.id,{x:cursor+92+Math.floor(i/per)*184,y:((per-1)/2-i%per)*52,z:(2-layer)*5}));
    layers.push({layer,x:cursor+width/2,width,count:col.length});cursor+=width+56;
  });
  const center=(cursor-56)/2;
  positions.forEach(p=>p.x-=center);layers.forEach(l=>l.x-=center);
  return {positions,layers,width:cursor-56,height:Math.max(1,...cols.map(c=>Math.min(10,c.length)))*52+90};
}

export function placeLabels(candidates,width,height) {
  const chosen=[],hidden=[];
  for(const c of [...candidates].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))) {
    const rect={left:c.x-c.w/2,right:c.x+c.w/2,top:c.y-c.h/2,bottom:c.y+c.h/2};
    const offscreen=rect.left<5||rect.right>width-5||rect.top<42||rect.bottom>height-48;
    const overlap=chosen.some(p=>rect.left<p.rect.right+2&&rect.right>p.rect.left-2&&rect.top<p.rect.bottom+2&&rect.bottom>p.rect.top-2);
    if(offscreen||overlap)hidden.push(c.id);else chosen.push({...c,rect});
  }
  return {shown:chosen,hidden};
}
