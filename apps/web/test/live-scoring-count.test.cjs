const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Scorecard = require('../app/demo/[slug]/private-scorecard-view').default;
const { createPrivateScorecardExample } = require('../app/demo/[slug]/private-scorecard-example-data');
const { replayPrivate } = require('../app/demo/[slug]/private-scorecard');

test('the summary groups the live balls, strikes and outs with explicit labels for observers and scorers', t => {
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({
    session: null, ready: true, reportNavigationError() {}, registerScreenBack() { return () => {}; },
    registerNavigationBusy() { return () => {}; }
  }));
  const { seed, commands } = createPrivateScorecardExample();
  for (const counts of [{ balls: 0, strikes: 0, outs: 0 }, { balls: 3, strikes: 2, outs: 1 }]) {
    const state = { ...replayPrivate(seed, commands), ...counts };
    for (const mode of ['observation', 'official', 'public', 'friendly']) {
      const html = renderToStaticMarkup(React.createElement(Scorecard, {
        ...(mode === 'observation' ? { observation: state } : {
          ...(mode === 'friendly' ? { friendly: true } : {}),
          official: { session: { seed, commands, state }, readOnly: mode === 'public', busy: false, canUndo: true,
            connection: { data: null, busy: false, error: '', refresh() {} },
            onCommand: async () => {}, onUndo: async () => {}, onDuration: async () => {}, onErrorOuts: async () => {} }
        }),
        apiBase: '', tournamentId: 'example-tournament', gameId: 'example-game',
        managerId: '', homeId: 'example-home', awayId: 'example-away', ownSide: 'home',
        homeName: seed.names.home, awayName: seed.names.away,
        initialLineup: seed.lineups.home, positionLabels: {}, onBack() {}
      }));
      const summary = html.slice(html.indexOf('class="privateSummaryHeader"'), html.indexOf('class="privateLineScoreScroll"'));
      assert.match(summary, /<dl class="privateGameCount" aria-label="Conteo actual" aria-live="polite" aria-atomic="true">/);
      assert.ok(summary.indexOf('PIZARRA RESUMEN') < summary.indexOf('class="privateGameCount"'));
      assert.ok(summary.indexOf('class="privateGameCount"') < summary.indexOf('class="privateBaseDiamond"'));
      for (const [key, label] of [['balls', 'Bolas'], ['strikes', 'Strikes'], ['outs', 'Outs']]) {
        assert.ok(summary.includes(`<div data-count="${key}"><dt>${label}</dt><dd>${counts[key]}</dd></div>`));
      }
      assert.doesNotMatch(summary, /privatePitchCount|Parte baja · \d/);
      const summaryCard = html.slice(html.indexOf('aria-label="Pizarra por entradas y corredores en base"'), html.indexOf('</article>'));
      assert.match(summaryCard, /aria-label="Corredores en base"/);
      assert.doesNotMatch(summaryCard, /privateBattingQueue/);
      assert.equal((html.match(/class="privateBases"/g) ?? []).length, 1);
      assert.equal((html.match(/class="privateBattingQueue"/g) ?? []).length, 1);
      assert.ok(html.indexOf('class="privateBases"') < html.indexOf('class="privateBattingQueue"'));
      assert.doesNotMatch(html, /Cada batazo se guarda al pulsarlo/);
      if (mode === 'official' || mode === 'friendly')
        assert.match(html, /Las jugadas con opciones se guardan al confirmar/);
      if (mode === 'observation' || mode === 'public') {
        assert.doesNotMatch(summaryCard, /<button/);
      } else {
        assert.match(summaryCard, /aria-label="Home"/);
        assert.match(summaryCard, /aria-controls="private-base-menu-1"/);
      }
    }
  }
});
