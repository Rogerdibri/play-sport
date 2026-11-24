const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
const { RosterRulesClient, rosterRulesDraft } = require('@playsport/shared');
const hooks = require('../app/navigation-hooks'), platform = require('../app/platform-session');
const { default: Organizer, OrganizerRulesPanel, RulesEditor } = require('../app/demo/[slug]/organizer-roster-rules');
const caps = { players:20,direction:3,coaches:4,support:2 };
const render = (Component, props) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:{push(){}}},React.createElement(Component,props)));
for (const kind of ['date','round','games']) test(`organizer ${kind} editor shows actual caps, calculation and explicit reopening without lineup controls`, t => {
  const cutoff = kind === 'date' ? {kind,date:'2099-12-31'} : kind === 'round' ? {kind,round:2,moment:'finish',rounds:{one:1}} : {kind,games:3,count:'all-teams'};
  const view = { tournamentId:'tour',organizerId:'org',tournamentName:'Prueba',revision:4,rules:{caps,cutoff},closedAt:'2026-01-01T00:00:00Z',
    closed:true,reason:'Cierre global',games:[{gameId:'one',homeTeamId:'A',awayTeamId:'B',label:'A vs B',status:'scheduled',started:false}],teamIds:['A','B'] };
  const useState = React.useState; let index = 0;
  t.mock.method(hooks,'useNavigationBusy',()=>{});
  t.mock.method(React,'useState',initial => {
    const current=index++;
    return current===0 ? [view,()=>{}] : current===1 ? [rosterRulesDraft(view.rules),()=>{}] : current===3 ? [false,()=>{}] : useState(initial);
  });
  const html = render(RulesEditor,{client:new RosterRulesClient('http://localhost:4000/api','org'),tournamentId:'tour'});
  for (const label of ['Jugadores','Dirección','Cuerpo técnico','Personal de apoyo','Una sola modalidad','Reabrir explícitamente','Guardar reglas del roster']) assert.ok(html.includes(label));
  assert.match(html,/Revisión 4/); assert.match(html,/value="20"/);
  assert.match(html,/class="organizerRulesToolbar"/);
  assert.match(html,/aria-label="Recargar reglas y descartar cambios sin guardar"[^>]*>Recargar reglas<\/button>/);
  assert.match(html,/class="organizerSaveActions"/);
  assert.match(html,/class="organizerReopen"/);
  if(kind==='games') for (const label of ['Total de partidos finalizados','primer equipo','todos los equipos']) assert.ok(html.includes(label));
  if(kind==='round') {assert.match(html,/Ronda · A vs B · one/); assert.match(html,/finalizar todos los partidos/);}
  assert.doesNotMatch(html,/Registrar jugada|Enviar alineación|Posición defensiva|Aprobar persona/);
});
test('organizer shortcuts retain tournament tools without a separate logos button', () => {
  const html = render(OrganizerRulesPanel, { organizerId: 'org-demo' });
  assert.match(html, /rosterWorkspace organizerRosterWorkspace/);
  assert.match(html, /<nav class="organizerShortcuts" aria-label="Herramientas del organizador">/);
  for (const href of ['/demo/tournaments', '/demo/live-scoring?view=organizer'])
    assert.ok(html.includes(`href="${href}"`));
  assert.equal((html.match(/class="managerButtonOutline"/g) || []).length, 2);
  assert.doesNotMatch(html, /href="\/identity"/);
});
test('organizer panel never impersonates another selected role', t => {
  for (const role of ['manager','scorekeeper','player','fan','scout']) {
    t.mock.method(platform,'usePlatformSession',()=>({ready:true,session:{version:1,role,team:'team-A'}}));
    assert.match(render(Organizer,{}),/organizador propietario/);
  }
});
