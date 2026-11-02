/* Pure scene rules, shared by interaction code and regression tests. */
export const DETAIL_ENTER = 5.5;
export const DETAIL_EXIT = 6.5;

export function showDetail(distance, wasVisible, focused = false) {
  return focused || distance < (wasVisible ? DETAIL_EXIT : DETAIL_ENTER);
}

export function rackView(rack, floor) {
  const x = rack.x - floor.size.w / 2;
  const z = floor.size.d / 2 - rack.y;
  const row = floor.rows.find(row => row.racks.includes(rack.id));
  const direction = row.id === floor.rows[0].id ? -1 : 1;
  return { eye: [x + .65 * -direction, 1.5, z + 3.35 * direction],
    target: [x, 1.04, z + .05 * direction], row: row.id };
}

export function visibleInTree(object) {
  for (let p = object; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export function rackOf(object) {
  for (let p = object; p; p = p.parent) {
    const match = /^RACK_(.+)$/.exec(p.name || '');
    if (match) return match[1];
  }
  return null;
}

// A closed perforated door can select the device immediately behind it, but
// never a device in another rack. Opaque chassis/blank panels stop the ray.
export function pickHit(hits) {
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i], rid = rackOf(h.object);
    if (!visibleInTree(h.object)) continue;
    if (h.object.userData.devId) return { devId: h.object.userData.devId, rackId: rid };
    if (h.object.name.startsWith('DOOR_')) {
      for (let j = i + 1; j < hits.length && hits[j].distance - h.distance < .2; j++) {
        const o = hits[j].object;
        if (visibleInTree(o) && o.userData.devId && rackOf(o) === rid)
          return { devId: o.userData.devId, rackId: rid };
      }
    }
    if (rid) return { devId: null, rackId: rid };
  }
  return null;
}
