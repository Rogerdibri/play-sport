const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { newSportsSheet, newSportsRoleCard, readSportsSheet, readSportsSheetSnapshot,
  readPublicSportsSheet, projectPublicSportsSheet, platformRoles, platformModuleIds, sportsSheetDiscipline } = require('@playsport/shared');
const View = require('../app/sports-sheet/sports-sheet-view').default;
const Page = require('../app/sports-sheet/page').default;
const Example = require('../app/sports-sheet/example/page').default;
const doc = () => ({ ...newSportsSheet(), sportingName: 'Pelotero de ejemplo', city: 'Ciudad privada', sports: ['Softbol'],
  cards: [{ ...newSportsRoleCard('player'), positions: 'Campocorto', number: '12', bats: 'right', available: true }] });
test('sports sheet defaults are private, role cards are unique and manual achievements/statistics/permissions are not accepted', () => {
  assert.deepEqual(newSportsSheet().privacy, { published: false, city: false, photo: false, teams: false, availability: false });
  assert.deepEqual(readSportsSheet(doc()), doc());
  for (const patch of [{ achievements: [] }, { statistics: {} }, { teams: [] }, { identity: {} }, { permissions: ['admin'] }])
    assert.throws(() => readSportsSheet({ ...doc(), ...patch }));
  for (const patch of [{ sports: ['Unknown'] }, { sports: ['Softbol', 'Softbol'] }, { sportingName: 'a'.repeat(81) },
    { sportingName: 'Bad\nname' }, { cards: [newSportsRoleCard('admin')] }, { cards: [newSportsRoleCard('player'), newSportsRoleCard('player')] },
    { privacy: { ...newSportsSheet().privacy, published: 'true' } }, { cards: [{ ...newSportsRoleCard('player'), number: 'abc' }] }])
    assert.throws(() => readSportsSheet({ ...doc(), ...patch }));
});
test('public projection strips sensitive identity and nonpublic assignments, respects independent visibility switches and is immutable', () => {
  const document = doc();
  const identity = { name: 'Account name', photo: 'data:image/jpeg;base64,AAAA', verifiedIdentity: true, identification: 'PRIVATE' };
  const team = { role: 'player', tournamentId: 'cup', teamId: 'a', tournamentName: 'Copa', teamName: 'Equipo', leagueName: 'Liga', published: true };
  const before = JSON.stringify(document);
  const hidden = projectPublicSportsSheet(document, identity, [team]);
  assert.equal(hidden.city, '');
  assert.equal(hidden.photo, '');
  assert.equal('available' in hidden.cards[0], false);
  assert.deepEqual(hidden.teams, []);
  assert.equal('identification' in hidden, false);
  assert.deepEqual(readPublicSportsSheet(hidden), hidden);
  assert.equal(JSON.stringify(document), before);
  document.privacy = { published: true, city: true, photo: true, teams: true, availability: true };
  const full = projectPublicSportsSheet(document, identity, [team, { ...team, published: false, teamName: 'Privado' }]);
  assert.equal(full.teams.length, 1);
  assert.equal(full.cards[0].available, true);
  assert.equal(full.city, document.city);
  assert.equal(full.photo, identity.photo);
  assert.deepEqual(readPublicSportsSheet(full), full);
  assert.throws(() => readPublicSportsSheet({ ...full, email: 'private@example.test' }));
  assert.throws(() => readPublicSportsSheet({ ...full, cards: [{ ...full.cards[0], available: null }] }));
});
test('snapshots cannot load another account, malformed references or invalid membership data', () => {
  const snapshot = { accountId: 'owner', revision: 0, publicRef: null, document: doc(), teams: [] };
  assert.deepEqual(readSportsSheetSnapshot(snapshot, 'owner'), snapshot);
  assert.throws(() => readSportsSheetSnapshot(snapshot, 'other'));
  assert.throws(() => readSportsSheetSnapshot({ ...snapshot, publicRef: 'owner-identification' }, 'owner'));
  assert.throws(() => readSportsSheetSnapshot({ ...snapshot, teams: [{}] }, 'owner'));
});
test('every role has exactly one route to its account-wide sheet and unauthenticated visits do not show fabricated data', t => {
  for (const role of platformRoles) assert.equal(platformModuleIds(role.id).filter(id => id === 'player-career').length, 1);
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({ ready: true, account: null }));
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /Inicia sesión/);
  assert.match(html, /Disciplina:<\/strong> Béisbol \/ Softbol/);
  assert.doesNotMatch(html, /Pelotero|Campocorto|value=/);
});
test('the default discipline offers only its two sports and preserves saved selections from other disciplines', t => {
  assert.deepEqual(sportsSheetDiscipline, { label: 'Béisbol / Softbol', sports: ['Béisbol', 'Softbol'] });
  const document = { ...doc(), sports: ['Softbol', 'Fútbol'] };
  const snapshot = { accountId: 'owner', revision: 1, publicRef: null, document, teams: [] };
  const states = [snapshot, document, 0, false, false, '', ''];
  let index, tree;
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () =>
    ({ ready: true, account: { id: 'owner', displayName: 'Cuenta de ejemplo' }, registerNavigationBusy: () => () => {} }));
  t.mock.method(React, 'useState', initial => {
    const slot = index++;
    if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
    return [states[slot], next => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }];
  });
  function Capture() { const editor = Page(); tree = editor.type(editor.props); return tree; }
  const render = () => { index = 0; return renderToStaticMarkup(React.createElement(Capture)); };
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    return React.Children.toArray(node.props?.children).map(child => find(child, predicate)).find(Boolean) ?? null;
  };
  const html = render();
  assert.match(html, /Disciplina:<\/strong> Béisbol \/ Softbol/);
  assert.match(html, /Otros deportes guardados: Fútbol/);
  const sports = find(tree, node => node.type === 'fieldset' &&
    React.Children.toArray(node.props.children).some(child => child.type === 'legend' &&
      React.Children.toArray(child.props.children).join('').startsWith('Deportes de mi ficha')));
  const labels = React.Children.toArray(sports.props.children).filter(child => child.type === 'label');
  assert.deepEqual(labels.map(label => React.Children.toArray(label.props.children)[1]), ['Béisbol', 'Softbol']);
  const inputs = labels.map(label => React.Children.toArray(label.props.children)[0]);
  assert.deepEqual(inputs.map(input => input.props.checked), [false, true]);
  inputs[0].props.onChange({ target: { checked: true } }); render();
  assert.deepEqual(states[1].sports, ['Softbol', 'Fútbol', 'Béisbol']);
  const softballLabel = find(tree, node => node.type === 'label' &&
    React.Children.toArray(node.props.children)[1] === 'Softbol');
  React.Children.toArray(softballLabel.props.children)[0].props.onChange({ target: { checked: false } });
  assert.deepEqual(states[1].sports, ['Fútbol', 'Béisbol']);
  assert.deepEqual(document.sports, ['Softbol', 'Fútbol']);
});
test('preview renders multiple roles and availability without an awards editor or private fields', () => {
  const document = doc();
  document.cards.push({ ...newSportsRoleCard('manager'), specialty: 'Formación' });
  document.privacy.availability = true;
  const view = projectPublicSportsSheet(document, { name: 'Name', verifiedIdentity: false }, []);
  const html = renderToStaticMarkup(React.createElement(View, { sheet: view }));
  assert.match(html, /Jugador/); assert.match(html, /Manager/); assert.match(html, /Busco equipo/);
  assert.match(html, /Campocorto/); assert.match(html, /Derecha/);
  assert.doesNotMatch(html, /Ciudad privada|Identidad verificada|<input|MVP|Campeón/);
  const example = renderToStaticMarkup(React.createElement(Example));
  assert.match(example, /Ejemplo/); assert.match(example, /Guardianes del Lago/);
  assert.doesNotMatch(example, /<input|<form/);
});
