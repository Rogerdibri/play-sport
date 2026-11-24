const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { organizerCapacityExamples, organizerPlanQuote, estimateTournamentCapacity } = require('@playsport/shared');
const { OrganizerPackageCatalog, OrganizerPlanEstimate } = require('../app/demo/[slug]/organizer-commercial-panel');
test('organizer packages and expansion estimates show real capacities, no invented prices or duplicate activation', () => {
  const catalog=renderToStaticMarkup(React.createElement(OrganizerPackageCatalog));
  for(const name of ['Pequeño','Mediano','Grande']) assert.match(catalog,new RegExp(name));
  for(const games of [40,150,550]) assert.match(catalog,new RegExp(`${games} partidos ordinarios`));
  assert.match(catalog,/3 desempates/); assert.match(catalog,/cerrar este torneo/);
  const document=organizerCapacityExamples[2], selection={planId:'custom',teams:8,games:48};
  const previous={authorizedGames:40};
  const quote=organizerPlanQuote(document,selection,previous);
  assert.equal(quote.amount,null); assert.equal(quote.additionalGames,8); assert.equal(quote.activationUnits,0);
  const html=renderToStaticMarkup(React.createElement(OrganizerPlanEstimate,{document,selection,previous}));
  assert.match(html,/Sin repetir la activación/); assert.match(html,/8 partidos por contratar/); assert.match(html,/no es cero ni una compra/);
});
test('visible tie-break example preserves thirteen ordinary games plus three additional classification games', () => {
  const document=organizerCapacityExamples.find(doc=>doc.id==='organizer-example-ties'), estimate=estimateTournamentCapacity(document);
  assert.equal(estimate.normalGames,13); assert.equal(estimate.tieBreakGames,3); assert.equal(estimate.games,16); assert.equal(estimate.freeEligible,true);
});
test('commercial proxy preserves scoped routes and cookies, never accepts targeting query on mutations', async t => {
  const proxy=require('../app/api/tournaments/[...path]/route'),calls=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{calls.push([url,options]);return new Response('{}',{status:200});});
  for(const route of ['plan-selection','plan-authorization','restart-game']) {
    const context={params:Promise.resolve({path:[route]})};
    const request=search=>new NextRequest(`http://localhost:3000/api/tournaments/${route}${search}`,{
      method:'POST',headers:{origin:'http://localhost:3000',cookie:'playsport-account=owner','content-type':'application/json'},body:'{}'});
    assert.equal((await proxy.POST(request('?accountId=foreign'),context)).status,404);
    assert.equal((await proxy.POST(request(''),context)).status,200);
    assert.equal(calls.at(-1)[1].headers.get('cookie'),'playsport-account=owner');
    assert.ok(calls.at(-1)[0].endsWith('/'+route));
  }
});
test('force majeure requires an account, an unfinished unprotested game and an explicit destructive confirmation', t => {
  const session=require('../app/platform-session'), Panel=require('../app/demo/[slug]/organizer-restart-game').default;
  const game={gameId:'game',tournamentId:'cup',status:'in_progress'};
  t.mock.method(session,'usePlatformSession',()=>({account:null}));
  assert.equal(renderToStaticMarkup(React.createElement(Panel,{game,onRestart:()=>{}})),'');
  t.mock.method(session,'usePlatformSession',()=>({account:{id:'owner'}}));
  for(const value of [{...game,status:'final'},{...game,protest:{status:'pending'}}])
    assert.equal(renderToStaticMarkup(React.createElement(Panel,{game:value,onRestart:()=>{}})),'');
  const html=renderToStaticMarkup(React.createElement(Panel,{game,onRestart:()=>{}}));
  assert.match(html,/Motivo de fuerza mayor/);assert.match(html,/Confirmo descartar toda la anotación/);
  assert.match(html,/<button[^>]*disabled=""/);assert.match(html,/requiere nuevas alineaciones/);
});
test('organizer capacity administration never displays authorization controls to a non-administrator', t => {
  t.mock.method(require('../app/platform-session'),'usePlatformSession',()=>({ready:true,account:{id:'owner',administrationAccess:false}}));
  const Page=require('../app/admin/organizer-capacity/page').default;
  const html=renderToStaticMarkup(React.createElement(Page));
  assert.match(html,/cuenta administradora autorizada/);assert.doesNotMatch(html,/Autorizar capacidad de prueba/);
});
