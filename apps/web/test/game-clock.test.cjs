const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Clock = require('../app/demo/[slug]/game-clock').default;
const render = props => renderToStaticMarkup(React.createElement(Clock, { finished: false, disabled: false, ...props }));

test('only an explicitly writable clock has start, pause or resume buttons', () => {
  const clock = { startedAt: '2026-11-13T01:00:00.000Z', runningSince: null, elapsedMs: 65000 };
  assert.match(render({ onAction() {} }), /INICIAR TIEMPO/);
  assert.doesNotMatch(render({}), /<button/);
  assert.match(render({ clock, onAction() {} }), /Reanudar tiempo/);
  assert.match(render({ clock: { ...clock, runningSince: clock.startedAt }, onAction() {} }), /Pausar tiempo/);
  assert.doesNotMatch(render({ clock, finished: true, onAction() {} }), /<button/);
  assert.match(render({ clock, finished: true }), /00:01:05/);
  assert.match(render({ onAction() {}, disabled: true }), /disabled=""/);
});

test('the timer does not announce every second or invent durations for old finished games', () => {
  assert.match(render({}), /role="timer" aria-live="off"/);
  assert.match(render({ finished: true }), /—/);
  assert.doesNotMatch(render({ finished: true }), /00:00:00/);
  assert.match(render({ privateClock: true }), /Tiempo privado/);
});
