const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { readGameReportPrintRequest } = require('@playsport/shared');

function fixture() {
  const refs = [], errors = [], prints = [], injections = [];
  const WebView = 'WebView';
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const source = ts.transpileModule(readFileSync(join(__dirname, '../App.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react') return { useEffect() {}, useRef(value) { const ref = { current: value }; refs.push(ref); return ref; },
      useState(value) { return [value, next => errors.push(next)]; } };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { SafeAreaView: 'SafeAreaView', View: 'View', Text: 'Text',
      StyleSheet: { create: value => value } };
    if (name === 'react-native-webview') return { WebView };
    if (name === 'expo-constants') return { expoConfig: { hostUri: 'localhost:8083' } };
    if (name === '@react-native-async-storage/async-storage') return {};
    if (name === 'expo-print') return { printAsync: async value => prints.push(value) };
    if (name === '@playsport/shared') return { readGameReportPrintRequest };
    if (name === './application-origin') return require('../application-origin');
    throw new Error(`Unexpected import ${name}`);
  }, process: { env: {} }, __DEV__: true, URL, Error, JSON });
  const root = exports.default();
  refs[0].current = { injectJavaScript: value => injections.push(value) };
  const find = node => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === WebView) return node;
    for (const child of [].concat(node.props?.children ?? [])) { const found = find(child); if (found) return found; }
    return null;
  };
  const view = find(root);
  assert.ok(view);
  const message = async (data, origin = 'http://localhost:3000/demo/scoring-practice') => {
    view.props.onMessage({ nativeEvent: { data: JSON.stringify(data), url: origin } });
    await new Promise(resolve => setImmediate(resolve));
  };
  return { message, prints, injections, errors };
}
test('native report printing uses the current WebView report locally and acknowledges the matching request', async () => {
  const e = fixture();
  const request = { type: 'playsport:print-report', requestId: 1, html: '<!doctype html><html><body>Resumen 3–2</body></html>' };
  await e.message(request);
  assert.equal(e.prints.length, 1); assert.equal(e.prints[0].html, request.html);
  assert.equal(e.prints[0].orientation, 'landscape');
  assert.match(e.injections[0], /playsport:print-result/); assert.match(e.injections[0], /"ok":true/);
});
test('native printing rejects foreign origins and malformed or active HTML without invoking the printer', async () => {
  const e = fixture(), request = { type: 'playsport:print-report', requestId: 1,
    html: '<!doctype html><html><body>Resumen</body></html>' };
  await e.message(request, 'https://foreign.example.test');
  await e.message({ ...request, html: '<!doctype html><script>alert(1)</script>' });
  await e.message({ ...request, requestId: -1 });
  assert.equal(e.prints.length, 0); assert.equal(e.injections.length, 0);
  assert.ok(e.errors.some(error => typeof error === 'string' && error.includes('PlaySport')));
  assert.throws(() => readGameReportPrintRequest({ ...request, html: 'x'.repeat(2000001) }), /inválida/);
});
