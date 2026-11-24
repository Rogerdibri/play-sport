const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const {
  newTournament,
  newTournamentFixture,
  readTournament,
  generateTournamentFixtures,
  tournamentParticipationBlock,
  tournamentScheduleConflicts,
  supportsOfficialTournamentScoring,
  softballModalities,
  isSoftballSport,
  validateTournamentGroups,
} = require('@playsport/shared');
const platformSession = require('../app/platform-session');
const Workspace = require('../app/demo/[slug]/tournaments').default;
const { resizeTournamentGroups } = require('../app/tournament-groups');
const { demoModules, demoModuleHref } = require('../app/platform-navigation');
let count = 0;
const id = () => `fixture-${++count}`;
function setup(n = 4) {
  const doc = { ...newTournament('competition'), name: 'Copa ficticia' };
  doc.teams = Array.from({ length: n }, (_, i) => ({
    id: `team-${i + 1}`,
    name: `Equipo ${i + 1}`,
    managerId: '',
    managerIdentification: '',
    status: 'accepted',
    rosterStatus: 'pending',
    rosterSignature: '',
    blocked: false,
    blockReason: '',
    blockScopes: [],
    withdrawalReason: '',
  }));
  doc.phases = [
    {
      id: 'first',
      name: 'Primera fase',
      kind: 'round-robin',
      status: 'draft',
      sourcePhaseId: '',
      teamIds: doc.teams.map((team) => team.id),
      groups: [],
      teamLimit: Math.max(2, n),
      turns: 1,
      bestOf: 1,
      qualifiers: null,
      pairing: 'seeded',
      rules: '',
    },
  ];
  return doc;
}
test('minimal draft needs only league or tournament name, no second phase, deadline or full calendar', () => {
  for (const patch of [
    { name: 'Copa ficticia' },
    { leagueName: 'Liga ficticia' },
  ]) {
    const doc = readTournament({ ...newTournament('draft'), ...patch });
    assert.equal(doc.phases.length, 0);
    assert.equal(doc.fixtures.length, 0);
    assert.equal(doc.teamLimit, null);
  }
  assert.throws(() => readTournament(newTournament('draft')), /nombre/);
  assert.equal(supportsOfficialTournamentScoring('Béisbol'), true);
  assert.equal(supportsOfficialTournamentScoring('sóftbol'), true);
  assert.equal(supportsOfficialTournamentScoring('baloncesto'), false);
});
test('tournament sheet offers only baseball and softball while modality remains optional', (t) => {
  const { OrganizerTournaments } = require('../app/demo/[slug]/tournaments');
  const document = setup();
  document.branch = 'Femenino';
  const saved = {
    document,
    revision: 1,
    public: false,
    updatedAt: '2026-11-09T14:00:00.000Z',
  };
  const states = [[saved], saved, document, 'Ficha'];
  let state = 0;
  t.mock.method(React, 'useState', (initial) => [
    state < states.length
      ? states[state++]
      : typeof initial === 'function'
        ? initial()
        : initial,
    () => {},
  ]);
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    ready: true,
    session: { role: 'organizer' },
    account: { id: 'account' },
  }));
  for (const sport of [
    'baseball',
    'Béisbol',
    'softball',
    'sóftbol',
    'baloncesto',
  ]) {
    document.sport = sport;
    state = 0;
    const html = renderToStaticMarkup(
      React.createElement(OrganizerTournaments, { accountId: 'account' }),
    );
    assert.match(html, /class="profileFieldGrid tournamentSheetFields"/);
    const field = html.match(/<span>Deporte<\/span>(.*?)<\/label>/s)[1];
    assert.match(field, /<select required="">/);
    assert.match(field, /value="baseball"/);
    assert.match(field, /value="softball"/);
    assert.doesNotMatch(field, /<input/);
    if (sport === 'baloncesto')
      assert.match(field, /El deporte guardado no está disponible/);
    else
      assert.match(
        field,
        new RegExp(
          `value="${sport.toLowerCase().startsWith('s') ? 'softball' : 'baseball'}" selected=""`,
        ),
      );
    const modality = html.match(
      /<span>Modalidad deportiva \(opcional\)<\/span>(.*?)<\/label>/s,
    )[1];
    if (isSoftballSport(sport)) {
      assert.match(modality, /<select/);
      assert.match(
        modality,
        /<option value="" selected="">Selecciona una modalidad/,
      );
      for (const option of softballModalities)
        assert.ok(modality.includes(`value="${option}"`));
      assert.doesNotMatch(modality, /<input/);
    } else {
      assert.match(modality, /<input/);
      assert.doesNotMatch(modality, /Lento|Rápido|Modificado/);
    }
    assert.doesNotMatch(modality, /required/);
    assert.match(html, /<span>Sexo<\/span><input[^>]*value="Femenino"/);
    assert.doesNotMatch(html, /Rama \/ requisitos/);
    assert.equal(
      document.branch,
      'Femenino',
      'existing tournament sex is preserved',
    );
    assert.equal(readTournament(document).modality, '');
    assert.equal(
      document.sport,
      sport,
      'rendering does not rewrite existing saved sport names',
    );
  }
});
test('registration fee can be cleared and typed as 100 without reinserting a leading zero', (t) => {
  const { OrganizerTournaments } = require('../app/demo/[slug]/tournaments');
  let document = setup(),
    state = 0,
    input;
  const saved = {
    document,
    revision: 1,
    public: false,
    updatedAt: '2026-11-09T14:00:00.000Z',
  };
  t.mock.method(React, 'useState', (initial) => {
    const index = state++;
    const values = [[saved], saved, document, 'Ficha'];
    return [
      index < values.length
        ? values[index]
        : typeof initial === 'function'
          ? initial()
          : initial,
      (update) => {
        if (index === 2)
          document = typeof update === 'function' ? update(document) : update;
      },
    ];
  });
  const runtime = require('react/jsx-runtime');
  for (const name of ['jsx', 'jsxs']) {
    const original = runtime[name];
    t.mock.method(runtime, name, (type, props, ...rest) => {
      if (type === 'input' && props.step === '0.01') input = props;
      return original(type, props, ...rest);
    });
  }
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    ready: true,
    session: { role: 'organizer' },
    account: { id: 'account' },
  }));
  const render = () => {
    state = 0;
    renderToStaticMarkup(
      React.createElement(OrganizerTournaments, { accountId: 'account' }),
    );
  };
  render();
  assert.equal(input.value, '');
  assert.equal(input.placeholder, '0');
  for (const [text, cents, shown] of [
    ['1', 100, 1],
    ['10', 1000, 10],
    ['100', 10000, 100],
    ['', 0, ''],
    ['0', 0, ''],
    ['10.50', 1050, 10.5],
  ]) {
    input.onChange({ target: { value: text } });
    render();
    assert.equal(document.feeCents, cents);
    assert.equal(input.value, shown);
    assert.equal(readTournament(document).feeCents, cents);
  }
});
test('group capacities and qualifiers persist independently, allow uneven sizes and reject invalid assignments', () => {
  const doc = setup(8),
    phase = doc.phases[0];
  phase.groups = [
    {
      id: 'a',
      name: 'Grupo A',
      teamIds: phase.teamIds.slice(0, 3),
      teamLimit: 3,
      qualifiers: 1,
    },
    {
      id: 'b',
      name: 'Grupo B',
      teamIds: phase.teamIds.slice(3),
      teamLimit: 5,
      qualifiers: 2,
    },
  ];
  assert.deepEqual(readTournament(doc).phases[0].groups, phase.groups);
  const games = generateTournamentFixtures(doc, phase.id, id);
  assert.equal(games.length, 13);
  assert.ok(
    games.every((game) =>
      phase.groups.some(
        (group) =>
          group.teamIds.includes(game.homeTeamId) &&
          group.teamIds.includes(game.awayTeamId),
      ),
    ),
  );
  phase.groups[0].teamLimit = 2;
  assert.throws(() => readTournament(doc), /superan el cupo/);
  assert.throws(
    () => generateTournamentFixtures(doc, phase.id, id),
    /superan el cupo/,
  );
  phase.groups[0].teamLimit = 3;
  phase.groups[0].qualifiers = 4;
  assert.throws(() => readTournament(doc), /clasificados no pueden superar/);
  phase.groups[0].qualifiers = 1;
  for (const limit of [0, 1, 2.5, -2]) {
    phase.groups[0].teamLimit = limit;
    assert.throws(() => readTournament(doc), /cupo/);
  }
  phase.groups[0].teamLimit = 4;
  assert.doesNotThrow(
    () => readTournament(doc),
    'incomplete assignments may be saved as drafts',
  );
  assert.throws(
    () => generateTournamentFixtures(doc, phase.id, id),
    /faltan equipos.*3 de 4/,
  );
  phase.groups[0].teamLimit = null;
  assert.doesNotThrow(() => readTournament(doc));
  assert.throws(
    () => generateTournamentFixtures(doc, phase.id, id),
    /cuántos equipos/,
  );
});
test('single-group capacity prevents excess entrants and legacy documents remain readable without inventing limits', () => {
  const doc = setup(),
    phase = doc.phases[0];
  phase.teamLimit = 3;
  assert.throws(() => validateTournamentGroups(phase), /superan el cupo/);
  phase.teamLimit = 4;
  phase.qualifiers = 5;
  assert.throws(() => readTournament(doc), /clasificados no pueden superar/);
  phase.qualifiers = 2;
  assert.equal(readTournament(doc).phases[0].teamLimit, 4);
  phase.teamLimit = null;
  assert.throws(
    () => generateTournamentFixtures(doc, phase.id, id),
    /cuántos equipos/,
  );
  delete phase.teamLimit;
  const legacy = readTournament(doc);
  assert.equal('teamLimit' in legacy.phases[0], false);
  assert.deepEqual(legacy, doc);
  assert.throws(
    () => generateTournamentFixtures(legacy, phase.id, id),
    /cuántos equipos/,
  );
  phase.groups = [{ id: 'a', name: 'A', teamIds: [...phase.teamIds] }];
  assert.deepEqual(readTournament(doc), doc);
});
test('round robin ignores old series values while knockout retains odd-series validation', () => {
  const doc = setup();
  for (const bestOf of [1, 2, 3, 5, 7]) {
    doc.phases[0].bestOf = bestOf;
    const restored = readTournament(doc);
    const games = generateTournamentFixtures(restored, 'first', id);
    assert.equal(games.length, 6);
    assert.ok(games.every((game) => game.series === ''));
    assert.equal(
      restored.phases[0].bestOf,
      bestOf,
      'reading does not rewrite existing settings',
    );
  }
  doc.phases[0].kind = 'knockout';
  doc.phases[0].bestOf = 2;
  assert.throws(() => readTournament(doc), /impar/);
});
test('softball modality choices preserve historical values and never appear for baseball', (t) => {
  const { OrganizerTournaments } = require('../app/demo/[slug]/tournaments');
  const document = {
    ...setup(),
    sport: 'softball',
    modality: 'Modalidad antigua',
  };
  const saved = {
    document,
    revision: 1,
    public: false,
    updatedAt: '2026-11-09T14:00:00.000Z',
  };
  const states = [[saved], saved, document, 'Ficha'];
  let state = 0;
  t.mock.method(React, 'useState', (initial) => [
    state < states.length
      ? states[state++]
      : typeof initial === 'function'
        ? initial()
        : initial,
    () => {},
  ]);
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    ready: true,
    session: { role: 'organizer' },
    account: { id: 'account' },
  }));
  const html = renderToStaticMarkup(
    React.createElement(OrganizerTournaments, { accountId: 'account' }),
  );
  assert.match(
    html,
    /value="Modalidad antigua" selected="">Modalidad antigua \(guardada\)/,
  );
  assert.equal(readTournament(document).modality, 'Modalidad antigua');
  assert.deepEqual(softballModalities, ['Lento', 'Rápido', 'Modificado']);
});
test('round robin creates every pair exactly once per turn, handles byes and separates groups', () => {
  for (const n of [2, 3, 4, 5, 8, 16, 32]) {
    const doc = setup(n),
      generated = generateTournamentFixtures(doc, 'first', id);
    assert.equal(generated.length, (n * (n - 1)) / 2);
    assert.equal(
      new Set(
        generated.map((g) => [g.homeTeamId, g.awayTeamId].sort().join(':')),
      ).size,
      generated.length,
    );
    for (const round of new Set(generated.map((g) => g.round))) {
      const teams = generated
        .filter((g) => g.round === round)
        .flatMap((g) => [g.homeTeamId, g.awayTeamId]);
      assert.equal(new Set(teams).size, teams.length);
    }
    doc.phases[0].turns = 2;
    const two = generateTournamentFixtures(doc, 'first', id);
    assert.equal(two.length, n * (n - 1));
    for (const g of generated)
      assert.ok(
        two.some(
          (other) =>
            other.homeTeamId === g.awayTeamId &&
            other.awayTeamId === g.homeTeamId,
        ),
      );
  }
  const doc = setup(8);
  doc.phases[0].groups = [
    {
      id: 'A',
      name: 'A',
      teamIds: doc.phases[0].teamIds.slice(0, 4),
      teamLimit: 4,
      qualifiers: 2,
    },
    {
      id: 'B',
      name: 'B',
      teamIds: doc.phases[0].teamIds.slice(4),
      teamLimit: 4,
      qualifiers: 2,
    },
  ];
  assert.equal(generateTournamentFixtures(doc, 'first', id).length, 12);
  doc.phases[0].groups[1].teamIds.pop();
  assert.throws(
    () => generateTournamentFixtures(doc, 'first', id),
    /faltan equipos/,
  );
});
test('group count grows from one through eight without changing shared phase rules or selected participants', () => {
  const doc = setup(16),
    phase = doc.phases[0];
  phase.rules = 'Reglas comunes para todos';
  for (let count = 2; count <= 8; count++) {
    phase.groups = resizeTournamentGroups(phase, count, id);
    assert.equal(phase.groups.length, count);
    assert.equal(new Set(phase.groups.map((group) => group.id)).size, count);
    assert.deepEqual(phase.groups[0].teamIds, phase.teamIds);
    assert.equal(phase.rules, 'Reglas comunes para todos');
    assert.equal(
      phase.groups.some((group) => 'rules' in group),
      false,
    );
  }
  phase.groups = phase.groups.map((group, index) => ({
    ...group,
    teamLimit: 2,
    teamIds: phase.teamIds.filter((_, i) => i % 8 === index),
  }));
  assert.equal(generateTournamentFixtures(doc, phase.id, id).length, 8);
  const before = structuredClone(phase);
  const reduced = resizeTournamentGroups(phase, 3, id);
  assert.deepEqual(phase, before);
  assert.deepEqual(reduced, before.groups.slice(0, 3));
  phase.groups = reduced;
  assert.throws(
    () => generateTournamentFixtures(doc, phase.id, id),
    /cada equipo/,
  );
  phase.groups = resizeTournamentGroups(phase, 1, id);
  assert.deepEqual(phase.groups, []);
  assert.equal(phase.teamIds.length, 16);
  assert.equal(generateTournamentFixtures(doc, phase.id, id).length, 120);
  for (const count of [0, 9, -1, 1.5, NaN])
    assert.throws(
      () => resizeTournamentGroups(phase, count, id),
      /entre 1 y 8/,
    );
});
test('phase header starts with one group, supports eight and keeps one common rules editor', (t) => {
  const { OrganizerTournaments } = require('../app/demo/[slug]/tournaments');
  const document = setup();
  const saved = {
    document,
    revision: 1,
    public: false,
    updatedAt: '2026-11-09T14:00:00.000Z',
  };
  const states = [[saved], saved, document, 'Fases'];
  let state = 0;
  t.mock.method(React, 'useState', (initial) => [
    state < states.length
      ? states[state++]
      : typeof initial === 'function'
        ? initial()
        : initial,
    () => {},
  ]);
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    ready: true,
    session: { role: 'organizer' },
    account: { id: 'account' },
  }));
  const render = () => {
    state = 0;
    return renderToStaticMarkup(
      React.createElement(OrganizerTournaments, { accountId: 'account' }),
    );
  };
  let html = render();
  assert.match(html, /<option value="1" selected="">1<\/option>/);
  assert.match(html, /<option value="8">8<\/option>/);
  assert.ok(
    html.indexOf('Cantidad de grupos') < html.indexOf('<span>Formato</span>'),
  );
  assert.match(html, /Grupo único:/);
  assert.match(html, /Equipos del grupo único/);
  assert.match(html, /Clasificados del grupo único/);
  assert.doesNotMatch(html, /<span>Serie al mejor de/);
  assert.doesNotMatch(html, /Agregar grupo|Quitar grupo/);
  document.phases[0].groups = resizeTournamentGroups(document.phases[0], 8, id);
  html = render();
  assert.match(html, /<option value="8" selected="">8<\/option>/);
  assert.equal((html.match(/<span>Nombre del grupo<\/span>/g) || []).length, 8);
  assert.equal(
    (html.match(/<span>Equipos que participarán en Grupo /g) || []).length,
    8,
  );
  assert.equal((html.match(/<span>Clasificados de Grupo /g) || []).length, 8);
  assert.doesNotMatch(html, /Clasificados del grupo único/);
  assert.equal(
    (html.match(/Reglas comunes de la fase \(todos los grupos\)/g) || [])
      .length,
    1,
  );
  document.phases[0].kind = 'knockout';
  html = render();
  assert.match(html, /<span>Serie al mejor de/);
  assert.doesNotMatch(html, /<span>Vueltas por grupo/);
});
test('manager inscriptions allow private draft roster review and require an inline correction note', async (t) => {
  const { OrganizerTournaments } = require('../app/demo/[slug]/tournaments');
  const document = setup(1);
  document.teams[0].enrollment = {
    status: 'submitted',
    contact: '',
    notes: '',
    submittedAt: '2026-11-09T14:00:00.000Z',
    reviewNotes: '',
  };
  const saved = {
    document,
    revision: 1,
    public: false,
    updatedAt: '2026-11-09T14:00:00.000Z',
  };
  const states = [[saved], saved, document, 'Equipos y rosters'];
  let state = 0,
    reviewRoster,
    requests = 0;
  t.mock.method(React, 'useState', (initial) => [
    state < states.length
      ? states[state++]
      : typeof initial === 'function'
        ? initial()
        : initial,
    () => {},
  ]);
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    ready: true,
    session: { role: 'organizer' },
    account: { id: 'account' },
  }));
  const runtime = require('react/jsx-runtime');
  for (const name of ['jsx', 'jsxs']) {
    const original = runtime[name];
    t.mock.method(runtime, name, (type, props, ...rest) => {
      if (type === 'button' && props.children === 'Consultar roster actual')
        reviewRoster = props.onClick;
      return original(type, props, ...rest);
    });
  }
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests++;
    assert.match(url, /\/roster\?/);
    return new Response(JSON.stringify({ members: [] }));
  });
  const render = () => {
    state = 0;
    return renderToStaticMarkup(
      React.createElement(OrganizerTournaments, { accountId: 'account' }),
    );
  };
  const html = render();
  assert.match(html, /Correcciones que debe realizar el manager/);
  assert.match(
    html,
    /<button[^>]*disabled=""[^>]*>Devolver para corregir<\/button>/,
  );
  await reviewRoster();
  assert.equal(requests, 1);
  delete document.teams[0].enrollment;
  render();
  await reviewRoster();
  assert.equal(
    requests,
    1,
    'legacy teams still need publication to obtain a roster context',
  );
});
test('seeded semifinals, round of 32, random draws, series and manual formats keep organizer control', () => {
  const doc = setup();
  doc.phases[0].kind = 'knockout';
  const fixtures = generateTournamentFixtures(doc, 'first', id);
  assert.deepEqual(
    fixtures.map((g) => [g.homeTeamId, g.awayTeamId]),
    [
      ['team-1', 'team-4'],
      ['team-2', 'team-3'],
    ],
  );
  doc.phases[0].pairing = 'draw';
  const draw = generateTournamentFixtures(doc, 'first', id, () => 0);
  assert.equal(
    new Set(draw.flatMap((g) => [g.homeTeamId, g.awayTeamId])).size,
    4,
  );
  doc.phases[0].bestOf = 7;
  assert.equal(generateTournamentFixtures(doc, 'first', id, () => 0).length, 8);
  doc.phases[0].kind = 'round-robin';
  const roundRobin = generateTournamentFixtures(doc, 'first', id);
  assert.equal(roundRobin.length, 6);
  assert.ok(roundRobin.every((game) => !game.series));
  const thirtyTwo = setup(32);
  thirtyTwo.phases[0].kind = 'knockout';
  assert.equal(generateTournamentFixtures(thirtyTwo, 'first', id).length, 16);
  for (const kind of ['custom', 'swiss', 'double-elimination', 'repechage']) {
    doc.phases[0].kind = kind;
    assert.doesNotThrow(() => readTournament(doc));
    assert.throws(
      () => generateTournamentFixtures(doc, 'first', id),
      /personalizados/,
    );
  }
  doc.phases[0].kind = 'knockout';
  doc.phases[0].pairing = 'manual';
  assert.throws(() => generateTournamentFixtures(doc, 'first', id), /manuales/);
});
test('weekly programming permits unresolved entrants and dates while rejecting circular phases and duplicate groups', () => {
  const doc = setup();
  doc.fixtures = [newTournamentFixture('future', 'first')];
  assert.doesNotThrow(() => readTournament(doc));
  doc.phases.push({
    ...doc.phases[0],
    id: 'second',
    name: 'Final',
    sourcePhaseId: 'first',
    teamIds: [],
  });
  assert.doesNotThrow(() => readTournament(doc));
  doc.phases[0].sourcePhaseId = 'second';
  assert.throws(() => readTournament(doc), /circular/);
  doc.phases[0].sourcePhaseId = '';
  doc.phases[0].groups = [
    { id: 'a', name: 'A', teamIds: ['team-1'] },
    { id: 'b', name: 'B', teamIds: ['team-1'] },
  ];
  assert.throws(() => readTournament(doc), /repetirse/);
});
test('calendar checks actual overlapping intervals, shared officials and overnight bookings, not merely start time', () => {
  const doc = setup();
  const game = (id, patch = {}) => ({
    ...newTournamentFixture(id, 'first'),
    homeTeamId: 'team-1',
    awayTeamId: 'team-2',
    date: '2026-11-09',
    time: '23:30',
    ...patch,
  });
  doc.fixtures = [
    game('one'),
    game('two', { date: '2026-11-10', time: '00:30' }),
  ];
  assert.equal(tournamentScheduleConflicts(doc).length, 1);
  assert.throws(() => readTournament(doc), /Choque/);
  doc.fixtures[1].time = '01:30';
  assert.equal(tournamentScheduleConflicts(doc).length, 0);
  doc.fixtures[1] = {
    ...doc.fixtures[1],
    homeTeamId: 'team-3',
    awayTeamId: 'team-4',
    time: '00:30',
  };
  doc.fixtures.forEach((g) => (g.scorekeeperIds = ['scorer']));
  assert.equal(tournamentScheduleConflicts(doc).length, 1);
});
test('administrative blocks, scoped player and team sanctions and withdrawals have explicit effective periods', () => {
  const doc = setup(),
    team = doc.teams[0];
  team.blocked = true;
  team.blockReason = 'Cuota pendiente';
  team.blockScopes = ['registration'];
  assert.equal(
    tournamentParticipationBlock(doc, team.id, 'first', '2026-11-09'),
    null,
  );
  team.blockScopes = ['participation'];
  assert.match(
    tournamentParticipationBlock(doc, team.id, 'first', '2026-11-09'),
    /bloqueado/,
  );
  team.blockScopes = ['lineup'];
  assert.match(
    tournamentParticipationBlock(doc, team.id, 'first', '2026-11-09'),
    /bloqueado/,
  );
  assert.equal(
    tournamentParticipationBlock(
      doc,
      team.id,
      'first',
      '2026-11-09',
      [],
      'play',
    ),
    null,
  );
  team.blocked = false;
  doc.sanctions = [
    {
      id: 'sanction',
      target: 'player',
      targetId: 'PLAYER1',
      reason: 'Decisión ficticia',
      phaseId: 'first',
      from: '2026-11-09',
      until: '2026-11-10',
      gamesRemaining: 1,
      active: true,
    },
  ];
  assert.equal(
    tournamentParticipationBlock(doc, team.id, 'first', '2026-11-08', [
      'PLAYER1',
    ]),
    null,
  );
  assert.match(
    tournamentParticipationBlock(doc, team.id, 'first', '2026-11-09', [
      'PLAYER1',
    ]),
    /sanción/,
  );
  assert.equal(
    tournamentParticipationBlock(doc, team.id, 'other', '2026-11-09', [
      'PLAYER1',
    ]),
    null,
  );
  doc.sanctions[0].gamesRemaining = 0;
  assert.equal(
    tournamentParticipationBlock(doc, team.id, 'first', '2026-11-09', [
      'PLAYER1',
    ]),
    null,
  );
  team.status = 'withdrawn';
  assert.throws(() => readTournament(doc), /motivo del retiro/);
  team.withdrawalReason = 'Retiro voluntario';
  assert.match(
    tournamentParticipationBlock(doc, team.id, 'first', '2026-11-09'),
    /retirado/,
  );
});
test('manager shortcuts and restored sessions keep the selected tournament work context', () => {
  const {
    readDemoSession,
    liveScoringHref,
    managerWorkContext,
  } = require('../app/platform-navigation');
  const selected = {
    version: 1,
    role: 'manager',
    team: 'team-A',
    workTeamId: 'club-new',
    workTournamentId: 'competition-new',
    workTeamName: 'Club nuevo',
  };
  assert.deepEqual(readDemoSession(selected), selected);
  assert.equal(liveScoringHref(selected), '/demo/manager-games');
  assert.equal(managerWorkContext(selected).teamId, 'club-new');
});
test('links and references are validated and invalid configurations fail explicitly', () => {
  for (const link of [
    'javascript:alert(1)',
    'data:text/html,test',
    'https://user:password@example.test',
    'not-a-url',
  ]) {
    assert.throws(
      () => readTournament({ ...setup(), socialLinks: [link] }),
      /enlace/,
    );
  }
  const doc = setup();
  doc.phases[0].kind = 'knockout';
  doc.phases[0].bestOf = 2;
  assert.throws(() => readTournament(doc), /impar/);
  doc.phases[0].bestOf = 1;
  doc.teams[0].blocked = true;
  assert.throws(() => readTournament(doc), /motivo y alcance/);
  assert.throws(
    () => readTournament({ ...setup(), ownerAccountId: 'forged' }),
    /desconocidos/,
  );
});
test('create tournament module is organizer-only and preserves public read access for other roles', (t) => {
  const module = demoModules.find((module) => module.id === 'tournaments');
  for (const role of [
    'organizer',
    'manager',
    'scorekeeper',
    'fan',
    'player',
    'scout',
  ]) {
    assert.equal(
      demoModuleHref(module, { version: 1, role, team: 'team-A' }),
      role === 'organizer' ? '/demo/tournaments' : null,
    );
  }
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    ready: true,
    session: { role: 'manager' },
    account: { id: 'account' },
  }));
  assert.match(
    renderToStaticMarkup(React.createElement(Workspace)),
    /perfil Organizador/,
  );
  assert.match(
    renderToStaticMarkup(
      React.createElement(Workspace, { publicId: 'public-competition' }),
    ),
    /ficha pública/,
  );
});
test('organizer layout separates tournament selection, save actions and section navigation', (t) => {
  const { OrganizerTournaments } = require('../app/demo/[slug]/tournaments');
  const document = {
    ...newTournament('competition'),
    name: 'Copa de prueba',
    season: '2026',
  };
  const saved = {
    document,
    revision: 1,
    public: false,
    updatedAt: '2026-11-09T14:00:00.000Z',
  };
  const states = [[saved], saved, document, 'Ficha'];
  let state = 0;
  t.mock.method(React, 'useState', (initial) => [
    state < states.length
      ? states[state++]
      : typeof initial === 'function'
        ? initial()
        : initial,
    () => {},
  ]);
  t.mock.method(platformSession, 'usePlatformSession', () => ({
    ready: true,
    session: { role: 'organizer' },
    account: { id: 'account' },
  }));
  const html = renderToStaticMarkup(
    React.createElement(OrganizerTournaments, { accountId: 'account' }),
  );
  assert.match(html, /class="managerCard tournamentSelector"/);
  assert.match(html, /class="tournamentListItem" aria-pressed="true"/);
  assert.match(
    html,
    /<strong>Copa de prueba<\/strong><span>2026 · Borrador privado<\/span>/,
  );
  assert.equal((html.match(/class="tournamentActions"/g) || []).length, 2);
  assert.match(
    html,
    /class="tournamentEditorBody"><nav class="tournamentTabs" aria-label="Secciones del torneo">.*?<\/nav><fieldset class="tournamentFields"/s,
  );
  assert.match(html, /Administrar cupos y cierre del roster/);
});
