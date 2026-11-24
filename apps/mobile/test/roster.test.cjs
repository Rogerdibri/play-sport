const assert=require('node:assert/strict'),{test}=require('node:test'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const path=require.resolve('react-native');
const element=tag=>({children,accessibilityLabel,onPress,value,disabled})=>React.createElement(tag,{'aria-label':accessibilityLabel,onClick:onPress,disabled,...(value===undefined?{}:{defaultValue:value})},children);
require.cache[path]={id:path,filename:path,loaded:true,exports:{Text:element('span'),View:element('div'),Pressable:element('button'),ScrollView:element('section'),TextInput:element('input'),StyleSheet:{create:value=>value}}};
const {RosterClient,newPreRegistration}=require('@playsport/shared');
const {default:ManagerRoster,RosterEditor}=require('../manager-roster');
test('native roster supports roles and representative preregistration without scorekeeping controls',t=>{
  const useState=React.useState;let index=0;
  const team={tournamentId:'tour',teamId:'home',managerId:'mgr-home',teamName:'Equipo de prueba',tournamentName:'Torneo de prueba'};
  t.mock.method(React,'useState',initial=>{
    const current=index++;
    if(current===0)return[{team,members:[]},()=>{}];
    if(current===4)return[{...newPreRegistration(),birthDate:'2015-03-20'},()=>{}];
    if(current===5)return[true,()=>{}];
    if(current===7)return[false,()=>{}];
    return useState(initial);
  });
  const html=renderToStaticMarkup(React.createElement(RosterEditor,{client:new RosterClient('http://localhost:4000/api','mgr-home'),team,disabled:false,onBusy(){}}));
  for(const text of ['Plantilla del equipo','Coach de primera','Coach de tercera','Correo del representante','Teléfono del representante','Cédula del representante'])assert.ok(html.includes(text));
  assert.ok(html.indexOf('Plantilla del equipo')<html.indexOf('Incorporar una persona'));
  assert.doesNotMatch(html,/Registrar jugada|Iniciar anotación|Enviar alineación|Turno al bate/);
});
test('native roster inherits the selected team and tournament without an internal team picker',t=>{
  const useState=React.useState;let index=0;
  const team={tournamentId:'tour',teamId:'chosen',managerId:'manager',teamName:'Equipo elegido',tournamentName:'Torneo elegido'};
  t.mock.method(React,'useState',initial=>index++===0?[[{...team,teamId:'other',teamName:'Equipo ajeno al contexto'},team],()=>{}]:useState(initial));
  const html=renderToStaticMarkup(React.createElement(ManagerRoster,{apiBase:'http://localhost:4000/api',...team,disabled:false,onBusy(){}}));
  assert.match(html,/Equipo elegido/);assert.match(html,/Torneo elegido/);
  assert.doesNotMatch(html,/Equipo ajeno al contexto|role="radio"/);
});
test('native roster exhausted player cap preserves other cargo choices; global closure blocks every cargo',t=>{
  const useState=React.useState;
  const team={tournamentId:'tour',teamId:'home',managerId:'mgr-home',teamName:'Equipo',tournamentName:'Torneo'};
  for(const [closed,role,blocked] of [[false,'PLAYER',true],[false,'TRAINER',false],[true,'TRAINER',true]]){
    let index=0;
    const admission={configured:true,closed,closedAt:null,reason:'Cierre global',groups:{
      players:{used:1,limit:1},direction:{used:0,limit:2},coaches:{used:0,limit:2},support:{used:0,limit:2}
    }};
    t.mock.method(React,'useState',initial=>{
      const current=index++;
      if(current===0)return[{team,admission,members:[]},()=>{}];
      if(current===1)return[{id:'person',identification:'V-95000001',fullName:'Persona Ficticia',registrationStatus:'registered'},()=>{}];
      if(current===3)return[role,()=>{}];if(current===7)return[false,()=>{}];
      return useState(initial);
    });
    const html=renderToStaticMarkup(React.createElement(RosterEditor,{client:new RosterClient('http://localhost:4000/api','mgr-home'),team,disabled:false,onBusy(){}}));
    assert.equal(/<button[^>]*disabled=""[^>]*><span>Añadir al roster/.test(html),blocked);
    assert.doesNotMatch(html,/<button[^>]*disabled=""[^>]*><span>Coach de primera/);
    if(closed)assert.match(html,/INCORPORACIONES CERRADAS/);
  }
});
