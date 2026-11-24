const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Shortcuts = require('../app/demo/[slug]/calendar-date-shortcuts').default;
const RealDate = Date;

test('calendar shortcuts use the current Venezuela day, not the selected date, across month and year boundaries', t => {
  let now = '2026-11-13T02:00:00Z';
  t.mock.method(globalThis, 'Date', class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
  });
  let selected;
  const buttons = date => Shortcuts({ date, onChange(value) { selected = value; } }).props.children;
  let options = buttons('1952-02-29');
  assert.deepEqual(options.map(button => button.props.children), ['Ayer', 'Hoy', 'Mañana']);
  assert.ok(options.every(button => button.props['aria-pressed'] === false));
  for (const [index, expected] of ['2026-11-11', '2026-11-12', '2026-11-13'].entries()) {
    options[index].props.onClick();
    assert.equal(selected, expected);
    assert.equal(buttons(selected)[index].props['aria-pressed'], true);
  }
  now = '2024-03-01T04:00:00Z';
  options = buttons(null);
  options[0].props.onClick();
  assert.equal(selected, '2024-02-29');
  now = '2026-12-31T12:00:00Z';
  options[2].props.onClick();
  assert.equal(selected, '2027-01-01');
  const markup = renderToStaticMarkup(React.createElement(Shortcuts, { date: '2026-12-31', onChange() {} }));
  assert.match(markup, /role="group" aria-label="Fechas rápidas"/);
  assert.match(markup, /aria-pressed="true">Hoy/);
});
