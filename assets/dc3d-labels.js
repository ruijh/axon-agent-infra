/* Screen-space label policy. Dimensions are CSS pixels measured from the DOM;
   fixed UI overlays reserve their real bounds, including wrapped toolbars. */
export function placeRackLabels(candidates, width, height, reserved = [], gap = 5) {
  const shown = [], hidden = [];
  const overlaps = (a, b) => a.left < b.right + gap && a.right > b.left - gap &&
    a.top < b.bottom + gap && a.bottom > b.top - gap;
  for (const candidate of [...candidates].sort((a, b) =>
    (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id))) {
    const { x, y, w, h } = candidate;
    const rect = { left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
    const outside = ![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 ||
      rect.left < gap || rect.right > width - gap || rect.top < gap || rect.bottom > height - gap;
    if (outside || reserved.some(r => overlaps(rect, r)) || shown.some(p => overlaps(rect, p.rect))) hidden.push(candidate.id);
    else shown.push({ ...candidate, rect });
  }
  return { shown, hidden };
}
