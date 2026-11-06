/* Shared physical U geometry. A device's readable label must stay inside its U span. */
(function (root) {
  const UNITS = 42, PITCH = 26, DETAIL_PITCH = 30;
  function device(u, pitch = PITCH) {
    const [start, end] = u;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > UNITS)
      throw new RangeError('Invalid rack U range');
    return { units: end - start + 1, bottom: (start - 1) * pitch + 1,
      height: (end - start + 1) * pitch - 2, label: start === end ? `U${start}` : `U${start}–${end}` };
  }
  const api = { UNITS, PITCH, DETAIL_PITCH, device };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AXON_RACK_LAYOUT = api;
})(typeof window === 'undefined' ? globalThis : window);
