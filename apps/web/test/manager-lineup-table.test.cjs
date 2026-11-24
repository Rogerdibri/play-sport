const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { default: Table, changeLineupRow, lineupTableError, lineupJerseyNumbers, resetLineupRows } = require('../app/demo/[slug]/manager-lineup-table');
const positions = ['P','C','1B','2B','3B','SS','LF','CF','RF'];
const players = Array.from({length:14},(_,index)=>({identificationNumber:`PLAYER${index+1}`,displayName:`Jugador ${index+1}`}));
const ids = players.map(player=>player.identificationNumber);
const valid = () => positions.map((fieldPosition,index)=>({
  identificationNumber:ids[index],battingOrder:index+1,fieldPosition,lineupRole:'PLAYER',jerseyNumber:String(index).padStart(2,'0')
}));
const render = (entries=[],disabled=false) => renderToStaticMarkup(React.createElement(Table,{entries,players,disabled,onChange(){}}));
const select = (html,label) => {
  const found=html.match(new RegExp(`<select aria-label="${label}"[^>]*>(.*?)</select>`));
  assert.ok(found,`Selector ${label}`);
  return found[0];
};
test('a new lineup always offers thirteen empty rows with no batting-count selector',()=>{
  const html=render([]);
  assert.equal((html.match(/class="managerLineupRowButton"/g)||[]).length,13);
  assert.doesNotMatch(html,/Cantidad de bateadores|Elige cuántos batearán/);
  assert.match(html,/mínimo 9/);
  assert.match(lineupTableError([],ids),/al menos 9 titulares/);
});
for(const count of [9,10,11,12,13])test(`${count} completed batters can be delivered while trailing empty rows remain optional`,()=>{
  const completed=[...valid(),...Array.from({length:count-9},(_,index)=>({
    identificationNumber:ids[index+9],battingOrder:index+10,fieldPosition:'NA',lineupRole:'EH',jerseyNumber:String(index+10)
  }))];
  const rows=[...completed,...resetLineupRows().slice(count)];
  assert.equal(lineupTableError(rows,ids),null);
  const saved=JSON.parse(JSON.stringify(rows));
  assert.deepEqual(saved,rows);
  assert.equal((render(saved).match(/class="managerLineupRowButton"/g)||[]).length,13);
  assert.deepEqual(saved.filter(row=>row.identificationNumber),completed);
});
test('the selected batting rows expose roster, exactly 00 through 99, and predefined positions without text inputs',()=>{
  const html=render();
  assert.equal((html.match(/<th scope="row">/g)||[]).length,13);
  assert.match(html,/Lineup del partido · orden de bateo/);
  assert.doesNotMatch(html,/<input|Generar alineación/);
  assert.equal(lineupJerseyNumbers.length,100);
  assert.equal(new Set(lineupJerseyNumbers).size,100);
  assert.equal(lineupJerseyNumbers[0],'00');assert.equal(lineupJerseyNumbers[99],'99');
  const jerseys=select(html,'Camiseta del turno 1');
  assert.equal((jerseys.match(/<option/g)||[]).length,101);
  for(const number of lineupJerseyNumbers)assert.ok(jerseys.includes(`value="${number}"`));
  assert.match(jerseys,/disabled=""/);
  assert.match(select(html,'Posición del turno 1'),/disabled=""/);
  for(const id of ids)assert.ok(select(html,'Jugador del turno 1').includes(`value="${id}"`));
});
test('every complete row remains a button that can reopen its editor before delivery',()=>{
  const html=render(valid());
  assert.equal((html.match(/class="managerLineupRowButton"/g)||[]).length,13);
  assert.equal((html.match(/aria-expanded="false"/g)||[]).length,13);
  assert.equal((html.match(/class="managerLineupEditor" hidden=""/g)||[]).length,13);
  for(let turn=1;turn<=9;turn++)assert.match(html,new RegExp(`aria-label="Editar turno ${turn}"`));
  assert.match(html,/class="baseballSrOnly">Camiseta <\/span>00/);
  assert.match(html,/Jugador 1/);
  assert.match(html,/Terminar edición del turno 1/);
});
test('player selection uses a collapsing dropdown and immediately enables defensive positions without a jersey prerequisite',()=>{
  const entries=changeLineupRow([],1,{identificationNumber:ids[0]});
  const html=render(entries);
  assert.doesNotMatch(select(html,'Jugador del turno 1'),/\bsize=/);
  assert.doesNotMatch(select(html,'Posición del turno 1'),/\bdisabled=/);
  assert.doesNotMatch(select(html,'Camiseta del turno 1'),/\bdisabled=/);
  for(const position of positions)assert.ok(select(html,'Posición del turno 1').includes(`value="${position}"`));
  assert.equal(entries[0].jerseyNumber,'');
  assert.equal(entries[0].fieldPosition,'');
  const defenseFirst=changeLineupRow(entries,1,{fieldPosition:'P'});
  assert.match(lineupTableError(defenseFirst,ids),/camiseta/);
});
test('reset is available only for a draft with rows and requires explicit confirmation',t=>{
  assert.match(render(valid()),/>Reiniciar lineup<\/button>/);
  assert.doesNotMatch(render(valid()),/Confirmar reinicio del lineup/);
  assert.match(render(),/disabled="">Reiniciar lineup<\/button>/);
  const useState=React.useState;let index=0;
  t.mock.method(React,'useState',initial=>index++===1?[true,()=>{}]:useState(initial));
  const html=render(valid());
  assert.match(html,/Confirmar reinicio del lineup/);
  assert.match(html,/Sí, reiniciar desde cero/);
  assert.match(html,/>Cancelar<\/button>/);
  assert.match(html,/Quedarán las 13 filas disponibles, todas vacías/);
  assert.match(html,/No se modifica el roster, el dirigente, los suplentes ni el personal presente/);
});
test('legacy drafts keep their players and reset restores all thirteen rows without FLEX',()=>{
  const original=valid();
  assert.equal((render(original).match(/class="managerLineupRowButton"/g)||[]).length,13);
  const populated=changeLineupRow(original,13,{identificationNumber:ids[12]});
  const withFlex=changeLineupRow(populated,null,{identificationNumber:ids[13],jerseyNumber:'99',fieldPosition:'OF4'});
  const reset=resetLineupRows();
  assert.equal(reset.length,13);
  assert.deepEqual(reset.map(row=>row.battingOrder),Array.from({length:13},(_,index)=>index+1));
  assert.ok(reset.every(row=>!row.identificationNumber&&!row.jerseyNumber&&!row.fieldPosition&&row.lineupRole==='PLAYER'));
  assert.equal((render(reset).match(/class="managerLineupRowButton"/g)||[]).length,13);
  assert.deepEqual(withFlex.slice(0,9),original);
  assert.equal(withFlex.at(-1).lineupRole,'FLEX');
  const roleOnly=changeLineupRow(original,13,{lineupRole:'EH'});
  assert.match(lineupTableError(roleOnly,ids),/jugador del roster.*turno 13/);
});
test('restructuring a completed draft row keeps its slot and every other batter unchanged',()=>{
  const original=valid();
  const jerseyEdit=changeLineupRow(original,1,{jerseyNumber:'99'});
  assert.equal(jerseyEdit[0].fieldPosition,'P');
  assert.equal(jerseyEdit[0].identificationNumber,ids[0]);
  const replacement=changeLineupRow(jerseyEdit,1,{identificationNumber:ids[12]});
  assert.equal(replacement[0].battingOrder,1);
  assert.equal(replacement[0].jerseyNumber,'');
  assert.equal(replacement[0].fieldPosition,'');
  const completed=changeLineupRow(replacement,1,{jerseyNumber:'99',fieldPosition:'P'});
  assert.deepEqual(completed.slice(1),original.slice(1));
  assert.equal(lineupTableError(completed,ids),null);
  assert.equal(original[0].jerseyNumber,'00');
});
test('choosing, clearing and replacing a row never shifts batting order or fills a jersey automatically',()=>{
  let entries=changeLineupRow([],4,{identificationNumber:ids[3]});
  assert.equal(entries[0].battingOrder,4);assert.equal(entries[0].jerseyNumber,'');assert.equal(entries[0].fieldPosition,'');
  entries=changeLineupRow(entries,4,{jerseyNumber:'99',fieldPosition:'CF'});
  entries=changeLineupRow(entries,1,{identificationNumber:ids[0]});
  entries=changeLineupRow(entries,1,{identificationNumber:''});
  assert.equal(entries.find(row=>row.battingOrder===4).identificationNumber,ids[3]);
  entries=changeLineupRow(entries,4,{identificationNumber:ids[4]});
  assert.deepEqual(entries[1],{identificationNumber:ids[4],battingOrder:4,fieldPosition:'',jerseyNumber:'',lineupRole:'PLAYER'});
  const restored=JSON.parse(JSON.stringify(entries));
  assert.deepEqual(restored,entries);
  assert.match(select(render(restored),'Jugador del turno 4'),new RegExp(`value="${ids[4]}" selected`));
});
test('other rows cannot select an occupied player, jersey or position while a row keeps its own choices',()=>{
  const entries=valid();
  entries[0].jerseyNumber='1';entries[1].jerseyNumber='00';
  const html=render(entries);
  assert.doesNotMatch(select(html,'Jugador del turno 2'),/value="PLAYER1"/);
  assert.match(select(html,'Jugador del turno 1'),/value="PLAYER1" selected/);
  assert.match(select(html,'Camiseta del turno 2'),/value="01" disabled/);
  assert.match(select(html,'Camiseta del turno 1'),/value="01" selected/);
  assert.doesNotMatch(select(html,'Posición del turno 2'),/value="P"/);
  assert.match(select(html,'Posición del turno 1'),/value="P" selected/);
  assert.match(select(html,'Posición del turno 2'),/value="NA"/);
  assert.match(select(html,'Posición del turno 2'),/value="C" selected/);
});
test('valid manual rows preserve 00 and 99 but every selected batting row must be completed',()=>{
  const entries=valid();entries[8].jerseyNumber='99';
  assert.equal(lineupTableError(entries,ids),null);
  const extra=changeLineupRow(entries,10,{});
  assert.equal(lineupTableError(extra,ids),null);
  extra[9].identificationNumber=ids[9];
  assert.match(lineupTableError(extra,ids),/camiseta.*turno 10/);
  extra[9].jerseyNumber='90';
  assert.match(lineupTableError(extra,ids),/posición del turno 10/);
  extra[9].fieldPosition='NA';extra[9].lineupRole='EH';
  assert.equal(lineupTableError(extra,ids),null);
});
test('incomplete rows, foreign players and holes cannot be submitted or silently renumbered',()=>{
  for(const [patch,pattern] of [
    [{identificationNumber:'FOREIGN'},/roster/],
    [{jerseyNumber:''},/camiseta/],
    [{jerseyNumber:'100'},/00 al 99/],
    [{fieldPosition:''},/posición/],
    [{fieldPosition:'INVALID'},/posición/]
  ]){
    const entries=valid();Object.assign(entries[0],patch);
    assert.match(lineupTableError(entries,ids),pattern);
  }
  const hole=valid();hole[8].battingOrder=10;
  assert.match(lineupTableError(hole,ids),/sin dejar filas vacías/);
  assert.match(lineupTableError(valid().slice(0,8),ids),/al menos 9 titulares/);
});
test('optional rows may be empty but cannot contain only a role, jersey, position or player',()=>{
  for(const patch of [{lineupRole:'EH'},{jerseyNumber:'90'},{fieldPosition:'NA'},{identificationNumber:ids[9]}]){
    const entries=changeLineupRow([...valid(),...resetLineupRows().slice(9)],10,patch);
    assert.notEqual(lineupTableError(entries,ids),null);
  }
});
test('duplicate players, canonical jersey values and defensive positions are rejected',()=>{
  for(const [patch,pattern] of [
    [{identificationNumber:ids[0]},/dos filas/],
    [{jerseyNumber:'0'},/camiseta/],
    [{fieldPosition:'P'},/posición.*repetida/]
  ]){
    const entries=valid();Object.assign(entries[1],patch);
    assert.match(lineupTableError(entries,ids),pattern);
  }
});
test('DP and FLEX remain paired, FLEX never bats, and multiple extras may have no defensive position',()=>{
  const entries=valid();entries[0].lineupRole='DP';entries[0].fieldPosition='NA';
  assert.match(lineupTableError(entries,ids),/registrarse juntos/);
  entries.push({identificationNumber:ids[9],battingOrder:null,fieldPosition:'P',lineupRole:'FLEX',jerseyNumber:'99'});
  assert.equal(lineupTableError(entries,ids),null);
  const html=render(entries);
  assert.match(html,/FLEX · sin bateo/);assert.doesNotMatch(select(html,'Posición del FLEX'),/value="NA"/);
  assert.match(select(html,'Rol del turno 2'),/value="DP" disabled/);
  entries[9].fieldPosition='NA';
  assert.match(lineupTableError(entries,ids),/flexible.*defensa/);
  const extras=valid();
  extras.push(...[10,11].map(order=>({identificationNumber:ids[order-1],battingOrder:order,fieldPosition:'NA',lineupRole:'EH',jerseyNumber:String(order)})));
  assert.equal(lineupTableError(extras,ids),null);
});
test('all controls lock with the game and extra batting rows stop at thirteen',()=>{
  const entries=valid();
  for(let turn=10;turn<=13;turn++)entries.push({identificationNumber:ids[turn-1],battingOrder:turn,fieldPosition:'NA',lineupRole:'EH',jerseyNumber:String(turn)});
  assert.equal(lineupTableError(entries,ids),null);
  const html=render(entries,true);
  assert.equal((html.match(/<th scope="row">/g)||[]).length,13);
  assert.ok([...html.matchAll(/<(?:select|button)\b[^>]*>/g)].every(match=>match[0].includes('disabled=""')));
  const tooMany=[...entries,{...entries[0],battingOrder:14}];
  assert.match(lineupTableError(tooMany,ids),/9 a 13/);
});
