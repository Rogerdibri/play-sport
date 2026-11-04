const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  demoPlayers, fillDemoScorecardJerseys, fillMissingDemoJerseys, getDemoJerseyAssignments, getDemoJerseyNumber
} = require('../app/demo/[slug]/demo-players');

test('all 23 fictional players have distinct valid jersey numbers, including substitutes', () => {
  assert.equal(demoPlayers.length, 23);
  const jerseys = Array.from({ length: 23 }, (_, index) => {
    const number = index + 1;
    const id = number <= 18 ? `PRUEBA${String(number).padStart(3, '0')}` : `PRUEBA${number}`;
    const jersey = getDemoJerseyNumber(id);
    assert.match(jersey, /^\d{1,2}$/);
    assert.equal(jersey, String(number));
    return jersey;
  });

  assert.equal(new Set(jerseys).size, 23);
});

test('the visible assignment list includes all fixtures and preserves custom jerseys', () => {
  const assignments = getDemoJerseyAssignments([
    { id: 'PRUEBA001', jersey: '77' }, { id: 'PRUEBA002', jersey: '' }
  ]);
  assert.equal(assignments.length, 23);
  assert.equal(assignments[0].jerseyNumber, '77');
  assert.equal(assignments[1].jerseyNumber, '2');
  assert.equal(assignments.find((player) => player.identificationNumber === 'PRUEBA22').jerseyNumber, '22');
  assert.equal(assignments.find((player) => player.identificationNumber === 'PRUEBA23').jerseyNumber, '23');
  assert.equal(demoPlayers[0].jerseyNumber, '1');
});

test('fictional jersey lookup accepts normalized identification input', () => {
  assert.equal(getDemoJerseyNumber(' prueba001 '), '1');
  assert.equal(getDemoJerseyNumber('prueba19'), '19');
});

test('does not invent jersey numbers for nonfixture players', () => {
  for (const id of ['', 'V12345678', 'PRUEBA000', 'PRUEBA024', 'PRUEBA24', 'PRUEBA1']) {
    assert.equal(getDemoJerseyNumber(id), '');
  }
});

test('repairs previously created drafts without changing players, positions, roles or batting order', () => {
  const draft = [
    { identificationNumber: 'PRUEBA001', jerseyNumber: '', battingOrder: 1, fieldPosition: 'P', lineupRole: 'PLAYER' },
    { identificationNumber: 'PRUEBA19', jerseyNumber: ' ', battingOrder: null, fieldPosition: 'C', lineupRole: 'FLEX' }
  ];
  assert.deepEqual(fillMissingDemoJerseys(draft), [
    { ...draft[0], jerseyNumber: '1' },
    { ...draft[1], jerseyNumber: '19' }
  ]);
  assert.equal(draft[0].jerseyNumber, '');
});

test('preserves custom numbers and nonfixture players and is stable after repair', () => {
  const draft = [
    { identificationNumber: 'PRUEBA001', jerseyNumber: '77' },
    { identificationNumber: 'PRUEBA002', jerseyNumber: '' },
    { identificationNumber: 'V12345678', jerseyNumber: '' }
  ];
  const repaired = fillMissingDemoJerseys(draft);
  assert.equal(repaired[0], draft[0]);
  assert.equal(repaired[1].jerseyNumber, '2');
  assert.equal(repaired[2], draft[2]);
  assert.equal(fillMissingDemoJerseys(repaired), repaired);
});

test('assigns missing jerseys in an existing private save, including bench and rival roster', () => {
  const player = (id, jersey = '') => ({ id, jersey, name: id, order: null, position: 'NA' });
  const original = {
    names: { home: 'Local', away: 'Visitante' },
    courtesyRunnerSource: 'BENCH',
    teamSheetRevisions: { home: 3, away: 0 },
    rosters: { home: [player('PRUEBA001'), player('PRUEBA19'), player('OTHER')], away: [player('PRUEBA010')] },
    lineups: { home: [player('PRUEBA001', '77')], away: [] }
  };
  const repaired = fillDemoScorecardJerseys(original);
  assert.deepEqual(repaired.rosters.home.map((entry) => entry.jersey), ['77', '19', '']);
  assert.equal(repaired.rosters.away[0].jersey, '10');
  assert.equal(repaired.lineups.home[0].jersey, '77');
  assert.deepEqual(repaired.teamSheetRevisions, original.teamSheetRevisions);
  assert.equal(original.rosters.home[0].jersey, '');
  assert.equal(repaired.rosters.home[2], original.rosters.home[2]);
  assert.deepEqual(fillDemoScorecardJerseys(repaired), repaired);
});
