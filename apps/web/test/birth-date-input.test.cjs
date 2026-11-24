const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const runtime = require('react/jsx-runtime');
const BirthDateInput = require('../app/birth-date-input').default;
function setup(t) {
  const createElement = React.createElement, refs = [];
  let inputs = [], value = '', focused = -1, selected = -1;
  t.mock.method(React, 'useRef', () => {
    const index = refs.length, ref = { current: { focus() { focused = index % 3; }, select() { selected = index % 3; }, setCustomValidity() {} } };
    refs.push(ref); return ref;
  });
  for (const name of ['jsx','jsxs']) {
    const original = runtime[name];
    t.mock.method(runtime,name,(type,props,...rest)=>{
      if(type==='input')inputs.push(props);
      return original(type,props,...rest);
    });
  }
  const render = (next = value, disabled = false) => {
    value = next; inputs = [];
    return renderToStaticMarkup(createElement(BirthDateInput, { label: 'Nacimiento de prueba', value, disabled, onChange(next) { value = next; } }));
  };
  const input = (index, text) => { inputs[index].onChange({ currentTarget: { value: text } }); };
  return { render, input, inputs: () => inputs, value: () => value, focused: () => focused, selected: () => selected };
}
test('birth date entry advances day to month to year without saving or leaving the year', t => {
  const e = setup(t); e.render();
  e.input(0, '1'); assert.equal(e.focused(), -1);
  e.render(); e.input(0, '12'); assert.equal(e.focused(), 1); assert.equal(e.selected(), 1);
  e.render(); e.input(1, '03'); assert.equal(e.focused(), 2);
  e.render(); e.input(2, '1990'); assert.equal(e.focused(), 2); assert.equal(e.value(), '1990-03-12');
});
test('invalid days and months do not auto-advance and expose errors', t => {
  const e = setup(t); e.render(); e.input(0, '32'); assert.equal(e.focused(), -1);
  assert.match(e.render(), /role="alert"/);
  e.render('1990--12'); e.input(1, '13'); assert.equal(e.focused(), -1);
  assert.match(e.render(), /un mes entre 01 y 12/);
});
test('unambiguous single-digit days and months advance with a leading zero', t => {
  const e=setup(t);e.render();e.input(0,'5');assert.equal(e.value(),'--05');assert.equal(e.focused(),1);
  e.render();e.input(1,'3');assert.equal(e.value(),'-03-05');assert.equal(e.focused(),2);
});
test('existing ISO dates and incomplete drafts retain their parts without day/month reversal', t => {
  const e = setup(t); e.render('2015-03-20');
  assert.deepEqual(e.inputs().map(input => input.value), ['20','03','2015']);
  e.render('--12'); assert.deepEqual(e.inputs().map(input => input.value), ['12','','']);
  assert.match(e.render('1990-02-31'), /fecha real/);
  assert.doesNotMatch(e.render('2000-02-29'), /role="alert"/);
  assert.match(e.render('1999-02-29'), /fecha real/);
});
test('single digit blur pads the segment and backspace on an empty segment selects its predecessor', t => {
  const e = setup(t); e.render('1990-03-7');
  e.inputs()[0].onBlur({ currentTarget: { value: '7' } }); assert.equal(e.value(), '1990-03-07');
  e.render('1990--07');
  let prevented = false;
  e.inputs()[1].onKeyDown({ key:'Backspace', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(e.focused(), 0); assert.equal(e.selected(), 0);
});
test('whole-date paste accepts local and ISO formats without losing a prefilled date', t => {
  const e = setup(t); e.render();
  for (const text of ['12/03/1990','1990-03-12']) {
    let prevented = false;
    e.inputs()[0].onPaste({ clipboardData: { getData() { return text; } }, preventDefault() { prevented = true; } });
    assert.equal(prevented,true); assert.equal(e.value(),'1990-03-12'); assert.equal(e.focused(),2);
  }
});
test('date segments remain labelled, numeric, required and governed by the parent disabled state', t => {
  const e = setup(t), html = e.render('',true);
  assert.match(html, /<fieldset[^>]*disabled/);
  assert.deepEqual(e.inputs().map(input => input['aria-label']), ['Nacimiento de prueba: día','Nacimiento de prueba: mes','Nacimiento de prueba: año']);
  assert.ok(e.inputs().every(input => input.required && input.inputMode === 'numeric'));
  assert.deepEqual(e.inputs().map(input => input.maxLength), [2,2,4]);
});
