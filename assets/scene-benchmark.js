/* Opt-in developer benchmark. Times include the entire compositor, not only
   the last fullscreen pass. RAF intervals are reported separately from CPU
   submission time; neither is labelled GPU time or guaranteed FPS. */
export function installBenchmark({ renderer, canvas, container, active, ready, setView, getView, orbit, invalidate }) {
  const button = document.createElement('button');
  button.className = 'btn tiny'; button.id = 'dc3d-benchmark';
  button.textContent = '运行性能巡检（约 15 秒）';
  const output = document.createElement('output');
  output.id = 'dc3d-benchmark-result';
  output.style.cssText = 'display:block;white-space:pre-wrap;font:11px monospace';
  container.append(button, output);
  let run = null;
  const percentile = (values, q) => {
    const sorted = [...values].sort((a,b) => a-b);
    return Math.round(sorted[Math.min(sorted.length-1, Math.floor(sorted.length*q))] * 100) / 100;
  };
  button.addEventListener('click', () => {
    if (!active() || !ready() || run) return;
    run = { saved:getView(), phase:0, frame:0, last:0, rows:[], cpu:[], intervals:[], calls:[], triangles:[], started:performance.now() };
    button.disabled = true; output.textContent = 'running';
    setView('overview'); invalidate();
  });
  return {
    get running() { return !!run; },
    before() {
      if (!run) return;
      if (!active()) { output.textContent = 'cancelled: view hidden'; button.disabled=false; run=null; return; }
      orbit(.0025); invalidate();
    },
    after(cpuMs, now) {
      if (!run) return;
      const r=run;
      if (r.frame++ >= 30) {
        r.cpu.push(cpuMs); if(r.last) r.intervals.push(now-r.last);
        r.calls.push(renderer.info.render.calls); r.triangles.push(renderer.info.render.triangles);
      }
      r.last=now;
      if (r.frame < 270) return;
      r.rows.push({ view:['overview','aisle','rack'][r.phase], samples:r.cpu.length,
        cpuMs:{p50:percentile(r.cpu,.5),p95:percentile(r.cpu,.95)},
        frameIntervalMs:{p50:percentile(r.intervals,.5),p95:percentile(r.intervals,.95)},
        calls:{p50:percentile(r.calls,.5),max:Math.max(...r.calls)},
        triangles:{max:Math.max(...r.triangles)} });
      r.phase++;
      if(r.phase<3) {
        r.frame=0; r.last=0; r.cpu=[]; r.intervals=[]; r.calls=[]; r.triangles=[];
        setView(['overview','aisle','rack'][r.phase]); return;
      }
      output.textContent=JSON.stringify({status:'complete',durationMs:Math.round(now-r.started),
        viewport:[canvas.clientWidth,canvas.clientHeight],pixelRatio:renderer.getPixelRatio(),
        userAgent:navigator.userAgent,metrics:r.rows,
        resources:{textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,programs:renderer.info.programs.length}},null,2);
      const saved=r.saved; run=null; button.disabled=false; setView(saved);
    },
  };
}
