const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const {
  platformRoles,
  isTeamSportsRole,
  playerDemoMemberships,
  playerDemoTournaments,
  playerTeamPreference,
  demoProfileLocation,
} = require('@playsport/shared');
const {
  demoModules,
  demoModuleHref,
  moduleStatusLabels,
  sessionIdentityLabel,
} = require('../app/platform-navigation');
const platformSession = require('../app/platform-session');
const HomePage = require('../app/page').default;

function render(t, session = null, account = null, clear = () => {}) {
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    session,
    account,
    ready: true,
    enter() {},
    clear,
    reportNavigationError() {},
    registerScreenBack: () => () => {},
  }));
  const team = playerDemoMemberships[0];
  t.mock.method(
    require('../app/player-sports-context'),
    'usePlayerSports',
    () =>
      isTeamSportsRole(session?.role)
        ? {
            role: session.role,
            ready: true,
            demo: true,
            error: '',
            notice: '',
            teams: playerDemoMemberships,
            tournaments: playerDemoTournaments,
            profile: demoProfileLocation,
            preference: playerTeamPreference(team, demoProfileLocation),
            selectedTeam: team,
            chooseTeam() {},
            updateFilter() {},
            refresh() {},
          }
        : null,
  );
  return renderToStaticMarkup(createElement(HomePage));
}
test('sports highlights appear only after choosing a role, with existing tools still present', (t) => {
  assert.doesNotMatch(render(t), /Tu jornada deportiva/);
  for (const role of platformRoles) {
    const html = render(t, { version: 1, role: role.id, team: 'team-A' });
    assert.ok(html.includes('Tu jornada deportiva'));
    assert.ok(html.indexOf('Módulos de tu rol') < html.indexOf('Tu jornada deportiva'));
  }
});
test('role homes leave the root Back action to the platform navigator instead of registering a second fallback', (t) => {
  const backs = [];
  t.mock.method(require('../app/navigation-hooks'), 'useScreenBack', (action, active, priority = 1) => {
    backs.push({ action, active, priority });
  });
  for (const { id } of platformRoles) {
    backs.length = 0;
    render(t, { version: 1, role: id, team: 'team-A' });
    assert.equal(backs.some(item => item.priority === 0), false, id);
    assert.equal(backs.some(item => item.active), false, id);
  }
  backs.length = 0;
  render(t);
  assert.equal(backs.some(item => item.active), false);
});
test('manager team selection keeps its own back action before the role-home fallback', (t) => {
  const backs = [];
  let closed = false;
  t.mock.method(React, 'useState', initial => [
    initial === false ? true : initial,
    value => { if (initial === false && value === false) closed = true; },
  ]);
  t.mock.method(require('../app/navigation-hooks'), 'useScreenBack', (action, active, priority = 1) => {
    backs.push({ action, active, priority });
  });
  render(t, { version: 1, role: 'manager', team: 'team-A' });
  assert.equal(backs.some(item => item.priority === 0), false);
  const back = backs.find(item => item.active);
  assert.ok(back.priority > 0);
  back.action();
  assert.equal(closed, true);
});
test('identity uses the same saved person name across all six roles, never a team or technical account ID', (t) => {
  const account = { id: 'account-owner', displayName: 'Apodo público', identity: { fullName: 'María Pérez' } };
  for (const role of platformRoles) {
    const session = { version: 1, role: role.id, team: 'team-A' };
    const label = `María Pérez · ${role.label}`;
    assert.equal(sessionIdentityLabel(session, account, 'Otra persona'), label);
    const html = render(t, session, account);
    assert.ok(html.includes(`<p class="eyebrow">${label}</p>`));
    assert.doesNotMatch(html, /Cuenta ficticia|EQUIPOS DE DEMOSTRACIÓN|INICIO DE TRABAJO · DEMOSTRACIÓN|Recorrido de ejemplo/);
  }
});
test('identity does not invent a name or leak another account when the profile is incomplete', () => {
  const session = { version: 1, role: 'player', team: 'team-A' };
  assert.equal(sessionIdentityLabel(session, null, '  Ana Rojas  '), 'Ana Rojas · Jugador');
  assert.equal(sessionIdentityLabel(session, { displayName: 'Luis Soto' }), 'Luis Soto · Jugador');
  assert.equal(sessionIdentityLabel(session, null), 'Mi perfil · Jugador');
});
test('welcome renders six direct role buttons with no radio selection, form or confirm button', (t) => {
  const html = render(t);
  assert.equal(
    (html.match(/<button[^>]*aria-label="Entrar como /g) ?? []).length,
    6,
  );
  for (const role of platformRoles)
    assert.ok(html.includes(`aria-label="Entrar como ${role.label}"`));
  assert.equal(
    /type="radio"|<form|type="submit"|Selecciona un rol para continuar/.test(
      html,
    ),
    false,
  );
  assert.ok(html.includes('Ubicación de la cuenta'));
  assert.ok(html.includes('Mi perfil reúne tus datos personales'));
});
test('account access has its own action row below the welcome text', (t) => {
  const html = render(t);
  assert.match(
    html,
    /<p class="heroLead">[^<]+<\/p><div class="ctaRow"><a class="cta managerButtonSolid" href="\/account">Crear mi cuenta o iniciar sesión<\/a>/,
  );
});
test('cartelera is reachable from welcome and every stored role home without a separate betting shortcut', (t) => {
  for (const session of [
    null,
    ...platformRoles.map((role) => ({
      version: 1,
      role: role.id,
      team: 'team-A',
    })),
  ]) {
    const html = render(t, session);
    assert.equal((html.match(/href="\/demo\/events-map"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /href="\/demo\/betting-preview"/);
  }
});
test('stored roles still open their existing home and modules without another selection', (t) => {
  for (const role of platformRoles) {
    const html = render(t, { version: 1, role: role.id, team: 'team-A' });
    assert.ok(
      html.includes(
        isTeamSportsRole(role.id)
          ? 'Cóndores del Ávila'
          : `Hola, ${role.label}`,
      ),
    );
    assert.ok(html.includes('Módulos de tu rol'));
    assert.equal(html.includes('aria-label="Roles de PlaySport"'), false);
  }
});
test('all six roles have one compact hero button per module, no duplicate routes or navigation cards', (t) => {
  for (const role of platformRoles) {
    for (const team of role.id === 'manager'
      ? ['team-A', 'team-B']
      : ['team-A']) {
      const session = { version: 1, role: role.id, team };
      const html = render(t, session);
      const nav = html.match(
        /<nav class="ctaRow roleModuleNavigation"[^>]*>([\s\S]*?)<\/nav>/,
      )?.[1];
      assert.ok(nav, role.id);
      assert.ok(
        html.indexOf('<nav') < html.indexOf('</section>'),
        'Navigation must be inside the green hero',
      );
      const buttons = nav.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
      assert.doesNotMatch(html, /assignedModuleIcon|>AS<|>LV</);
      const visible = demoModules.filter(
        (module) => module.id !== 'player-career' && demoModuleHref(module, session) !== null,
      );
      assert.equal(
        buttons.length,
        visible.length +
          (['scorekeeper', 'manager'].includes(role.id) ? 1 : 0),
      );
      assert.doesNotMatch(html, /href="\/identity"|Logos de equipos/);
      assert.doesNotMatch(nav, /href="\/sports-sheet"/);
      const hrefs = buttons.map((button) => button.match(/href="([^"]+)"/)[1]);
      assert.equal(
        new Set(hrefs).size,
        hrefs.length,
        `${role.id}: duplicated destination`,
      );
      for (const module of visible) {
        const button = buttons.find((button) =>
          button.includes(`aria-label="${module.title}"`),
        );
        assert.ok(button, `${role.id}: ${module.title}`);
        const href = demoModuleHref(module, session).replaceAll('&', '&amp;');
        assert.ok(button.includes(`href="${href}"`));
        assert.equal(
          (html.match(/<a\b[^>]*>/g) ?? []).filter((link) =>
            link.includes(`href="${href}"`),
          ).length,
          1,
        );
        assert.ok(button.includes(module.title));
        assert.ok(button.includes(`data-module-id="${module.id}"`));
        assert.ok(button.includes(`data-status="${module.status}"`));
        assert.ok(button.includes(moduleStatusLabels[module.status]));
        assert.equal(
          button.includes('roleModuleHint'),
          module.status !== 'working',
        );
        assert.equal(
          /<button|<input|<a\b/.test(button.slice(button.indexOf('>') + 1)),
          false,
        );
      }
      assert.doesNotMatch(
        html,
        /class="moduleGrid"|class="moduleCard|moduleCardLink|Abrir módulo/,
      );
      if (role.id === 'scorekeeper') {
        const assigned = buttons.find((button) =>
          button.includes('>Mis partidos asignados</a>'),
        );
        assert.ok(
          assigned.includes('href="/demo/live-scoring?view=scorekeeper"'),
        );
        assert.ok(assigned.includes('Consulta próximos encuentros'));
      }
    }
  }
});
test('manager buttons identify each team and its tournament, not its side in a game', (t) => {
  t.mock.method(React, 'useState', (initial) => [
    initial === false ? true : initial,
    () => {},
  ]);
  const html = render(t);
  const buttons =
    html.match(
      /<button[^>]*class="platformProfile"[^>]*>[\s\S]*?<\/button>/g,
    ) ?? [];
  assert.equal(buttons.length, 2);
  for (const [index, team] of [
    'Tigres del Valle',
    'Leones del Norte',
  ].entries()) {
    assert.ok(buttons[index].includes(`<strong>${team}</strong>`));
    assert.ok(
      buttons[index].includes('<span>Torneo de demostración 2026</span>'),
    );
    assert.equal(/Local|Visitante/.test(buttons[index]), false);
  }
  assert.ok(
    html.includes(
      'Elige el equipo y torneo donde vas a trabajar.',
    ),
  );
});
test('manager can explicitly change working team from home without adding a selector to other modules', (t) => {
  assert.match(
    render(t, { version: 1, role: 'manager', team: 'team-A' }),
    />Cambiar equipo de trabajo<\/button>/,
  );
  assert.doesNotMatch(
    render(t, { version: 1, role: 'fan', team: 'team-A' }),
    />Cambiar equipo de trabajo<\/button>/,
  );
});
