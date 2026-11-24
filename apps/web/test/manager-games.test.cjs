const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
const platform = require('../app/platform-session');
const hooks = require('../app/navigation-hooks');
const catalog = require('../app/demo/[slug]/use-public-official-games');
const Inbox = require('../app/demo/[slug]/manager-game-inbox').default;
const TeamSheetInbox = require('../app/demo/[slug]/team-sheet-inbox').default;
const Home = require('../app/page').default;
const Manager = require('../app/demo/[slug]/live-scoring-manager-demo').default;
const Details = require('../app/demo/[slug]/official-game-details').default;
const PersonnelRequests = require('../app/demo/[slug]/manager-personnel-requests').default;
const { TeamSheetPanel } = require('../app/demo/[slug]/team-sheets');
const game = { gameId: 'different-game', tournamentId: 'different-tour', managerTeamId: 'visitors', homeTeamId: 'locals', awayTeamId: 'visitors',
  status: 'scheduled', homeScore: 0, awayScore: 0, assignedScorekeeperIds: [], availableScorekeeperIds: [],
  details: { tournamentName: 'Otro torneo', homeTeamName: 'Locales diferentes', awayTeamName: 'Equipo del manager', date: '2026-11-12', time: '19:30', venue: 'Otra sede' } };
const render = (Component, props) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider,
  { value: { push() {} } }, React.createElement(Component, props)));
const session = (t, role = 'manager', team = 'team-B') => {
  t.mock.method(platform, 'usePlatformSession', () => ({ ready: true, session: { version:1, role, team } }));
  t.mock.method(hooks, 'useNavigationDraft', (_key, initial) => [initial, () => {}, true]);
  t.mock.method(hooks, 'useScreenBack', () => {});
  t.mock.method(hooks, 'useNavigationBusy', () => {});
};
test('home keeps assigned games separate from the new roster module', t => {
  session(t);
  const html = render(Home, {});
  assert.match(html, /aria-label="ROSTER"/);
  assert.match(html, /href="\/demo\/roster"/);
  assert.equal((html.match(/aria-label="Mis partidos asignados"/g) ?? []).length, 1);
  assert.match(html, /href="\/demo\/manager-games"/);
});
test('manager inbox uses its profile and does not show scorer examples or assignment controls', t => {
  session(t);
  const html = render(Inbox, {});
  assert.match(html, /Mis partidos asignados/); assert.match(html, /MANAGER/);
  assert.match(html, /Consultando partidos/);
  assert.doesNotMatch(html, /Explora con ejemplos|Pizarra en vivo|Partidos y anotadores|Asignación guardada/);
});
test('manager assignments exclude another team or tournament owned by the same manager', async t => {
  session(t);
  const useState=React.useState, effects=[];let index=0,loaded;
  t.mock.method(React,'useState',initial=>{
    const state=useState(initial);
    return index++===0?[state[0],value=>{loaded=value;}]:state;
  });
  t.mock.method(React,'useEffect',effect=>effects.push(effect));
  t.mock.method(global,'fetch',async()=>({ok:true,json:async()=>({userId:'mgr-B',role:'manager',games:[
    game,{...game,gameId:'other-tournament',tournamentId:'other-tour'},
    {...game,gameId:'other-team-game',managerTeamId:'other-team',homeTeamId:'other-team'}
  ]})}));
  render(TeamSheetInbox,{view:'manager',managerId:'mgr-B',managerTeam:{teamId:'visitors',tournamentId:'different-tour'}});
  const cleanups=effects.map(effect=>effect());
  try {await new Promise(setImmediate);assert.deepEqual(loaded.games.map(row=>row.gameId),[game.gameId]);}
  finally {for(const cleanup of cleanups)if(typeof cleanup==='function')cleanup();}
});
for (const requested of ['different-game','foreign-game']) test(`manager direct entry validates the requested game instead of reopening another lineup: ${requested}`,t=>{
  session(t);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{search:`?game=${requested}`}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'location',descriptor);else delete globalThis.location;});
  const useState=React.useState,effects=[];let index=0,selected,notice;
  t.mock.method(React,'useState',initial=>{
    const state=useState(initial),current=index++;
    if(current===0)return [{games:[game],userId:'mgr-B',role:'manager'},()=>{}];
    if(current===1)return [null,value=>{selected=value;}];
    if(current===5)return ['',value=>{notice=value;}];
    return state;
  });
  t.mock.method(React,'useEffect',effect=>effects.push(effect));
  render(TeamSheetInbox,{view:'manager',managerId:'mgr-B',managerTeam:{teamId:'visitors',tournamentId:'different-tour'}});
  effects[1]();
  if(requested===game.gameId)assert.equal(selected,game.gameId);
  else {assert.equal(selected,undefined);assert.match(notice,/no está asignado al equipo y torneo/);}
});
test('other roles cannot open a manager inbox by a direct link', t => {
  for (const role of ['fan','player','organizer','scorekeeper','scout']) {
    session(t, role);
    const html = render(Inbox, {});
    assert.match(html, /corresponde al perfil Manager/);
    assert.doesNotMatch(html, /Partidos oficiales|Preparar lineup/);
  }
});
test('the reused manager workspace displays the selected game, tournament and own side without a global-demo fallback', t => {
  session(t);
  t.mock.method(catalog, 'default', () => ({ games: [game], error: '', refresh() {} }));
  const html = render(Manager, { assignment: game, managerId: 'mgr-B' });
  assert.match(html, /Otro torneo/); assert.match(html, /Equipo del manager/);
  assert.match(html, /Equipo del manager vs. Locales diferentes/);
  assert.doesNotMatch(html, /Sin partido asignado|Usa tour-global-1|Resultados confirmados del calendario de demostración/);
  assert.doesNotMatch(html, /Registrar decisión de mesa técnica|Confirmar suspensión|Guardar nueva fecha/);
});
test('preparation keeps the leader, lineup and optional staff selection without repeating the full roster', t => {
  session(t);
  t.mock.method(catalog,'default',()=>({games:[game],error:'',refresh(){}}));
  const players = [{identificationNumber:'PLAYER1',displayName:'Jugador de prueba'}];
  const roster = {team:{teamId:'visitors',tournamentId:'different-tour',managerId:'mgr-B',teamName:'Equipo del manager',tournamentName:'Otro torneo'},members:[
    {person:{id:'PLAYER1',identification:'PLAYER1',fullName:'Jugador de prueba',isMinor:false,registrationStatus:'sports-record'},role:'PLAYER',approvalStatus:'approved'},
    {person:{id:'PERSONCOACH',identification:'V-98000001',fullName:'Coach de prueba',isMinor:false,registrationStatus:'preinscribed'},role:'COACH_FIRST',approvalStatus:'approved'}
  ]};
  const useState=React.useState;let index=0;
  t.mock.method(React,'useState',initial=>{
    const current=index++;
    return current===0?[true,()=>{}]:current===1?[['PLAYER1'],()=>{}]:current===2?[players,()=>{}]:current===3?[roster,()=>{}]:useState(initial);
  });
  const html=render(Manager,{assignment:game,managerId:'mgr-B'});
  for(const text of ['Datos fijos del partido asignado','Personal técnico presente (opcional)','Seleccionar dirigente desde el roster',
    'Coach de prueba','Coach de primera','Cuadro de lineup','Presente en este partido','Enviar alineación con posiciones'])assert.ok(html.includes(text),text);
  assert.ok(html.indexOf('Cuadro de lineup') < html.indexOf('Suplentes presentes y envío'));
  assert.doesNotMatch(html,/Roster completo para preparar este partido|managerRosterPreparation|Roster del partido ·/);
  assert.doesNotMatch(html,/Cantidad de bateadores/);
  assert.equal((html.match(/class="managerLineupRowButton"/g)||[]).length,13);
  assert.doesNotMatch(html,/Generar alineación base|Identificador del jugador para la alineación|Camisetas de los 23 jugadores/);
  assert.doesNotMatch(html,/Verificar partido|Confirmar partido y continuar|Volver a la autorización|Cédula del representante en el campo/);
  assert.match(html,/<option value="PERSONCOACH">Coach de prueba/);
});
test('bench cards show only players outside the lineup and count only selected eligible substitutes',t=>{
  session(t);
  t.mock.method(catalog,'default',()=>({games:[game],error:'',refresh(){}}));
  const players=[{identificationNumber:'STARTER',displayName:'Titular elegido'},{identificationNumber:'BENCH1',displayName:'Suplente presente'},{identificationNumber:'BENCH2',displayName:'Suplente pendiente'}];
  t.mock.method(hooks,'useNavigationDraft',(key,initial)=>[
    key.endsWith(':entries')?[{identificationNumber:'STARTER',battingOrder:1,fieldPosition:'P',lineupRole:'PLAYER',jerseyNumber:'00'}]:
      key.endsWith(':substitutes')?['STARTER','BENCH1','FOREIGN']:initial,()=>{},true]);
  const useState=React.useState;let index=0;
  t.mock.method(React,'useState',initial=>{
    const current=index++;
    return current===0?[true,()=>{}]:current===1?[players.map(row=>row.identificationNumber),()=>{}]:current===2?[players,()=>{}]:useState(initial);
  });
  const html=render(Manager,{assignment:game,managerId:'mgr-B'});
  assert.equal((html.match(/class="baseballBenchPlayer/g)||[]).length,2);
  assert.match(html,/class="baseballBenchPlayer is-present"/);
  assert.match(html,/1 presentes · 2 disponibles/);
  assert.match(html,/aria-label="Suplente presente: Suplente presente" checked=""/);
  assert.match(html,/aria-label="Suplente presente: Suplente pendiente"/);
  assert.doesNotMatch(html,/aria-label="Suplente presente: Titular elegido"|Roster completo para preparar este partido/);
});
test('terminal detail can return to manager assignments rather than redirecting into Cartelera', t => {
  session(t);
  t.mock.method(catalog, 'default', () => ({ games: [], error: '', refresh() {} }));
  const html = render(Details, { gameId: game.gameId, onBack() {} });
  assert.match(html, /Volver a mis partidos asignados/);
  assert.doesNotMatch(html, /Volver a la cartelera/);
});
test('a delivered lineup stays read-only and never exposes the draft row buttons',t=>{
  session(t);
  t.mock.method(catalog,'default',()=>({games:[game],error:'',refresh(){}}));
  const player={identificationNumber:'PLAYER1',displayName:'Jugador entregado',battingOrder:1,fieldPosition:'P',lineupRole:'PLAYER',jerseyNumber:'00'};
  const sheet={teamId:'visitors',managerId:'mgr-B',revision:1,lineup:[player],initialLineup:[player],
    presentSubstitutes:[{identificationNumber:'BENCH1',displayName:'Suplente confirmado'}],presentOfficials:[],recipients:[],representative:null};
  const useState=React.useState;let index=0;
  t.mock.method(React,'useState',initial=>{
    const current=index++;
    return current===0?[true,()=>{}]:current===4?[sheet,()=>{}]:useState(initial);
  });
  const html=render(Manager,{assignment:game,managerId:'mgr-B'});
  assert.match(html,/Alineación ya entregada/);
  assert.match(html,/Jugador entregado/);
  assert.match(html,/class="baseballBenchPlayer is-present"/);
  assert.match(html,/Suplente confirmado/);
  assert.match(html,/Confirmado/);
  assert.doesNotMatch(html,/aria-label="Suplente presente:/);
  assert.doesNotMatch(html,/managerLineupRowButton|Editar turno|Cuadro de lineup|Reiniciar lineup/);
});
for(const [status,canWithdraw,expected]of [['scheduled',true,true],['scheduled',false,false],['in_progress',true,false],['scheduled',undefined,false]]){
  test(`withdrawal is offered only with server permission before first pitch: ${status}/${canWithdraw}`,t=>{
    session(t);
    t.mock.method(catalog,'default',()=>({games:[{...game,status}],error:'',refresh(){}}));
    const sheet={teamId:'visitors',managerId:'mgr-B',revision:1,canWithdraw,lineup:[],initialLineup:[],
      presentSubstitutes:[],presentOfficials:[],recipients:[],representative:null};
    const useState=React.useState;let index=0;
    t.mock.method(React,'useState',initial=>{
      const current=index++;
      return current===0?[true,()=>{}]:current===4?[sheet,()=>{}]:current===5?[3,()=>{}]:useState(initial);
    });
    const html=render(Manager,{assignment:game,managerId:'mgr-B'});
    assert.equal(html.includes('Cancelar lineup enviado'),expected);
    assert.doesNotMatch(html,/managerLineupRowButton/);
    assert.match(html,/baseballMatchup|baseballGameFacts/);
  });
}
const managerConnection = () => ({
  draftScope: 'different-tour:different-game:mgr-B', busy: false, refresh() {},
  data: { ownTeamId: 'visitors', canDecide: false, requests: [], sheets: [{
    teamId: 'visitors', revision: 1, recipients: [], presentOfficials: [],
    lineup: [{ identificationNumber: 'ACTIVE', displayName: 'Jugador activo', battingOrder: 1, fieldPosition: 'P', jerseyNumber: '1' }],
    initialLineup: [{ identificationNumber: 'ACTIVE', displayName: 'Jugador activo', battingOrder: 1, fieldPosition: 'P', jerseyNumber: '1' }],
    presentSubstitutes: [{ identificationNumber: 'BENCH', displayName: 'Suplente confirmado' }]
  }] }
});
test('assigned-game personnel controls request changes without approving or changing batting order', t => {
  session(t);
  const html = render(PersonnelRequests, { connection: managerConnection(), state: { bases: [null,null,null] }, disabled: false });
  assert.match(html, /Sustitución/); assert.match(html, /Cambio defensivo/); assert.match(html, /Corredor de cortesía/);
  assert.match(html, /Suplente confirmado/); assert.match(html, /Jugador activo/);
  assert.match(html, /Esto no registra jugadas ni aprueba el cambio/);
  assert.doesNotMatch(html, /Confirmar movimiento|Iniciar anotación|Orden de bateo editable/);
});
for(const kind of ['substitution','defense'])test(`manager ${kind} positions cannot increase or reduce the original defensive count`,t=>{
  session(t);
  const connection=managerConnection(),sheet=connection.data.sheets[0];
  const extra={identificationNumber:'EXTRA',displayName:'Bateador extra',battingOrder:2,fieldPosition:'NA',jerseyNumber:'2',lineupRole:'EH'};
  sheet.lineup.push(extra);sheet.initialLineup.push({...extra});
  t.mock.method(hooks,'useNavigationDraft',(key,initial)=>[
    key.endsWith(':kind')?kind:key.endsWith(':outgoing')?'ACTIVE':key.endsWith(':player')?'EXTRA':initial,()=>{},true]);
  const html=render(PersonnelRequests,{connection,state:{bases:[null,null,null]},disabled:false});
  const options=html.match(/Posición defensiva solicitada<\/span><select[^>]*>(.*?)<\/select>/)[1];
  assert.match(html,/cantidad de defensores quedan fijos/);
  assert.ok(options.includes('value="P"'));
  if(kind==='substitution')assert.doesNotMatch(options,/value="DH"|value="NA"/);
  else assert.doesNotMatch(options,/value="OF4"|value="SF"/);
});
test('arrival and staff requests are enabled only for the new manager workflow', t => {
  session(t);
  const props = { connection: managerConnection(), names: { visitors: 'Mi equipo' }, positionLabels: { P: 'Lanzador' } };
  assert.doesNotMatch(render(TeamSheetPanel, props), /Comunicar llegada tardía para confirmación/);
  const html = render(TeamSheetPanel, { ...props, allowManagerRequests: true });
  assert.match(html, /Comunicar llegada tardía para confirmación/);
  assert.match(html, /Agregar directivo presente/);
  assert.doesNotMatch(html, /Confirmar movimiento|Rechazar movimiento/);
});
test('recipients see why a pending movement was closed when its manager withdrew the lineup',t=>{
  session(t);
  const connection=managerConnection();
  connection.data.requests=[{id:'withdrawn-request',teamId:'visitors',status:'rejected',action:{kind:'arrival',identificationNumber:'LATE'},
    decidedBy:null,decisionNote:'El dirigente canceló la alineación antes del inicio del partido.'}];
  const html=render(TeamSheetPanel,{connection,names:{visitors:'Mi equipo'},positionLabels:{P:'Lanzador'}});
  assert.match(html,/El dirigente canceló la alineación antes del inicio/);
  assert.doesNotMatch(html,/Confirmar movimiento|Rechazar movimiento/);
});
test('manager change form respects a lifecycle lock and excludes official decision accounts', t => {
  session(t);
  const connection = managerConnection();
  assert.match(render(PersonnelRequests, { connection, state: { bases: [null,null,null] }, disabled: true }), /<fieldset[^>]*disabled/);
  connection.data.canDecide = true;
  assert.equal(render(PersonnelRequests, { connection, state: { bases: [null,null,null] }, disabled: false }), '');
});
