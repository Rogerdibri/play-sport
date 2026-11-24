const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');

function mobileAccess(openURL = async () => {}) {
  const states = [];
  let stateIndex = 0;
  const native = {
    Linking: { openURL },
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
    StyleSheet: { create: (value) => value },
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    '@playsport/shared': require('@playsport/shared'),
    react: {
      useState: initial => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = value; }];
      },
    },
    'react-native': native,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './scoring-practice': { __esModule: true, default: props => jsx('ScoringPractice', props) },
  };
  const source = readFileSync(
    join(__dirname, '../../mobile/official-account-link.tsx'),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    module,
    module.exports,
  );
  const render = module.exports.default;
  module.exports.default = props => { stateIndex = 0; return render(props); };
  return module.exports;
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props.children].flat().flatMap(nodes)];
}

test('legacy mobile destinations retain authenticated official deep links for the chosen role', () => {
  const { officialAccountDestination: destination } = mobileAccess();
  for (const [moduleId, role, path] of [
    ['live-scoring', 'organizer', '/demo/live-scoring?view=organizer'],
    ['live-scoring', 'scorekeeper', '/demo/live-scoring?view=scorekeeper'],
    ['organizer-center', 'organizer', '/demo/organizer-center'],
    ['team-hq', 'manager', '/demo/roster'],
    ['manager-games', 'manager', '/demo/manager-games'],
    ['live-scoring', 'manager', '/demo/manager-games'],
  ]) {
    assert.equal(destination(moduleId, role).path, path);
  }
});

test('legacy destination helper does not fabricate official mutations for public or private modules', () => {
  const { officialAccountDestination: destination } = mobileAccess();
  for (const role of [
    'fan',
    'player',
    'manager',
    'organizer',
    'scorekeeper',
    'scout',
  ]) {
    for (const moduleId of [
      'events-map',
      'standings',
      'friendly-games',
      'tournaments',
      'marketplace',
    ]) {
      assert.equal(destination(moduleId, role), null);
    }
  }
  assert.equal(destination('live-scoring', 'fan'), null);
  assert.equal(destination('live-scoring', 'player'), null);
});

test('all mobile roles use the same authenticated sports sheet instead of a role-local personal page', () => {
  const { officialAccountDestination: destination } = mobileAccess();
  for (const role of ['fan', 'player', 'manager', 'organizer', 'scorekeeper', 'scout']) {
    assert.deepEqual(destination('player-career', role), { title: 'Mi hoja deportiva', path: '/sports-sheet' });
  }
});

test('mobile official access opens the exact configured URL and explains account permissions', async (t) => {
  const previous = process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN;
  t.after(() => {
    if (previous === undefined)
      delete process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN;
    else process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN = previous;
  });
  process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN = 'https://playsport.example/';
  let opened;
  const { default: Link, officialAccountDestination } = mobileAccess(
    async (url) => {
      opened = url;
    },
  );
  const tree = Link({
    destination: officialAccountDestination('live-scoring', 'scorekeeper'),
  });
  assert.match(
    JSON.stringify(tree),
    /Elegir un rol en el móvil no concede permisos/,
  );
  const button = nodes(tree).find((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'link');
  button.props.onPress();
  await new Promise(setImmediate);
  assert.equal(
    opened,
    'https://playsport.example/demo/live-scoring?view=scorekeeper',
  );
});

test('mobile official access reports an opening failure and clears it after a successful retry', async () => {
  let fails = true;
  const { default: Link, officialAccountDestination } = mobileAccess(
    async () => {
      if (fails) throw Error('Browser unavailable');
    },
  );
  const destination = officialAccountDestination('manager-games', 'manager');
  const render = () => Link({ destination });
  nodes(render())
    .find((node) => node.type === 'Pressable')
    .props.onPress();
  await new Promise(setImmediate);
  assert.ok(
    nodes(render()).some((node) => node.props.accessibilityRole === 'alert'),
  );
  fails = false;
  nodes(render())
    .find((node) => node.type === 'Pressable')
    .props.onPress();
  await new Promise(setImmediate);
  assert.ok(
    !nodes(render()).some((node) => node.props.accessibilityRole === 'alert'),
  );
});
