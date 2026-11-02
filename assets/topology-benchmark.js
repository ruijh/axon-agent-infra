/* Opt-in topology-only measurement; CPU submission is not GPU time. */
export function installTopologyBenchmark({renderer,canvas,active,frameCount,scenario,orbit,invalidate,snapshot,scenarios=['overview','agent','impact']}) {
  const panel=document.createElement('details');panel.id='topo-diagnostics';panel.open=true;
  panel.style.cssText='position:fixed;right:8px;bottom:8px;z-index:9999;max-height:190px;overflow:auto;background:var(--bg,#14202e);padding:8px;border:1px solid #648094;font:11px monospace;max-width:420px';
  panel.innerHTML='<summary>拓扑性能诊断</summary><button id="topo-benchmark">运行拓扑基准</button> <button id="topo-snapshot">资源快照</button><output id="topo-benchmark-result" style="display:block;white-space:pre-wrap"></output><output id="topo-snapshot-result" style="display:block;white-space:pre-wrap"></output>';
  document.body.append(panel);
  const button=panel.querySelector('#topo-benchmark'),out=panel.querySelector('#topo-benchmark-result');
  const resources=()=>({frames:frameCount(),textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,programs:renderer.info.programs.length,...snapshot()});
  panel.querySelector('#topo-snapshot').onclick=()=>panel.querySelector('#topo-snapshot-result').textContent=JSON.stringify(resources());
  let run=null;
  const percentile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);return Math.round(a[Math.floor((a.length-1)*q)]*100)/100;};
  button.onclick=()=>{
    if(run||!active())return;
    run={phase:0,n:0,last:0,cpu:[],intervals:[],calls:[],triangles:[],rows:[]};button.disabled=true;out.textContent='running';scenario(scenarios[0]);invalidate();
  };
  return {
    get running(){return !!run;},
    before(){if(run)orbit(run.n);},
    cancel(){if(!run)return;run=null;button.disabled=false;out.textContent='cancelled: topology hidden';},
    after(cpu,now){
      if(!run)return;const r=run;
      if(r.n++>=30){r.cpu.push(cpu);if(r.last)r.intervals.push(now-r.last);r.calls.push(renderer.info.render.calls);r.triangles.push(renderer.info.render.triangles);}r.last=now;
      if(r.n<210)return;
      r.rows.push({scenario:scenarios[r.phase],canvas:[canvas.clientWidth,canvas.clientHeight],samples:r.cpu.length,cpuMs:{p50:percentile(r.cpu,.5),p95:percentile(r.cpu,.95)},frameIntervalMs:{p50:percentile(r.intervals,.5),p95:percentile(r.intervals,.95)},calls:Math.max(...r.calls),triangles:Math.max(...r.triangles),...snapshot()});
      if(++r.phase<scenarios.length){r.n=0;r.last=0;r.cpu=[];r.intervals=[];r.calls=[];r.triangles=[];scenario(scenarios[r.phase]);return;}
      out.textContent=JSON.stringify({status:'complete',canvas:[canvas.clientWidth,canvas.clientHeight],pixelRatio:renderer.getPixelRatio(),userAgent:navigator.userAgent,metrics:r.rows,resources:resources()},null,2);
      run=null;button.disabled=false;scenario('overview');
    },
  };
}
