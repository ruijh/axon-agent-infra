import { createTopologyState } from './topology-model.js';
export const topology = createTopologyState(AXON_DATA.buildGraph());
// Sensor jitter does not invalidate a static graph. Structural/status changes do.
const signature=g=>JSON.stringify([g.nodes.map(n=>[n.id,n.ref?.state,n.ref?.interruptible]),g.edges]);
let current=signature(topology.graph);
AXON.on('tick',()=>{
  const graph=AXON_DATA.buildGraph(), next=signature(graph);
  if(next!==current){current=next;topology.refresh(graph);}
});
