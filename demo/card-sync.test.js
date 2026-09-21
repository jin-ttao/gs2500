import test from 'node:test';
import assert from 'node:assert/strict';
import { clipCardViewport } from './card-worlds.js';

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

test('a visible card keeps its full projection in CSS pixels', () => {
  assert.deepEqual(clipCardViewport(rect(20, 30, 100, 80), 200, 300), {
    viewport: { x: 20, y: 190, width: 100, height: 80 },
    scissor: { x: 20, y: 190, width: 100, height: 80 },
  });
});

test('partially scrolled cards clip pixels without squeezing the camera viewport', () => {
  assert.deepEqual(clipCardViewport(rect(-20, -10, 100, 80), 200, 300), {
    viewport: { x: -20, y: 230, width: 100, height: 80 },
    scissor: { x: 0, y: 230, width: 80, height: 70 },
  });
  assert.deepEqual(clipCardViewport(rect(170, 270, 100, 80), 200, 300), {
    viewport: { x: 170, y: -50, width: 100, height: 80 },
    scissor: { x: 170, y: 0, width: 30, height: 30 },
  });
});

test('every clipping ancestor contributes to the visible intersection', () => {
  const card = rect(20, 30, 100, 80);
  const outer = rect(40, 20, 70, 90);
  const inner = rect(30, 50, 60, 45);
  const expected = {
    viewport: { x: 20, y: 190, width: 100, height: 80 },
    scissor: { x: 40, y: 205, width: 50, height: 45 },
  };
  assert.deepEqual(clipCardViewport(card, 200, 300, [outer, inner]), expected);
  assert.deepEqual(clipCardViewport(card, 200, 300, [inner, outer]), expected);
  assert.deepEqual(clipCardViewport(card, 200, 300, [outer, inner, outer]), expected);
});

test('an ancestor clips only the CSS overflow axes it owns', () => {
  const card = rect(20, 30, 100, 80);
  const horizontalOnly = { ...rect(40, 150, 50, 20), y: false };
  const verticalOnly = { ...rect(150, 50, 20, 45), x: false };
  assert.deepEqual(clipCardViewport(card, 200, 300, [horizontalOnly, verticalOnly]), {
    viewport: { x: 20, y: 190, width: 100, height: 80 },
    scissor: { x: 40, y: 205, width: 50, height: 45 },
  });
});

test('offscreen, hidden-size and fully ancestor-clipped cards have no drawable area', () => {
  for (const card of [
    rect(-100, 20, 100, 80), rect(200, 20, 100, 80),
    rect(20, -80, 100, 80), rect(20, 300, 100, 80),
    rect(20, 20, 0, 80), rect(20, 20, 100, 0),
  ]) {
    assert.equal(clipCardViewport(card, 200, 300), null, JSON.stringify(card));
  }
  assert.equal(clipCardViewport(rect(20, 30, 100, 80), 200, 300, [rect(150, 20, 40, 120)]), null);
  assert.equal(clipCardViewport(rect(20, 30, 100, 80), 200, 300, [rect(20, 30, 100, 0)]), null);
  assert.equal(clipCardViewport(rect(20, 30, 100, 80), 0, 300), null);
  assert.equal(clipCardViewport(rect(20, 30, 100, 80), 200, 0), null);
});

test('clipping never mutates card or ancestor geometry', () => {
  const card = Object.freeze(rect(-20, 30, 200, 80));
  const ancestor = Object.freeze(rect(40, 20, 70, 90));
  const clips = Object.freeze([ancestor]);
  const before = JSON.stringify({ card, clips });
  const result = clipCardViewport(card, 200, 300, clips);
  assert.equal(JSON.stringify({ card, clips }), before);
  assert.equal(result.viewport.width, card.width);
  assert.equal(result.viewport.height, card.height);
  assert.deepEqual(result.scissor, { x: 40, y: 190, width: 70, height: 80 });
});
