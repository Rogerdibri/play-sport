const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const nativePath = require.resolve('react-native');
const element = tag => ({ children, accessibilityRole }) => React.createElement(tag, { role: accessibilityRole }, children);
const native = { Text: element('span'), View: element('div'), Pressable: element('button'),
  StyleSheet: { create: styles => styles }, Linking: { openURL: async () => {} } };
require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true, exports: native };
const Chat = require('../match-chat-link').default;
test('mobile keeps the match chat folded and does not create its own fake account session', () => {
  const html = renderToStaticMarkup(React.createElement(Chat, { gameId: 'game' }));
  assert.match(html, /Chat del partido/);
  assert.doesNotMatch(html, /sesión de cuenta|<input/);
  const source = readFileSync(require.resolve('../App'), 'utf8');
  assert.doesNotMatch(source, /id: 'news'|'news',/);
});
test('mobile opens the web chat for the exact selected match only after user action', async t => {
  let url;
  t.mock.method(React, 'useState', value => typeof value === 'boolean' ? [true, () => {}] : [value, () => {}]);
  t.mock.method(native.Linking, 'openURL', async value => { url = value; });
  const tree = Chat({ gameId: 'game:selected' });
  const controls = [];
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (node.type === native.Pressable) controls.push(node);
    React.Children.forEach(node.props.children, visit);
  }
  visit(tree);
  assert.equal(url, undefined);
  controls.at(-1).props.onPress();
  await Promise.resolve();
  assert.match(url, /official=game%3Aselected#chat-del-partido$/);
});
