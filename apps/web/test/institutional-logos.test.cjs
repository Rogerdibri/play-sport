const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  InstitutionName, InstitutionLogoTrigger, InstitutionLogoEditingContext, institutionLogoUrl
} = require('../app/institutional-logos');
const { readInstitutionLogoChange, readInstitutionLogos, platformRoles } = require('@playsport/shared');
const { GET, POST } = require('../app/api/institutional-logos/route');
const image = require('../app/api/institutional-logos/[action]/route');
const entity = { kind: 'team', id: 'team-A', name: 'Equipo ficticio', hasLogo: true, revision: 1 };
const withAccess = (node, entities) => React.createElement(
  InstitutionLogoEditingContext.Provider, { value: { entities, open() {} } }, node
);
test('shared names preserve ordinary text without logos and render only the exact stable identity logo', (t) => {
  const render = (props) => renderToStaticMarkup(React.createElement(InstitutionName, props, 'Equipo ficticio'));
  assert.equal(render({ id: 'team-A' }), 'Equipo ficticio');
  t.mock.method(React, 'useContext', (context) => context === InstitutionLogoEditingContext
    ? null : [entity, { ...entity, kind: 'tournament', id: 'cup' }]);
  assert.match(render({ id: 'team-A' }), /Logo de Equipo ficticio/);
  assert.match(render({ id: 'team-A' }), /revision=1/);
  assert.equal(render({ id: 'another' }), 'Equipo ficticio');
  assert.equal(render({}), 'Equipo ficticio');
  assert.equal(render({ kind: 'tournament', id: 'team-A' }), 'Equipo ficticio');
  assert.match(institutionLogoUrl({ ...entity, id: 'id with space&other' }), /id=id\+with\+space%26other/);
});
test('public logo metadata supports independent leagues and rejects duplicate or invalid identities', () => {
  assert.deepEqual(readInstitutionLogos([entity]), [entity]);
  assert.deepEqual(readInstitutionLogos([{ ...entity, kind: 'league' }]), [{ ...entity, kind: 'league' }]);
  for (const value of [
    [entity, entity],
    [{ ...entity, revision: 0 }],
    [{ ...entity, kind: 'club' }],
    [{ ...entity, hasLogo: 'yes' }]
  ])
    assert.throws(() => readInstitutionLogos(value));
  const input = {
    requestId: '12345678-1234-1234-1234-123456789abc',
    expectedAccountId: '12345678-1234-1234-1234-123456789abc',
    expectedRevision: 0,
    role: 'manager',
    actorId: 'mgr-A',
    kind: 'team',
    id: 'team-A',
    logo: ''
  };
  assert.deepEqual(readInstitutionLogoChange(input), input);
  for (const patch of [
    { role: 'fan' },
    { ownerAccountId: input.expectedAccountId },
    { expectedRevision: Number.MAX_SAFE_INTEGER },
    { logo: 'data:image/svg+xml;base64,AAAA' }
  ])
    assert.throws(() => readInstitutionLogoChange({ ...input, ...patch }));
});
test('same-origin logo proxy keeps original session/origin and bounded body, and refuses unsupported query/image requests', async (t) => {
  let forwarded;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    forwarded = { url, options };
    return new Response(JSON.stringify({ entities: [entity] }));
  });
  const response = await POST(
    new NextRequest('http://localhost:3000/api/institutional-logos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'playsport-account=opaque',
        Origin: 'http://localhost:3000'
      },
      body: '{}'
    })
  );
  assert.equal(response.status, 200);
  assert.equal(forwarded.options.headers.get('cookie'), 'playsport-account=opaque');
  assert.equal(forwarded.options.headers.get('origin'), 'http://localhost:3000');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(
    (
      await POST(
        new NextRequest('http://localhost:3000/api/institutional-logos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'x'.repeat(92161)
        })
      )
    ).status,
    413
  );
  assert.equal((await GET(new NextRequest('http://localhost:3000/api/institutional-logos?role=manager'))).status, 400);
  assert.equal(
    (
      await image.GET(
        new NextRequest(
          'http://localhost:3000/api/institutional-logos/image?kind=team&id=team-A&revision=1&revision=2'
        ),
        { params: Promise.resolve({ action: 'image' }) }
      )
    ).status,
    400
  );
  assert.equal(
    (
      await image.GET(
        new NextRequest('http://localhost:3000/api/institutional-logos/image?kind=club&id=x&revision=1'),
        { params: Promise.resolve({ action: 'image' }) }
      )
    ).status,
    400
  );
});
test('all official identity surfaces use shared logos, while account photos, private friendly names and pending commands stay distinct', () => {
  for (const path of [
    'page.tsx',
    'demo/[slug]/official-calendar.tsx',
    'demo/[slug]/official-standings.tsx',
    'demo/[slug]/official-result.tsx',
    'demo/[slug]/official-game-details.tsx',
    'demo/[slug]/manager-roster.tsx',
    'demo/[slug]/live-scoring-manager-demo.tsx',
    'demo/[slug]/private-scorecard-view.tsx',
    'demo/[slug]/team-sheets.tsx',
    'demo/[slug]/team-sheet-inbox.tsx',
    'demo/[slug]/game-protest-panel.tsx',
    'demo/betting-preview/preview.tsx'
  ])
    assert.match(readFileSync(join(__dirname, '../app', path), 'utf8'), /InstitutionName/);
  assert.match(readFileSync(join(__dirname, '../app/platform-session.tsx'), 'utf8'), /SessionIdentity/);
  const editor = readFileSync(join(__dirname, '../app/institution-logo-editor.tsx'), 'utf8');
  assert.match(editor, /expectedAccountId:\s*accountId/);
  assert.match(editor, /readInstitutionLogoChange\(JSON.parse\(saved\)\)/);
  assert.match(editor, /globalThis.sessionStorage/);
  assert.match(editor, /Confirmar cambio pendiente/);
  assert.match(editor, /file.type\s*===\s*'image\/jpeg'\s*\?\s*'image\/jpeg'\s*:\s*'image\/png'/);
  assert.doesNotMatch(editor, /account-photo-pending|financialAccess: true/);
});
test('an editable empty logo has a keyboard accessible target without making the name a button', () => {
  const html = renderToStaticMarkup(
    withAccess(React.createElement(InstitutionName, { kind: 'league', id: 'league-one' }, 'Liga ficticia'),
      [{ ...entity, kind: 'league', id: 'league-one', name: 'Liga ficticia', hasLogo: false, revision: 0 }])
  );
  assert.match(html, /aria-label="Cambiar logo de Liga ficticia"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /institutionLogoPlaceholder/);
  assert.match(html, /role="button"/);
  assert.match(html, /<\/span><span>Liga ficticia<\/span>/);
  assert.doesNotMatch(html, /<button/);
  const saved = renderToStaticMarkup(
    withAccess(React.createElement(
      InstitutionName,
      {
        kind: 'league',
        id: 'league-one',
        logoEntity: { ...entity, kind: 'league', id: 'league-one', name: 'Liga ficticia' }
      },
      'Liga ficticia'
    ), [{ ...entity, kind: 'league', id: 'league-one', name: 'Liga ficticia' }])
  );
  assert.match(saved, /Logo de Liga ficticia/);
  assert.match(saved, /kind=league/);
});
test('manager inscriptions edit their own team logo in place without a separate logos link and respect submission locks', (t) => {
  const platformSession = require('../app/platform-session');
  const ManagerInscriptions = require('../app/manager-inscriptions').default;
  const item = {
    tournamentId: 'cup-one',
    tournamentName: 'Copa ficticia',
    teamId: 'inscription-one',
    teamName: 'Equipo ficticio',
    managerId: 'person:manager',
    revision: 1,
    status: 'pending',
    rosterStatus: 'pending',
    enrollment: { status: 'draft', contact: '', notes: '', submittedAt: '', reviewNotes: '' }
  };
  let state = 0;
  t.mock.method(React, 'useState', (initial) => [
    state++ === 0 ? [item] : typeof initial === 'function' ? initial() : initial,
    () => {}
  ]);
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    session: { role: 'manager' },
    account: { id: 'manager-account', identity: { status: 'verified', actorId: item.managerId } }
  }));
  for (const [status, enrollment, editable] of [
    ['pending', 'invited', true],
    ['pending', 'draft', true],
    ['pending', 'changes-requested', true],
    ['pending', 'submitted', false],
    ['accepted', 'submitted', false],
    ['withdrawn', 'draft', false]
  ]) {
    item.status = status;
    item.enrollment.status = enrollment;
    state = 0;
    const html = renderToStaticMarkup(withAccess(React.createElement(ManagerInscriptions),
      [{ ...entity, id: item.teamId, hasLogo: false, revision: 0 }]));
    if (editable) {
      assert.match(html, /aria-label="Cambiar logo de Equipo ficticio"/);
      assert.match(html, /institutionLogoPlaceholder/);
    } else assert.doesNotMatch(html, /institutionLogoTrigger|Cambiar logo/);
    assert.doesNotMatch(html, /href="\/identity"/);
    assert.match(html, /Preparar roster y personal técnico/);
  }
});
test('manager work-team logo editing remains available while the consultation context loads, without a separate logos action', (t) => {
  const platformSession = require('../app/platform-session');
  const Home = require('../app/page').default;
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    ready: true,
    session: {
      version: 1,
      role: 'manager',
      team: 'team-A',
      workTeamId: 'inscription-one',
      workTournamentId: 'cup-one',
      workTeamName: 'Equipo ficticio',
      workManagerId: 'person:manager'
    },
    account: {
      id: 'manager-account',
      displayName: 'Manager ficticio',
      identity: { status: 'verified', actorId: 'person:manager' }
    }
  }));
  const html = renderToStaticMarkup(withAccess(React.createElement(Home),
    [{ ...entity, id: 'inscription-one', hasLogo: false, revision: 0 }]));
  assert.match(html, /Cambiar logo de Equipo ficticio/);
  assert.doesNotMatch(html, /href="\/identity"/);
  assert.match(html, /href="\/demo\/events-map"/);
});
test('a locked inscription still displays its authorized private logo without allowing changes', () => {
  const { EditableInstitutionName } = require('../app/institution-logo-editor');
  const html = renderToStaticMarkup(withAccess(
    React.createElement(EditableInstitutionName, { kind: 'team', id: entity.id, editable: false }, entity.name),
    [entity]
  ));
  assert.match(html, /Logo de Equipo ficticio/);
  assert.match(html, /revision=1/);
  assert.doesNotMatch(html, /Cambiar logo|<button/);
});
test('only the exact managed identity offers editing; public and same-name identities stay read-only', () => {
  for (const props of [{ id: 'foreign-team' }, { kind: 'tournament', id: entity.id }, { id: entity.id, editable: false }, {}]) {
    const html = renderToStaticMarkup(withAccess(
      React.createElement(InstitutionName, props, entity.name), [entity]
    ));
    assert.doesNotMatch(html, /institutionLogoTrigger|Cambiar logo/);
  }
});
test('logo press requires 600ms, suppresses the release click, and cancels short or interrupted gestures', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(React, 'useRef', (initial) => ({ current: initial }));
  t.mock.method(React, 'useState', (initial) => [initial, () => {}]);
  t.mock.method(React, 'useEffect', () => {});
  t.mock.method(React, 'useCallback', (callback) => callback);
  let opened = 0, prevented = 0, stopped = 0;
  const { props } = InstitutionLogoTrigger({ name: entity.name, onEdit: () => opened++, children: '+' });
  const pointer = { isPrimary: true, button: 0, clientX: 20, clientY: 20 };
  const click = { preventDefault: () => prevented++, stopPropagation: () => stopped++ };
  props.onPointerDown(pointer);
  t.mock.timers.tick(599);
  assert.equal(opened, 0);
  t.mock.timers.tick(1);
  assert.equal(opened, 1);
  t.mock.timers.tick(600);
  assert.equal(opened, 1);
  props.onPointerUp();
  props.onClickCapture(click);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  props.onPointerDown(pointer);
  t.mock.timers.tick(599);
  props.onPointerUp();
  t.mock.timers.tick(1);
  props.onClickCapture(click);
  assert.equal(opened, 1);
  assert.equal(prevented, 1);
  for (const cancel of ['onPointerLeave', 'onPointerCancel', 'onBlur']) {
    props.onPointerDown(pointer);
    t.mock.timers.tick(200);
    props[cancel]();
    t.mock.timers.tick(600);
    assert.equal(opened, 1, cancel);
  }
  props.onPointerDown(pointer);
  props.onPointerMove({ clientX: 31, clientY: 20 });
  t.mock.timers.tick(600);
  assert.equal(opened, 1);
  for (const patch of [{ button: 2 }, { isPrimary: false }]) {
    props.onPointerDown({ ...pointer, ...patch });
    t.mock.timers.tick(600);
    assert.equal(opened, 1);
  }
  for (const key of ['Enter', ' ']) {
    const expected = opened + 1;
    props.onKeyDown({ key, repeat: false, ...click });
    assert.equal(opened, expected);
    props.onKeyDown({ key, repeat: true, ...click });
    assert.equal(opened, expected);
  }
});
function editingHarness(t, profile = { localTestAccess: true }, role = 'manager') {
  const { InstitutionLogoEditing } = require('../app/institution-logo-editor');
  const platformSession = require('../app/platform-session');
  let access = { session: { version: 1, role, team: 'team-A' }, account: { id: 'owner-account', ...profile } };
  t.mock.method(platformSession, 'usePlatformSession', () => access);
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: { activeElement: null, body: {} }, configurable: true });
  t.after(() => document ? Object.defineProperty(globalThis, 'document', document) : Reflect.deleteProperty(globalThis, 'document'));
  t.mock.method(require('react-dom'), 'createPortal', (node) => node);
  const states = [], refs = [];
  let index = 0, refIndex = 0, effects = [], requests = [];
  t.mock.method(React, 'useState', (initial) => {
    const key = index++;
    if (!(key in states)) states[key] = initial;
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
  });
  t.mock.method(React, 'useRef', (initial) => {
    const key = refIndex++;
    return refs[key] ?? (refs[key] = { current: initial });
  });
  t.mock.method(React, 'useEffect', (effect, deps) => effects.push({ effect, deps }));
  const render = () => {
    index = 0; refIndex = 0; effects = [];
    return InstitutionLogoEditing({ children: 'Screen content' });
  };
  const load = async (body, status = 200) => {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify(body), { status });
    });
    render();
    const cleanup = effects.find(({ deps }) => deps.length === 6).effect();
    await new Promise(resolve => setImmediate(resolve));
    cleanup?.();
    return render();
  };
  return { render, load, requests, change: (next) => { access = next; } };
}
const descendants = (node) => {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(descendants);
  return [node, ...descendants(node.props?.children)];
};
test('managed metadata is checked against the account, confirms before editing and disappears immediately on role/account changes', async (t) => {
  const e = editingHarness(t);
  let tree = await e.load({ accountId: 'owner-account', entities: [entity] });
  assert.match(e.requests[0].url, /manage\?role=manager&actorId=mgr-A/);
  assert.equal(e.requests[0].options.cache, 'no-store');
  assert.deepEqual(tree.props.value.entities, [entity]);
  tree.props.value.open(entity);
  tree = e.render();
  assert.equal(descendants(tree).find(node => node.type === 'h2').props.children, '¿Deseas cambiar el logo?');
  assert.equal(descendants(tree).some(node => node.type?.name === 'LogoEditor'), false);
  descendants(tree).find(node => node.type === 'button' && node.props.children === 'Cancelar').props.onClick();
  assert.equal(descendants(e.render()).some(node => node.type === 'dialog'), false);
  e.render().props.value.open(entity);
  descendants(e.render()).find(node => node.type === 'button' && node.props.children === 'Cambiar logo').props.onClick();
  const editor = descendants(e.render()).find(node => node.type?.name === 'LogoEditor');
  assert.deepEqual(editor.props.entity, entity);
  assert.equal(editor.props.accountId, 'owner-account');
  e.change({ session: { role: 'organizer' }, account: { id: 'owner-account', localTestAccess: true } });
  tree = e.render();
  assert.deepEqual(tree.props.value.entities, []);
  assert.equal(descendants(tree).some(node => node.type === 'dialog'), false);
  e.change({ session: { role: 'manager', team: 'team-A' }, account: { id: 'different-account', localTestAccess: true } });
  assert.deepEqual(e.render().props.value.entities, []);
  tree = await e.load({ accountId: 'owner-account', entities: [entity] });
  assert.deepEqual(tree.props.value.entities, []);
  assert.ok(descendants(tree).some(node => node.props?.role === 'alert'));
});
test('failed permission requests surface errors and never expose editing', async (t) => {
  const e = editingHarness(t);
  const tree = await e.load({ message: 'No administras este equipo.' }, 403);
  assert.deepEqual(tree.props.value.entities, []);
  assert.match(descendants(tree).find(node => node.props?.role === 'alert').props.children[0], /No administras/);
});
test('a verified organizer can edit only the exact leagues and tournaments returned for their identity', async (t) => {
  const e = editingHarness(t, { identity: { status: 'verified', actorId: 'person:organizer' } }, 'organizer');
  const league = { ...entity, kind: 'league', id: 'league-one', name: 'Liga de prueba', hasLogo: false, revision: 0 };
  const tournament = { ...league, kind: 'tournament', id: 'cup-one', name: 'Copa de prueba' };
  const tree = await e.load({ accountId: 'owner-account', entities: [league, tournament] });
  assert.match(e.requests[0].url, /role=organizer&actorId=person%3Aorganizer/);
  assert.deepEqual(tree.props.value.entities, [league, tournament]);
  tree.props.value.open(league);
  assert.equal(descendants(e.render()).find(node => node.type === 'p').props.children, league.name);
});
test('a role alone never grants editing, and unrelated roles never request management permissions', async (t) => {
  for (const [role, profile] of [
    ['manager', {}], ['organizer', {}],
    ...platformRoles.filter(({ id }) => !['manager', 'organizer'].includes(id)).map(({ id }) => [id, { localTestAccess: true }])
  ]) await t.test(role, async child => {
    const e = editingHarness(child, profile, role);
    const tree = await e.load({ accountId: 'owner-account', entities: [entity] });
    assert.equal(e.requests.length, 0);
    assert.deepEqual(tree.props.value.entities, []);
  });
});
