const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const element = tag => ({ children, onPress, disabled }) =>
  React.createElement(tag, { onClick: onPress, disabled }, children);
const nativePath = require.resolve('react-native');
require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true, exports: {
  Text: element('span'), View: element('div'), Pressable: element('button'), StyleSheet: { create: styles => styles }
} };
const { default: Clock, readGameClockOffset } = require('../game-clock');
const render = props => renderToStaticMarkup(React.createElement(Clock, { finished: false, ...props }));
test('native clock is read-only without permission and retains a paused final duration', () => {
  const clock = { startedAt: '2026-11-13T01:00:00.000Z', runningSince: null, elapsedMs: 125000 };
  assert.match(render({ onAction() {} }), /INICIAR TIEMPO/);
  assert.doesNotMatch(render({}), /<button/);
  assert.match(render({ clock, onAction() {} }), /Reanudar tiempo/);
  assert.match(render({ clock: { ...clock, runningSince: clock.startedAt }, onAction() {} }), /Pausar tiempo/);
  assert.match(render({ clock, finished: true }), /00:02:05/);
  assert.doesNotMatch(render({ clock, finished: true, onAction() {} }), /<button/);
  assert.match(render({ finished: true }), /—/);
  assert.match(render({ disabled: true, onAction() {} }), /disabled=""/);
});
test('native observers compensate device clock differences and reject malformed server times', t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-13T01:15:00.000Z'));
  assert.equal(readGameClockOffset({ serverTime: '2026-11-13T01:00:00.000Z' }), -900000);
  assert.equal(readGameClockOffset({}), 0);
  assert.throws(() => readGameClockOffset({ serverTime: 'invalid' }), /hora del servidor/);
});
