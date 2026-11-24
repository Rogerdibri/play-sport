const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
const { RosterClient, newPreRegistration } = require('@playsport/shared');
const platform = require('../app/platform-session'), hooks = require('../app/navigation-hooks');
const { default: Roster, RosterEditor, RosterTeams } = require('../app/demo/[slug]/manager-roster');
const { managerWorkContext } = require('../app/platform-navigation');
const team = { tournamentId:'another-tour',teamId:'another-team',managerId:'mgr-B',teamName:'Equipo elegido',tournamentName:'Torneo elegido' };
const render = (Component,props) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:{push(){}}},React.createElement(Component,props)));
function session(t, role='manager') {
  t.mock.method(platform,'usePlatformSession',()=>({ready:true,session:{version:1,role,team:'team-B'}}));
  t.mock.method(hooks,'useNavigationBusy',()=>{});
  t.mock.method(hooks,'useNavigationDraft',(_key,initial)=>[initial,()=>{},true]);
}
function editor(t, { draft=newPreRegistration(),person=null,admission,role='PLAYER' }={}) {
  session(t); let index=0; const useState=React.useState;
  t.mock.method(React,'useState',initial=>{
    const current=index++;
    if(current===0)return[{team,admission,members:[{person:{id:'PERSONID',identification:'',fullName:'Menor de prueba',isMinor:true,registrationStatus:'preinscribed'},role:'PLAYER',approvalStatus:'approved',addedBy:'manager',canInvite:true}]},()=>{}];
    if(current===1)return[person,()=>{}];
    if(current===3)return[false,()=>{}];
    return useState(initial);
  });
  t.mock.method(hooks,'useNavigationDraft',(key,initial)=>[key.endsWith(':missing')?!person:key.endsWith(':preinscription')?draft:key.endsWith(':role')?role:initial,()=>{},true]);
  return render(RosterEditor,{client:new RosterClient('http://localhost:4000/api','mgr-B'),team});
}
test('roster is gated to manager and does not impersonate other roles',t=>{
  for(const role of ['fan','player','organizer','scorekeeper','scout']){session(t,role);assert.match(render(Roster,{}),/corresponde al perfil Manager/);}
});
test('closed tournament and exhausted group disable only incorporation, retaining cargo changes and invitations', t => {
  const admission = { configured:true,closed:false,closedAt:null,reason:'Cierre global',groups:{
    players:{used:1,limit:1},direction:{used:0,limit:2},coaches:{used:0,limit:2},support:{used:0,limit:2}
  }};
  const person = {id:'another',identification:'V-95000001',fullName:'Persona existente',isMinor:false,registrationStatus:'registered'};
  let html = editor(t,{person,admission});
  assert.match(html,/<button[^>]*disabled=""[^>]*>Añadir al roster/);
  assert.match(html,/agotó su cupo/); assert.match(html,/Jugadores<span>1 \/ 1/);
  assert.doesNotMatch(html,/<select[^>]*disabled/); assert.match(html,/Invitación privada/);
  html = editor(t,{person,admission,role:'TRAINER'});
  assert.doesNotMatch(html,/<button[^>]*disabled=""[^>]*>Añadir al roster/);
  html = editor(t,{person,admission:{...admission,closed:true},role:'TRAINER'});
  assert.match(html,/INCORPORACIONES CERRADAS/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Añadir al roster/);
});
test('roster form and formatted rows remain separate from match lineups and private birth/contact data',t=>{
  const html=editor(t,{draft:{...newPreRegistration(),fullName:'Persona Ficticia',birthDate:'1990-01-01',phone:'04121234567'}});
  assert.match(html,/Plantilla del equipo/);assert.match(html,/Integrantes del roster · Equipo elegido/);
  assert.ok(html.indexOf('Plantilla del equipo') < html.indexOf('Incorporar una persona'));
  assert.match(html,/href="#roster-incorporation"/);
  for (const title of ['Jugadores','Dirección','Cuerpo técnico','Personal de apoyo']) assert.ok(html.includes(`aria-label="${title}"`));
  assert.match(html,/Coach de primera/);assert.match(html,/Coach de tercera/);assert.match(html,/Fisioterapeuta/);
  assert.match(html,/Pendiente de confirmación/);assert.match(html,/Incorporado por el manager/);
  assert.doesNotMatch(html,/Pendiente del organizador|Aprobación deportiva/);
  assert.doesNotMatch(html,/<input[^>]*type="email"[^>]*required/);
  const table=html.match(/<table[\s\S]*?<\/table>/)[0];
  assert.doesNotMatch(table,/1990-01-01|04121234567|Fecha de nacimiento|Correo de contacto/);
  assert.doesNotMatch(html,/Iniciar anotación|Enviar alineación|Turno al bate|Registrar jugada/);
});
test('roster always uses the entry team and tournament, never the first owned team or a second selector', t => {
  session(t);
  const useState = React.useState;
  for (const teamId of ['team-A','team-B']) {
    let index = 0;
    const context = managerWorkContext({version:1,role:'manager',team:teamId});
    const selected = {...context,teamName:`Elegido ${teamId}`,tournamentName:'Torneo de entrada'};
    t.mock.method(React,'useState', initial => index++ === 0 ? [[
      {...selected,teamId:'another-team',teamName:'Equipo que no se eligió'},
      {...selected,tournamentId:'another-tour',teamName:'Mismo equipo en otro torneo'},
      selected
    ],()=>{}] : useState(initial));
    const html = render(RosterTeams,context);
    assert.match(html,new RegExp(`Elegido ${teamId}`)); assert.match(html,/Torneo de entrada/);
    assert.doesNotMatch(html,/Equipo que no se eligió|Mismo equipo en otro torneo|Equipo y torneo del roster|<select/);
  }
});
test('missing entry team shows an explicit error instead of opening a different owned roster', t => {
  session(t);
  const useState=React.useState;let index=0;
  t.mock.method(React,'useState',initial=>index++===0?[[team],()=>{}]:useState(initial));
  const html=render(RosterTeams,{managerId:'mgr-B',teamId:'missing',tournamentId:team.tournamentId});
  assert.match(html,/El equipo elegido al entrar no está asignado/);
  assert.doesNotMatch(html,/Plantilla del equipo|Incorporar una persona/);
});
test('email-only preregistration makes the phone optional and minors use representative contact',t=>{
  let html=editor(t,{draft:{...newPreRegistration(),birthDate:'2015-01-01',email:'responsable@example.test'}});
  assert.match(html,/Correo del representante/);assert.match(html,/Teléfono del representante/);assert.match(html,/Cédula del representante/);
  assert.doesNotMatch(html,/<input[^>]*type="tel"[^>]*required/);
});
test('existing people expose only cargo selection and cannot have private personal data overwritten',t=>{
  const html=editor(t,{person:{id:'existing',identification:'V-94000001',fullName:'Persona existente',isMinor:false,registrationStatus:'registered'}});
  assert.match(html,/Persona existente/);assert.match(html,/Cargo en el equipo/);assert.match(html,/Añadir al roster/);
  assert.doesNotMatch(html,/Fecha de nacimiento de la persona|Correo de contacto|Nombre y apellido<\/span><input/);
});
