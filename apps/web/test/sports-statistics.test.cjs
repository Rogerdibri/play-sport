const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { exampleStatisticsGames, statisticsExampleObservation, scorecardStatistics, calculateStatisticsRates,
  aggregateStatistics, statisticsInnings, readStatisticsSnapshot, latestStatisticsGames, statisticsMetrics,
  filterStatisticsGames, statisticsGroupKey, statisticsTeamKey, statisticsLeagueKey } = require('@playsport/shared');
const games = () => exampleStatisticsGames('player');
const filters = () => ({ group: '', season: '', league: '', tournament: '', team: '', game: '', from: '', to: '' });
test('only the master test account defaults to example statistics and career; normal accounts retain official records', t => {
  for (const localTestAccess of [false, true]) {
    t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({
      ready: true, account: { id: 'owner', localTestAccess },
    }));
    for (const [path, sourceSlot] of [['../app/sports-sheet/statistics/page', 1], ['../app/sports-sheet/career/page', 0]]) {
      let slot = 0, source;
      t.mock.method(React, 'useState', initial => {
        const value = typeof initial === 'function' ? initial() : initial;
        if (slot++ === sourceSlot) source = value;
        return [value, () => {}];
      });
      function Capture() {
        const element = require(path).default();
        return element.type(element.props);
      }
      renderToStaticMarkup(React.createElement(Capture));
      assert.equal(source, localTestAccess ? 'example' : 'official', path);
    }
  }
});
test('statistics opens in the combined discipline while keeping separate baseball and softball calculation groups', t => {
  const Page = require('../app/sports-sheet/statistics/page').default;
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () =>
    ({ ready: true, account: { id: 'owner', localTestAccess: true } }));
  const states = ['player', 'example', { accountId: 'owner', mode: 'player', source: 'example', identityVerified: false, analysisAllowed: true, games: games() }, filters()];
  let index, tree;
  t.mock.method(React, 'useState', initial => {
    const slot = index++;
    if (slot === 1) assert.equal(initial, 'example', 'the master test account opens the example records');
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
  const findGroup = () => find(tree, node => node.type === 'select' &&
    React.Children.toArray(node.props.children).some(child =>
      typeof child.props.children === 'string' && child.props.children.startsWith('Béisbol ·')));
  const html = render();
  assert.match(html, /Disciplina:<\/strong> Béisbol \/ Softbol/);
  assert.doesNotMatch(html, /Registros a consultar|<option[^>]*>Mis registros oficiales/);
  const filterPanel = find(tree, node => node.type === 'details' && node.props.className.includes('sportsStatisticsFilters'));
  assert.equal(Boolean(filterPanel.props.open), false, 'filters do not hide the accumulated statistics on entry');
  let group = findGroup();
  const options = React.Children.toArray(group.props.children);
  assert.ok(options.some(option => option.props.children.startsWith('Béisbol ·')));
  const softball = options.find(option => option.props.children.startsWith('Softbol ·'));
  assert.ok(softball);
  assert.notEqual(group.props.value, softball.props.value);
  group.props.onChange({ target: { value: softball.props.value } }); render();
  group = findGroup();
  assert.equal(group.props.value, softball.props.value);
  find(tree, node => node.type === 'button' && node.props.children === 'Volver a mis estadísticas').props.onClick();
  assert.equal(states[1], 'official');
  assert.deepEqual(states[3], filters());
  const officialLoading = render();
  assert.doesNotMatch(officialLoading, /Acumulado oficial · Ejemplo/);
  find(tree, node => node.type === 'button' && node.props.children === 'Ver ejemplos').props.onClick();
  assert.equal(states[1], 'example');
});
test('example rows are reproducible from their read-only scorecards, separated by sport and live status', () => {
  for (const mode of ['player', 'team']) {
    const rows = exampleStatisticsGames(mode);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map(row => row.qualification), ['official', 'official', 'official', 'provisional']);
    for (const row of rows) {
      const state = statisticsExampleObservation(row.gameId);
      assert.equal(state.finished, row.status === 'final');
      const ids = mode === 'team' ? state.seed.lineups.away.map(player => player.id) : [state.seed.lineups.away[0].id];
      assert.deepEqual(row.line, calculateStatisticsRates(scorecardStatistics(state, 'away', ids, {
        team: mode === 'team', positions: row.positions, caughtStealing: 0, errors: 0,
        startingPitcherIds: [state.seed.lineups.away[0].id], pitchingComplete: true, offenseId: 'away',
      }), row.eraBase));
      for (const group of ['batting', 'pitching', 'fielding'])
        assert.deepEqual(Object.keys(row.line[group]).sort(), statisticsMetrics[group].map(metric => metric.key).sort());
    }
    assert.equal(readStatisticsSnapshot({ accountId: 'owner', mode, source: 'example', identityVerified: false, analysisAllowed: true, games: rows },
      'owner', mode, 'example').games.length, 4);
  }
  assert.throws(() => statisticsExampleObservation('real-game'));
});
test('rates use plate appearances, total bases and outs, not decimal innings or averages of averages', () => {
  const line = structuredClone(games()[0].line);
  Object.assign(line.batting, { PA: 15, AB: 10, H: 4, singles: 1, doubles: 1, triples: 1, HR: 1, BB: 2, HBP: 1, SF: 1, SH: 1 });
  Object.assign(line.pitching, { ER: 3, pending: 0, outs: 16, H: 4, BB: 2 });
  const nine = calculateStatisticsRates(line, 9), seven = calculateStatisticsRates(line, 7);
  assert.equal(nine.batting.TB, 10); assert.equal(nine.batting.AVG, .4);
  assert.equal(nine.batting.OBP, .5); assert.equal(nine.batting.SLG, 1); assert.equal(nine.batting.OPS, 1.5);
  assert.equal(nine.pitching.ERA, 81 / 16); assert.equal(seven.pitching.ERA, 63 / 16);
  assert.equal(nine.pitching.WHIP, 18 / 16);
  assert.equal(statisticsInnings(16), '5.1'); assert.equal(statisticsInnings(17), '5.2');
  assert.equal(statisticsInnings(0), '0.0'); assert.equal(statisticsInnings(null), 'No disponible');
  for (const invalid of [-1, 1.5, Infinity, NaN]) assert.throws(() => statisticsInnings(invalid));
  const [a, b] = games();
  for (const [row, ab, h] of [[a, 1, 1], [b, 9, 0]]) {
    Object.assign(row.line.batting, { AB: ab, PA: ab, H: h, singles: h, doubles: 0, triples: 0, HR: 0, BB: 0, HBP: 0, SF: 0 });
    row.line = calculateStatisticsRates(row.line, row.eraBase);
  }
  const total = aggregateStatistics([a, b]);
  assert.equal(total.batting.AVG, .1); assert.equal(total.batting.OBP, .1);
  assert.equal(total.batting.SLG, .1); assert.equal(total.batting.OPS, .2);
});
test('unavailable counts and pending classifications never turn into invented zeroes or rates', () => {
  const rows = games().slice(0, 2), line = rows[0].line;
  line.pitching.pending = 1;
  assert.equal(calculateStatisticsRates(line, 9).pitching.ERA, null);
  line.pitching.pending = 0; line.pitching.outs = 0;
  assert.equal(calculateStatisticsRates(line, 9).pitching.ERA, null);
  assert.equal(calculateStatisticsRates(line, 9).pitching.WHIP, null);
  Object.assign(line.batting, { AB: 0, BB: 0, HBP: 0, SF: 0 });
  assert.equal(calculateStatisticsRates(line, 9).batting.OBP, null);
  rows[0].line.pitching.BB = null;
  const sum = aggregateStatistics(rows);
  assert.equal(sum.pitching.BB, null); assert.equal(sum.pitching.WHIP, null);
  assert.equal(sum.pitching.W, null); assert.equal(sum.fielding.PO, null); assert.equal(sum.fielding.FLD, null);
  const state = statisticsExampleObservation(rows[0].gameId);
  const options = { team: false, positions: ['P'], caughtStealing: null, errors: null,
    startingPitcherIds: null, pitchingComplete: true, offenseId: 'away' };
  assert.equal(scorecardStatistics(state, 'away', [state.seed.lineups.away[0].id], options).pitching.GS, null);
  const unknown = scorecardStatistics(state, 'away', [state.seed.lineups.away[0].id], { ...options, pitchingComplete: false });
  assert.ok(Object.values(unknown.pitching).every(value => value === null));
});
test('corrections replace earlier versions; live, excluded and mixed groups never pollute official totals', () => {
  const [a, b, softball, live] = games(), before = JSON.stringify(a);
  const revised = structuredClone(a); revised.version++; revised.line.batting.RBI++;
  assert.equal(aggregateStatistics([a, b, revised]).batting.G, 2);
  assert.equal(aggregateStatistics([a, revised]).batting.RBI, revised.line.batting.RBI);
  assert.equal(JSON.stringify(a), before);
  assert.equal(latestStatisticsGames([a, structuredClone(a)]).length, 1);
  const inconsistent = structuredClone(a); inconsistent.line.batting.R++;
  assert.throws(() => latestStatisticsGames([a, inconsistent]), /misma versión/);
  assert.equal(aggregateStatistics([live]), null);
  revised.qualification = 'excluded'; revised.reason = 'Revisión';
  assert.equal(aggregateStatistics([a, revised]), null);
  for (const patch of [{ sport: 'softball' }, { modality: 'Otra' }, { category: 'Juvenil' }, { eraBase: 7 }])
    assert.throws(() => aggregateStatistics([a, { ...b, ...patch }]), /No se mezclan/);
  assert.throws(() => aggregateStatistics([a, softball]), /No se mezclan/);
});
test('filters preserve the exact tournament/team pair, league, empty seasons, game and inclusive dates', () => {
  const rows = games(), row = rows[0];
  const selected = { ...filters(), group: statisticsGroupKey(row), season: JSON.stringify(row.season),
    league: statisticsLeagueKey(row), tournament: row.tournamentId, team: statisticsTeamKey(row),
    game: JSON.stringify([row.tournamentId, row.gameId, row.teamId]), from: row.date, to: row.date };
  assert.deepEqual(filterStatisticsGames(rows, selected), [row]);
  const empty = { ...row, season: '' }, collision = { ...row, season: '__none__' };
  assert.deepEqual(filterStatisticsGames([empty, collision], { ...filters(), season: JSON.stringify('') }), [empty]);
  assert.deepEqual(filterStatisticsGames([row, { ...row, tournamentId: 'other' }], { ...filters(), team: statisticsTeamKey(row) }), [row]);
  assert.deepEqual(filterStatisticsGames(rows, { ...filters(), from: '2027-01-01' }), []);
  assert.deepEqual(filterStatisticsGames([{ ...row, date: null }], { ...filters(), to: '2027-01-01' }), []);
});
test('reader rejects another account, source, mode, invalid dates and fractional or missing counters', () => {
  const snapshot = () => ({ accountId: 'owner', mode: 'player', source: 'example', identityVerified: true, analysisAllowed: true, games: games() });
  for (const [key, value] of [['accountId', 'other'], ['mode', 'team'], ['source', 'official'], ['identityVerified', 'true']])
    assert.throws(() => readStatisticsSnapshot({ ...snapshot(), [key]: value }, 'owner', 'player', 'example'));
  for (const value of [-1, 1.2, Infinity, NaN, '3', undefined]) {
    const body = snapshot(); body.games[0].line.pitching.outs = value;
    assert.throws(() => readStatisticsSnapshot(body, 'owner', 'player', 'example'));
  }
  const body = snapshot(); body.games[0].date = '2026-02-31';
  assert.throws(() => readStatisticsSnapshot(body, 'owner', 'player', 'example'));
});
