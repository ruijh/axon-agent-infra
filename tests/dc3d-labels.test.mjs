import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeRackLabels } from '../assets/dc3d-labels.js';

test('rack labels use their complete measured bounds, including warning text', () => {
  const labels = [
    { id: 'R01', x: 100, y: 120, w: 48, h: 26 },
    { id: 'R05', x: 165, y: 120, w: 104, h: 26, priority: 10 },
  ];
  assert.deepEqual(placeRackLabels(labels, 500, 300).shown.map(x => x.id), ['R05']);
  assert.deepEqual(placeRackLabels(labels, 500, 300).hidden, ['R01']);
});

test('selected rack wins over warning and normal racks regardless of input order', () => {
  const labels = [
    { id: 'R01', x: 100, y: 120, w: 60, h: 26, priority: 1 },
    { id: 'R05', x: 110, y: 120, w: 104, h: 26, priority: 100 },
    { id: 'R02', x: 120, y: 120, w: 60, h: 26, priority: 1000 },
  ];
  assert.deepEqual(placeRackLabels(labels, 500, 300).shown.map(x => x.id), ['R02']);
  assert.deepEqual(placeRackLabels(labels.toReversed(), 500, 300), placeRackLabels(labels, 500, 300));
});

test('HUD, toolbar and wrapped legend bounds exclude labels without moving anchors', () => {
  const labels = [
    { id: 'toolbar', x: 60, y: 80, w: 80, h: 30 },
    { id: 'hud', x: 350, y: 150, w: 80, h: 30 },
    { id: 'legend', x: 100, y: 260, w: 80, h: 30 },
    { id: 'clear', x: 150, y: 170, w: 80, h: 30 },
  ];
  const reserved = [
    { left: 10, right: 240, top: 10, bottom: 100 },
    { left: 280, right: 490, top: 10, bottom: 200 },
    { left: 10, right: 490, top: 240, bottom: 290 },
  ];
  const result = placeRackLabels(labels, 500, 300, reserved);
  assert.deepEqual(result.shown.map(x => x.id), ['clear']);
  assert.equal(result.shown[0].x, 150);
  assert.equal(result.shown[0].y, 170);
});

test('labels must fit completely and invalid/hidden measurements are rejected', () => {
  const labels = [
    { id: 'edge', x: 20, y: 100, w: 60, h: 26 },
    { id: 'bottom', x: 100, y: 290, w: 60, h: 26 },
    { id: 'hidden', x: 150, y: 100, w: 0, h: 0 },
    { id: 'invalid', x: NaN, y: 100, w: 60, h: 26 },
    { id: 'fit', x: 35, y: 18, w: 60, h: 26 },
  ];
  assert.deepEqual(placeRackLabels(labels, 500, 300).shown.map(x => x.id), ['fit']);
});
