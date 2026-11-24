const assert = require('node:assert/strict'), { test } = require('node:test'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const path = require.resolve('react-native');
const element = tag => ({ children, accessibilityLabel, value, disabled }) => React.createElement(tag, {
  'aria-label':accessibilityLabel,disabled,...(value===undefined?{}:{defaultValue:value})
},children);
require.cache[path] = {id:path,filename:path,loaded:true,exports:{
  Text:element('span'),View:element('div'),Pressable:element('button'),ScrollView:element('section'),TextInput:element('input'),StyleSheet:{create:value=>value}
}};
const { RosterRulesClient, rosterRulesDraft } = require('@playsport/shared');
const { RulesEditor } = require('../organizer-roster-rules');
for (const kind of ['date','round','games']) test(`native organizer ${kind} exposes calculation, four caps and explicit reopening`,t=>{
  const cutoff=kind==='date'?{kind,date:'2099-12-31'}:kind==='round'?{kind,round:2,moment:'finish',rounds:{one:1}}:{kind,games:3,count:'all-teams'};
  const view={tournamentId:'tour',organizerId:'org',tournamentName:'Prueba',revision:4,rules:{caps:{players:20,direction:3,coaches:4,support:2},cutoff},
    closed:true,reason:'Cierre global',closedAt:'2026-01-01T00:00:00Z',games:[{gameId:'one',homeTeamId:'A',awayTeamId:'B',label:'A vs B',status:'scheduled',started:false}],teamIds:['A','B']};
  const useState=React.useState;let index=0;
  t.mock.method(React,'useState',initial=>{
    const current=index++;return current===0?[view,()=>{}]:current===1?[rosterRulesDraft(view.rules),()=>{}]:current===3?[false,()=>{}]:useState(initial);
  });
  const html=renderToStaticMarkup(React.createElement(RulesEditor,{client:new RosterRulesClient('http://localhost:4000/api','org'),tournamentId:'tour',disabled:false,onBusy(){}}));
  for(const label of ['Jugadores','Dirección','Cuerpo técnico','Personal de apoyo','Una sola modalidad','Reabrir explícitamente','Guardar reglas del roster'])assert.ok(html.includes(label));
  assert.match(html,/Revisión 4/);assert.match(html,/value="20"/);
  if(kind==='games')for(const label of ['Total de partidos finalizados','primer equipo','todos los equipos'])assert.ok(html.includes(label));
  if(kind==='round')assert.match(html,/Ronda · A vs B · one/);
  assert.doesNotMatch(html,/Registrar jugada|Enviar alineación|Aprobar persona/);
});
