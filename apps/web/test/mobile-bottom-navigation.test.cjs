const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const React = require('react');
const ts = require('typescript');
const { default: WebNavigation } = require('../app/mobile-bottom-navigation');

function nodes(tree) {
  if (!React.isValidElement(tree)) return [];
  return [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
}

const labels = ['Inicio', 'Mi cuenta', 'Elegir rol', 'Marketplace', 'Cartelera'];
test('web bottom navigation retains all five destinations before and after choosing a role', () => {
  for (const hasRole of [false, true]) {
    let welcomes = 0;
    const tree = WebNavigation({ pathname: '/', hasRole, disabled: false, onWelcome: () => welcomes++ });
    const controls = React.Children.toArray(tree.props.children);
    assert.deepEqual(controls.map(node => nodes(node).find(child => child.type === 'span').props.children), labels);
    assert.deepEqual(controls.map(node => node.props.href ?? '/'), ['/', '/account', '/', '/demo/marketplace', '/demo/events-map']);
    controls[0].props.onClick(); controls[2].props.onClick();
    assert.equal(welcomes, 2);
    assert.equal(controls.filter(node => node.props['aria-current'] === 'page').length, 1);
    assert.equal(controls[hasRole ? 0 : 2].props['aria-current'], 'page');
  }
});

test('web selection follows routes and busy navigation cannot be reached by keyboard', () => {
  for (const [pathname, index] of [['/profile', 1], ['/account', 1], ['/wallet', 1], ['/account/security', 1], ['/sports-sheet', 1], ['/sports-sheet/statistics', 1], ['/sports-sheet/career', 1], ['/demo/marketplace', 3], ['/demo/events-map', 4]]) {
    const tree = WebNavigation({ pathname, hasRole: false, disabled: true, onWelcome() {} });
    const controls = React.Children.toArray(tree.props.children);
    assert.equal(controls[index].props['aria-current'], 'page');
    for (const node of controls) {
      if (node.type === 'button') assert.equal(node.props.disabled, true);
      else { assert.equal(node.props['aria-disabled'], true); assert.equal(node.props.tabIndex, -1); }
    }
  }
});

function nativeNavigation() {
  const native = { Pressable: 'Pressable', SafeAreaView: 'SafeAreaView', Text: 'Text', View: 'View', StyleSheet: { create: value => value } };
  const source = readFileSync(join(__dirname, '../../mobile/bottom-navigation.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const imports = { '@playsport/shared': require('@playsport/shared'), 'react-native': native, 'react/jsx-runtime': require('react/jsx-runtime') };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => { assert.ok(name in imports, name); return imports[name]; }, module, module.exports);
  return module.exports.default;
}

test('native bottom navigation exposes the same five accessible tabs and correct selected/disabled states', () => {
  const NativeNavigation = nativeNavigation();
  for (const active of ['home', 'profile', 'roles', 'marketplace', 'events', null]) {
    const selected = [];
    const controls = nodes(NativeNavigation({ active, disabled: false, onSelect: id => selected.push(id) }))
      .filter(node => node.type === 'Pressable');
    assert.deepEqual(controls.map(node => node.props.accessibilityLabel), labels);
    for (const node of controls) node.props.onPress();
    assert.deepEqual(selected, ['home', 'profile', 'roles', 'marketplace', 'events']);
    assert.equal(controls.filter(node => node.props.accessibilityState.selected).length, active ? 1 : 0);
  }
  const controls = nodes(NativeNavigation({ active: 'roles', disabled: true, onSelect() {} })).filter(node => node.type === 'Pressable');
  assert.ok(controls.every(node => node.props.disabled && node.props.accessibilityState.disabled));
});
