import { topology } from './topology-state.js';
import { nodeTitle } from './topology-model.js';

const $=s=>document.querySelector(s);
const search=$('#topo-search'),results=$('#topo-search-results');
const title=id=>nodeTitle(topology.model.nodes.get(id));
function searchResults(){
  const matches=topology.model.search(search.value);results.hidden=!search.value.trim();
  results.innerHTML=matches.length?matches.map(n=>`<button data-search-node="${esc(n.id)}"><b>${esc(nodeTitle(n))}</b><small>${esc(n.id)} · ${esc(LAYER_META[n.layer].name)}</small></button>`).join(''):'<p>没有匹配对象</p>';
}
function locate(id){
  if(topology.analysis&&!topology.analysis.visible.has(id))topology.clear();
  topology.inspect(id);results.hidden=true;AXON.emit('topo-locate',id);
}
search.addEventListener('input',searchResults);
search.addEventListener('keydown',e=>{
  if(e.key==='Enter'){const n=topology.model.search(search.value)[0];if(n)locate(n.id);}
  if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}
});
results.addEventListener('click',e=>{const b=e.target.closest('[data-search-node]');if(b)locate(b.dataset.searchNode);});
results.addEventListener('keydown',e=>{
  const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);
  if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.topo-search'))results.hidden=true;});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&AXON.view==='topo'&&!document.querySelector('.modal-overlay.open')){results.hidden=true;topology.clear();}
});
$('#topo-overview').onclick=()=>topology.reset();
$('#topo-dependencies').onclick=()=>topology.explore(topology.state.selectedId,'dependencies');
$('#topo-agent-sample').onclick=()=>topology.explore('ag-cs','dependencies');
$('#topo-impact-sample').onclick=()=>topology.explore('srv-cpu-01','impact');
$('#topo-inferred').onchange=e=>topology.setInferred(e.target.checked);
$('#topo-close').onclick=()=>topology.clear();
if(REDUCED){$('#topo-motion').disabled=true;$('#topo-motion').title='系统已启用减少动态效果';}
$('#topo-motion').onchange=()=>AXON.emit('topo-motion');
$('#topo-analysis').addEventListener('click',e=>{const b=e.target.closest('[data-analysis-node]');if(b)topology.inspect(b.dataset.analysisNode);});
function render(_state,reason){
  if(reason==='reset'){search.value='';results.hidden=true;}
  const s=topology.state,a=topology.analysis,selected=topology.model.nodes.get(s.selectedId);
  $('#view-topo .topo-wrap').classList.toggle('has-selection',!!selected);
  $('#topo-inspector').hidden=!selected;
  $('#topo-inferred').checked=s.includeInferred;
  $('#topo-dependencies').disabled=!selected;
  $('#btn-impact-mode').classList.toggle('active',s.mode==='impact'||s.impactArmed);
  $('#btn-impact-mode').textContent=s.impactArmed?'请选择故障源':s.mode==='impact'?'退出故障推演':'故障影响';
  $('#topo-impact-bar').hidden=true;
  $('#topo-scope').textContent=a?`${s.mode==='impact'?'故障影响推演':'完整依赖'} · ${title(a.root)} · ${a.visible.size} 个对象 / ${a.edges.length} 条关系`:`全图 · ${topology.graph.nodes.length} 个对象 / ${topology.model.edges.filter(e=>s.includeInferred||!e.inferred).length} 条关系`;
  $('#topo-scope').dataset.mode=s.mode;
  $('#topo-analysis').innerHTML='';
  if(!a)return;
  const c=a.counts,root=topology.model.nodes.get(a.root),impact=s.mode==='impact';
  const path=a.pathTo(s.selectedId);
  const pathHTML=path.length?`<div class="topo-path"><h4>${impact?'传播路径 · 最短路径之一':'依赖路径 · 最短路径之一'}</h4>${[path[0].from,...path.map(e=>e.to)].map((id,i)=>`${i?`<span class="path-arrow">${path[i-1].inferred?'⇢ 推断':'→'}</span>`:''}<button data-analysis-node="${esc(id)}">${esc(title(id))}</button>`).join('')}</div>`:'';
  const members=[...a.visible].filter(id=>id!==a.root).sort((a,b)=>topology.model.nodes.get(b).layer-topology.model.nodes.get(a).layer||a.localeCompare(b));
  $('#topo-analysis').innerHTML=`<div class="analysis-kicker">${impact?'FAILURE IMPACT · 故障推演':'DEPENDENCY CHAIN · 完整依赖'}</div><h3>${esc(nodeTitle(root))}</h3><p class="analysis-note">${impact?'按当前依赖图推演，不代表对象已故障。':root.type==='agent'?'追溯至物理服务器，包含本 Agent 的在途任务。':'沿当前依赖逐层追溯至承载资源。'}${s.includeInferred?' 包含推断关系。':' 仅声明关系。'}</p>
    <div class="analysis-counts"><span><b>${impact?1:c.servers}</b>${impact?'故障源':'服务器'}</span><span><b>${c.services}</b>服务 / 端点</span><span><b>${c.agents+(root.layer===3?1:0)}</b>Agent</span><span><b>${c.tasks}</b>在途任务</span></div>
    <p class="analysis-risk">${impact?'受影响对象':'链路任务'}中不可中断：<b>${c.nonInterrupt}</b> · 仅由推断关联：<b>${c.potential}</b></p>
    ${pathHTML}<details class="analysis-members" ${impact?'open':''}><summary>${impact?'受影响对象':'链路对象'} · ${members.length}</summary>${members.map(id=>{const n=topology.model.nodes.get(id),distance=a.distance.get(id);return `<button data-analysis-node="${esc(id)}" ${id===s.selectedId?'aria-current="true"':''}><span>${esc(nodeTitle(n))}</span><small>${a.potential.has(id)?'推断关联':distance===1?(impact?'直接影响':'直接依赖'):n.layer===4&&!impact?'所属任务':impact?'间接影响':'间接依赖'}${n.ref?.interruptible===false?' · 不可中断':''}</small></button>`;}).join('')}</details><div class="analysis-divider"></div>`;
}
topology.subscribe(render);render();
AXON.on('topo-mode',m=>{$('#topo-labels').hidden=m==='2d';$('#topo-label-hint').hidden=m==='2d';});
const preset=new URLSearchParams(location.search).get('topo');
if(preset){AXON.nav('topo');AXON.setTopoMode('3d');if(preset==='agent')topology.explore('ag-cs','dependencies');else if(preset==='impact')topology.explore('srv-cpu-01','impact');}
