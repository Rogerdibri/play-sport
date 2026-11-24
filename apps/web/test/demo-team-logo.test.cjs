const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { calendarExampleGames } = require('@playsport/shared');
const { demoTeamIdentity } = require('../app/demo-team-logo');
const {
  InstitutionName,
  InstitutionLogoEditingContext,
  ExampleTeamName,
  ExampleTeamText,
  default: InstitutionalLogos
} = require('../app/institutional-logos');
const render = (component, props, children) => renderToStaticMarkup(React.createElement(component, props, children));

test('all sample teams get distinct, consistent original emblems without network or database writes', () => {
  const teams = [
    ...new Set(
      calendarExampleGames
        .flatMap((game) => [game.homeTeam, game.awayTeam])
        .concat(['Tigres del Valle', 'Leones del Norte', 'Halcones de Caracas', 'Bravos del Este'])
    )
  ];
  assert.equal(new Set(teams.map((team) => JSON.stringify(demoTeamIdentity(team)))).size, teams.length);
  for (const team of teams) {
    const markup = render(ExampleTeamName, {}, team);
    assert.match(markup, /<svg/);
    assert.match(markup, /data-demo-team-logo=/);
    assert.match(markup, /aria-hidden="true"/);
    assert.doesNotMatch(markup, /<img|<script|https?:|data:image/);
    assert.equal(markup, render(ExampleTeamName, {}, team));
    assert.deepEqual(demoTeamIdentity(team), demoTeamIdentity(` ${team.toUpperCase()} `));
  }
  assert.deepEqual(demoTeamIdentity('Cóndores del Ávila'), demoTeamIdentity('Condores del Avila'));
});

test('root demo branding works by identity, not for persons or tournaments, while isolated ordinary text stays plain', () => {
  assert.equal(render(InstitutionName, { id: 'team-A' }, 'Tigres del Valle'), 'Tigres del Valle');
  const markup = render(
    InstitutionalLogos,
    {},
    React.createElement(
      React.Fragment,
      {},
      React.createElement(InstitutionName, { id: 'team-A' }, 'Dirigente de Tigres del Valle'),
      React.createElement(InstitutionName, { id: 'team-B' }, 'Leones del Norte'),
      React.createElement(InstitutionName, { kind: 'tournament', id: 'cup' }, 'Copa de prueba'),
      React.createElement(InstitutionName, {}, 'Persona de prueba')
    )
  );
  assert.equal((markup.match(/data-demo-team-logo=/g) || []).length, 2);
  assert.match(markup, /data-demo-team-logo="Tigres del Valle"/);
  assert.match(markup, /data-demo-team-logo="Leones del Norte"/);
  assert.doesNotMatch(markup, /data-demo-team-logo="(?:Persona|Copa|Dirigente)/);
});

test('uploaded logo takes priority, explicit removal is respected, and unrelated same-name examples are not merged', (t) => {
  let entities = [{ kind: 'team', id: 'team-A', name: 'Tigres del Valle', hasLogo: true, revision: 3 }];
  let calls = 0;
  t.mock.method(React, 'useContext', (context) => context === InstitutionLogoEditingContext
    ? null : (++calls % 2 ? entities : true));
  const name = (props) => {
    calls = 0;
    return render(InstitutionName, props, 'Tigres del Valle');
  };
  const saved = name({ id: 'team-A', example: true });
  assert.match(saved, /<img/);
  assert.match(saved, /revision=3/);
  assert.doesNotMatch(saved, /<svg/);
  assert.match(name({ example: true }), /data-demo-team-logo=/);
  assert.doesNotMatch(name({ example: true }), /<img/);
  entities = [{ ...entities[0], hasLogo: false, revision: 4 }];
  assert.equal(name({ id: 'team-A', example: true }), 'Tigres del Valle');
  entities = [{ ...entities[0], revision: 0 }];
  assert.match(name({ id: 'team-A' }), /data-demo-team-logo=/);
});

test('text summaries preserve their original content and safely brand repeated names and punctuation', () => {
  const text = 'Ganó Club (A)+ 3–1 ante Equipo B. Club (A)+ ganó.';
  const markup = render(ExampleTeamText, { teams: ['Club (A)+', 'Equipo B', 'Club (A)+', ''] }, text);
  assert.equal((markup.match(/data-demo-team-logo=/g) || []).length, 3);
  const plain = markup.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '');
  assert.equal(plain, text);
  assert.equal(render(ExampleTeamText, { teams: [] }, 'Sin ganador confirmado.'), 'Sin ganador confirmado.');
  assert.doesNotMatch(render(ExampleTeamName, {}, '<script>'), /<script>/);
});
