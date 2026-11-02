/** Apply an exact pose even while an OrbitControls gesture is still damping. */
export function setTopologyPose(camera, controls, {position=[55,105,1500],target=[0,0,0],zoom=1}={}) {
  const damping=controls.enableDamping;
  controls.enableDamping=false;
  controls.update();
  controls.enableDamping=damping;
  controls.target.fromArray(target);
  camera.position.fromArray(position);
  camera.zoom=zoom;
  camera.updateProjectionMatrix();
  controls.update();
}
