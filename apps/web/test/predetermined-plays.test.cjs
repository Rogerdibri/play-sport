const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { default: Plays, predeterminedPlayGroups } = require('../app/demo/[slug]/predetermined-plays');
const { default: DefensiveRouteFields } = require('../app/demo/[slug]/defensive-route-fields');
const { createPrivateScorecardExample } = require('../app/demo/[slug]/private-scorecard-example-data');
const { createPrivateState, applyPrivateCommand, currentBatter } = require('@playsport/shared');
const navigation = require('../app/navigation-hooks');

function nodes(element, type) {
  const found = [];
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (node.type === type) found.push(node);
    if (node.type === DefensiveRouteFields) { visit(DefensiveRouteFields(node.props)); return; }
    React.Children.forEach(node.props.children, visit);
  }
  visit(element);
  return found;
}

function setup(t, overrides = {}) {
  const states = [], refs = [], commands = [];
  let stateIndex = 0, refIndex = 0, undos = 0, screenBack;
  t.mock.method(React, 'useState', initial => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  });
  t.mock.method(React, 'useRef', initial => {
    const index = refIndex++;
    return refs[index] ?? (refs[index] = { current: initial });
  });
  t.mock.method(React, 'useEffect', () => {});
  t.mock.method(navigation, 'useScreenBack', (action, active, priority) => { screenBack = active ? { action, priority } : null; });
  const props = {
    state: createPrivateState(createPrivateScorecardExample().seed),
    disabled: false, undoDisabled: false,
    onCommand: async command => { commands.push(command); return true; },
    onUndo: () => { undos++; }, ...overrides,
  };
  const render = () => { stateIndex = 0; refIndex = 0; return Plays(props); };
  const button = label => {
    const found = nodes(render(), 'button').find(node => node.props['aria-label'] === label || React.Children.toArray(node.props.children).join('') === label);
    assert.ok(found, label);
    return found;
  };
  const click = label => { const control = button(label); assert.equal(Boolean(control.props.disabled), false, label); return control.props.onClick(); };
  const fielding = () => { click('Tipo de batazo: Rolling / rodado'); click('6 · Campocorto'); click('4 · Segunda base'); };
  const markOuts = indices => {
    const fields = nodes(render(), DefensiveRouteFields);
    const control = fields.find(node => node.props.outs > 1);
    assert.ok(control); control.props.onOutAtChange(indices);
  };
  return { props, render, button, commands, undos: () => undos, fielding,
    openSelectionWithRoute: label => { click(label); fielding(); },
    screenBack: () => { render(); assert.equal(screenBack?.priority, 2); screenBack.action(); },
    click, markOuts,
    settle: () => new Promise(resolve => setImmediate(resolve)),
  };
}

test('ordinary walks have no shortcut at any count or phase, while intentional walks remain green', t => {
  const e = setup(t), initial = e.props.state;
  for (const phase of ['pitch', 'inPlay', 'out']) {
    if (phase === 'inPlay') e.click('IN PLAY');
    if (phase === 'out') e.click('OUT');
    for (let balls = 0; balls <= 3; balls++) for (let strikes = 0; strikes <= 2; strikes++) {
      e.props.state = { ...initial, balls, strikes };
      assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Base por bolas'), false);
      assert.equal(e.button('Base intencional').props.disabled, phase !== 'inPlay');
    }
  }
});

test('infield fly is contextual, requires umpire confirmation, keeps runners safe and does not require a fictional route', async t => {
  const e = setup(t);
  assert.equal(e.button('Infield fly').props.disabled, true);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  e.click('IN PLAY'); e.click('OUT');
  assert.equal(e.button('Infield fly').props.disabled, true);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  e.click('Infield fly');
  assert.equal(nodes(e.render(), 'fieldset').filter(node => node.props['data-infield-fly']).length, 1);
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.button('Confirmar jugada').props.onClick(); await e.settle();
  assert.deepEqual(e.commands, []);
  const declaration = nodes(e.render(), 'input').find(input => input.props.type === 'checkbox');
  declaration.props.onChange({ currentTarget: { checked: true } });
  assert.equal(e.button('Confirmar jugada').props.disabled, false);
  const runnerDestinations = nodes(e.render(), 'select').filter(select => [1, 2].includes(select.props.value));
  assert.equal(runnerDestinations.length, 2);
  for (const select of runnerDestinations)
    assert.equal(React.Children.toArray(select.props.children).some(option => option.props.value === 0), false);
  const before = structuredClone(e.props.state);
  e.click('Confirmar jugada'); await e.settle();
  assert.equal(e.commands[0].infieldFly, true);
  assert.equal(e.commands[0].fieldingSequence, undefined);
  const next = applyPrivateCommand(before, e.commands[0]);
  assert.equal(next.outs, 1); assert.deepEqual(next.bases, before.bases);
});

test('Out por regla opens all causes without saving; decision, cancellation, change and bypass guards preserve the draft', async t => {
  const { batterRuleOutLabels } = require('@playsport/shared'), e = setup(t);
  const before = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  e.props.state = before; e.click('IN PLAY'); e.click('OUT'); e.click('Out por regla');
  assert.deepEqual(e.commands, []);
  assert.equal(nodes(e.render(), 'fieldset').some(node => node.props['data-batter-rule-out']), true);
  for (const label of Object.values(batterRuleOutLabels)) assert.ok(e.button(label));
  e.button('Confirmar jugada').props.onClick(); await e.settle();
  assert.deepEqual(e.commands, []);
  e.click('Interferencia del bateador');
  assert.equal(nodes(nodes(e.render(), 'fieldset').find(node => node.props['data-batter-rule-out']), 'select').length, 0);
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  const decision = () => nodes(e.render(), 'input').find(input => input.props.type === 'checkbox');
  decision().props.onChange({ currentTarget: { checked: true } });
  assert.equal(e.button('Confirmar jugada').props.disabled, false);
  e.click('Cambiar causa del out'); e.click('Bateo fuera del cajón');
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.click('Cancelar jugada'); assert.deepEqual(e.commands, []);
  e.click('Out por regla'); e.click('Interferencia del bateador');
  decision().props.onChange({ currentTarget: { checked: true } });
  e.click('Confirmar jugada'); await e.settle();
  assert.deepEqual(e.commands[0].batterRuleOut, { reason: 'batterInterference', umpireConfirmed: true });
  assert.deepEqual(applyPrivateCommand(before, e.commands[0]).bases, before.bases);
});

test('rule-out appeals and custom causes require their extra evidence and retry without duplicate writes', async t => {
  const e = setup(t); e.click('IN PLAY'); e.click('OUT'); e.click('Out por regla');
  e.click('Bateo fuera de turno (apelación)');
  const checkboxes = nodes(e.render(), 'input').filter(input => input.props.type === 'checkbox');
  checkboxes[0].props.onChange({ currentTarget: { checked: true } });
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.button('Confirmar jugada').props.onClick(); await e.settle(); assert.deepEqual(e.commands, []);
  checkboxes[1].props.onChange({ currentTarget: { checked: true } });
  assert.equal(e.button('Confirmar jugada').props.disabled, false);
  e.props.onCommand = async () => { throw new Error('Prueba: conexión interrumpida'); };
  e.click('Confirmar jugada'); await e.settle();
  assert.match(renderToStaticMarkup(e.render()), /conexión interrumpida/);
  assert.equal(e.button('Confirmar jugada').props.disabled, false);
  e.props.onCommand = async command => { e.commands.push(command); return true; };
  const confirm = e.button('Confirmar jugada');
  confirm.props.onClick(); confirm.props.onClick(); await e.settle();
  assert.equal(e.commands.length, 1); assert.equal(e.commands[0].batterRuleOut.appealConfirmed, true);
  e.click('IN PLAY'); e.click('OUT'); e.click('Out por regla'); e.click('Otro out del bateador por regla');
  nodes(e.render(), 'input').find(input => input.props.type === 'checkbox').props.onChange({ currentTarget: { checked: true } });
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  nodes(e.render(), 'textarea')[0].props.onChange({ currentTarget: { value: 'Causa arbitral de prueba' } });
  assert.equal(e.button('Confirmar jugada').props.disabled, false);
  e.props.state = { ...e.props.state, outs: 1 };
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.button('Confirmar jugada').props.onClick(); await e.settle(); assert.equal(e.commands.length, 1);
});

test('intentional-drop requires a valid base pattern and fair contact, and the rule menu reuses the existing infield-fly workflow', async t => {
  const e = setup(t); e.click('IN PLAY'); e.click('OUT'); e.click('Out por regla');
  assert.equal(e.button('Caída intencional de la pelota').props.disabled, true);
  assert.equal(e.button('Infield fly declarado por el árbitro').props.disabled, true);
  e.click('Cancelar jugada');
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  e.click('Out por regla'); e.click('Caída intencional de la pelota');
  nodes(e.render(), 'input').find(input => input.props.type === 'checkbox').props.onChange({ currentTarget: { checked: true } });
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  nodes(e.render(), 'select').find(select => React.Children.toArray(select.props.children)
    .some(option => option.props.value === 'line')).props.onChange({ currentTarget: { value: 'line' } });
  assert.equal(e.button('Confirmar jugada').props.disabled, false);
  e.click('Confirmar jugada'); await e.settle();
  assert.equal(e.commands[0].battedBallType, 'line'); assert.equal(e.commands[0].fieldingSequence, undefined);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  e.click('IN PLAY'); e.click('OUT'); e.click('Out por regla'); e.click('Infield fly declarado por el árbitro');
  assert.equal(nodes(e.render(), 'fieldset').some(node => node.props['data-infield-fly']), true);
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
});

test('infield fly cancels without recording and invalidates an open draft when the game changes', t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' }), { kind: 'play', result: 'walk' });
  e.click('IN PLAY'); e.click('OUT'); e.click('Infield fly');
  nodes(e.render(), 'input').find(input => input.props.type === 'checkbox').props.onChange({ currentTarget: { checked: true } });
  e.props.state = { ...e.props.state, outs: 2 };
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.click('Cancelar jugada'); assert.deepEqual(e.commands, []);
  assert.equal(e.button('Infield fly').props.disabled, true);
});

test('from 2-2 the fourth Bola awards the walk, undo restores the count and an intentional walk stays distinct', async t => {
  const { scorecardPracticeCommands, replayPrivate, undoPrivateCommand, privateStats } = require('@playsport/shared');
  const e = setup(t), seed = e.props.state.seed, history = scorecardPracticeCommands(seed, 'walkCount');
  e.props.state = replayPrivate(seed, history);
  const before = structuredClone(e.props.state), batter = currentBatter(before), send = e.props.onCommand;
  e.props.onCommand = async command => {
    await send(command); history.push(command); e.props.state = applyPrivateCommand(e.props.state, command); return true;
  };
  e.props.onUndo = () => {
    const previous = undoPrivateCommand(seed, history);
    history.splice(0, history.length, ...previous.commands); e.props.state = previous.state;
  };
  e.click('IN PLAY'); e.click('Bola'); await e.settle();
  assert.equal(e.props.state.balls, 3); assert.equal(e.props.state.strikes, 2);
  assert.equal(currentBatter(e.props.state), batter); assert.deepEqual(e.props.state.bases, before.bases);
  e.click('Bola'); await e.settle();
  assert.deepEqual(e.commands, [{ kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'ball' }]);
  assert.equal(e.props.state.balls, 0); assert.equal(e.props.state.strikes, 0);
  assert.equal(e.props.state.bases[0], batter); assert.notEqual(currentBatter(e.props.state), batter);
  assert.equal(e.props.state.log.at(-1).result, 'walk'); assert.equal(privateStats(e.props.state, 'away', batter).walks, 1);
  e.click('Deshacer última anotación'); await e.settle();
  assert.equal(e.props.state.balls, 3); assert.equal(e.props.state.strikes, 2); assert.deepEqual(e.props.state.bases, before.bases);
  e.click('Deshacer última anotación'); await e.settle();
  assert.deepEqual(e.props.state, before);
  e.click('IN PLAY'); e.click('Base intencional'); await e.settle();
  assert.equal(e.commands.at(-1).result, 'intentionalWalk'); assert.equal(e.props.state.log.at(-1).result, 'intentionalWalk');
});

test('two-out selection is a contextual green IN PLAY button that saves two runners out without retiring the batter', async t => {
  const { scorecardPracticeCommands, replayPrivate, fieldersChoiceTwoOutOptions } = require('@playsport/shared');
  const e = setup(t), { seed } = createPrivateScorecardExample();
  assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Jugada de selección · 2 outs'), false);
  e.props.state = replayPrivate(seed, scorecardPracticeCommands(seed, 'selectionTwoOuts'));
  const before = structuredClone(e.props.state), batter = currentBatter(before);
  assert.equal(e.button('Jugada de selección · 2 outs').props.disabled, true);
  e.click('IN PLAY'); assert.match(e.button('Jugada de selección · 2 outs').props.className, /\bprivatePlayOnBase\b/);
  e.openSelectionWithRoute('Jugada de selección · 2 outs');
  const options = fieldersChoiceTwoOutOptions(before);
  assert.deepEqual(nodes(e.render(), 'button').filter(node => ['1.ª base', '2.ª base', '3.ª base', 'Home'].includes(node.props.children))
    .map(node => node.props.children), ['2.ª base', '3.ª base', 'Home']);
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  const option = options.find(option => option.selectionOuts[0].base === 4 && option.selectionOuts[1].base === 3);
  e.click('Home'); assert.equal(e.button('Confirmar jugada').props.disabled, true); e.click('3.ª base');
  assert.deepEqual(e.commands, []); assert.deepEqual(e.props.state, before);
  e.click('Cancelar jugada'); assert.deepEqual(e.commands, []);
  e.openSelectionWithRoute('Jugada de selección · 2 outs'); e.click('Home'); e.click('3.ª base');
  e.markOuts([0, 1]);
  e.props.onCommand = async command => {
    e.commands.push(command); e.props.state = applyPrivateCommand(e.props.state, command);
    assert.doesNotThrow(() => e.render()); return true;
  };
  e.click('Confirmar jugada'); await e.settle();
  assert.equal(e.commands.length, 1); assert.deepEqual(e.commands[0].selectionOuts, option.selectionOuts);
  assert.equal(e.commands[0].destinations[batter], 1); assert.equal(e.props.state.bases[0], batter);
  assert.equal(e.props.state.outs, 2); assert.equal(e.props.state.log.at(-1).outs, 2);
  e.props.state = { ...before, outs: 2 };
  assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Jugada de selección · 2 outs'), false);
});

test('guided web outs expose every valid sequence, distinguish shared bases, and discard later choices when going back', t => {
  const { fieldersChoiceTwoOutOptions, fieldersChoiceBaseLabels } = require('@playsport/shared');
  const e = setup(t), initial = e.props.state;
  const basesShown = () => nodes(e.render(), 'button').map(node => node.props.children)
    .filter(label => Object.values(fieldersChoiceBaseLabels).includes(label));
  e.click('IN PLAY');
  for (let mask = 0; mask < 8; mask++) for (const outs of [0, 1, 2]) {
    const state = { ...initial, bases: initial.lineups.away.slice(0, 3).map((player, index) => mask & (1 << index) ? player.id : null),
      indexes: { home: 0, away: 4 }, outs };
    e.props.state = state;
    const pairs = fieldersChoiceTwoOutOptions(state);
    if (!pairs.length) {
      assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Jugada de selección · 2 outs'), false);
      continue;
    }
    for (const pair of pairs) {
      e.openSelectionWithRoute('Jugada de selección · 2 outs');
      assert.deepEqual(basesShown(), [...new Set(pairs.map(option => option.selectionOuts[0].base))].sort()
        .map(base => fieldersChoiceBaseLabels[base]));
      assert.equal(e.button('Confirmar jugada').props.disabled, true);
      for (let step = 0; step < 2; step++) {
        const out = pair.selectionOuts[step];
        const candidates = pairs.filter(option => (!step || option.selectionOuts[0].runnerId === pair.selectionOuts[0].runnerId &&
          option.selectionOuts[0].base === pair.selectionOuts[0].base) && option.selectionOuts[step].base === out.base);
        const runners = new Set(candidates.map(option => option.selectionOuts[step].runnerId));
        e.click(fieldersChoiceBaseLabels[out.base]);
        if (runners.size > 1) {
          assert.equal(e.button('Confirmar jugada').props.disabled, true);
          const origin = state.bases.indexOf(out.runnerId) + 1;
          e.click(`${out.base === origin ? 'Toque al regresar' : 'Toque al avanzar'} · corredor de ${origin}.ª`);
        }
        if (step === 0) {
          assert.deepEqual(basesShown(), [...new Set(pairs.filter(option =>
            option.selectionOuts[0].runnerId === out.runnerId && option.selectionOuts[0].base === out.base)
            .map(option => option.selectionOuts[1].base))].sort().map(base => fieldersChoiceBaseLabels[base]));
          assert.equal(e.button('Confirmar jugada').props.disabled, true);
        }
      }
      e.markOuts([0, 1]);
      assert.equal(e.button('Confirmar jugada').props.disabled, false);
      assert.equal(nodes(e.render(), 'select').length, 3 + Object.keys(pair.destinations).length - 2);
      assert.deepEqual(e.commands, []); assert.deepEqual(e.props.state, state);
      e.click('Cambiar segundo out'); assert.equal(e.button('Confirmar jugada').props.disabled, true);
      e.click('Cambiar primer out'); assert.equal(e.button('Confirmar jugada').props.disabled, true);
      assert.deepEqual(basesShown(), [...new Set(pairs.map(option => option.selectionOuts[0].base))].sort()
        .map(base => fieldersChoiceBaseLabels[base]));
      e.click('Cancelar jugada');
    }
  }
  assert.deepEqual(e.commands, []);
});

test('selection plus error waits for an occupied target, attribution and RBIs; cancel and parent rerender are safe', async t => {
  const { DefensiveErrorFields } = require('../app/demo/[slug]/defensive-error-fields');
  const { ErrorOutsField } = require('../app/demo/[slug]/run-accounting-panel');
  const { fieldersChoiceOptions } = require('@playsport/shared');
  const e = setup(t);
  assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Selección + error'), false);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'single' });
  const before = structuredClone(e.props.state), runner = before.bases[0], batter = currentBatter(before);
  e.props.onCommand = async command => {
    e.commands.push(command); e.props.state = applyPrivateCommand(e.props.state, command);
    assert.doesNotThrow(() => e.render()); return true;
  };
  e.click('IN PLAY'); e.openSelectionWithRoute('Selección + error');
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  const option = fieldersChoiceOptions(before, true)[0];
  e.click(option.label);
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  assert.deepEqual(e.commands, []); assert.deepEqual(e.props.state, before);
  e.click('Cancelar jugada'); assert.deepEqual(e.commands, []);
  e.openSelectionWithRoute('Selección + error'); e.click(option.label);
  const errors = [{ playerId: before.lineups.home[5].id, position: 'SS', type: 'throwing' },
    { playerId: before.lineups.home[3].id, position: '2B', type: 'fielding' }];
  nodes(e.render(), DefensiveErrorFields)[0].props.onChange(errors);
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  const rbi = nodes(e.render(), 'select').find(node => React.Children.toArray(node.props.children)
    .some(child => React.isValidElement(child) && child.props.children === 'Confirma las impulsadas'));
  rbi.props.onChange({ currentTarget: { value: '0' } });
  const savedSelect = nodes(e.render(), 'select').find(node => node.props.value === 2);
  assert.equal(nodes(savedSelect, 'option').some(node => node.props.value === 0), false);
  assert.equal(nodes(e.render(), ErrorOutsField)[0].props.minimum, 1);
  e.click('Confirmar jugada'); await e.settle();
  assert.equal(e.commands.length, 1);
  assert.equal(e.commands[0].errorSavedRunnerId, runner); assert.deepEqual(e.commands[0].errors, errors);
  assert.equal(e.commands[0].errorOuts, 1); assert.equal(e.commands[0].rbis, 0);
  assert.deepEqual(e.props.state.bases, [batter, runner, null]); assert.equal(e.props.state.outs, 0);
});

test('selection error uses an actual force third out, not the failed force attempt, to suppress runs', async t => {
  const { fieldersChoiceOptions, scorecardPracticeCommands, replayPrivate } = require('@playsport/shared');
  const { DefensiveErrorFields } = require('../app/demo/[slug]/defensive-error-fields');
  const e = setup(t), { seed } = createPrivateScorecardExample();
  e.props.state = replayPrivate(seed, [...scorecardPracticeCommands(seed, 'fieldersChoiceLoaded'),
    { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' }]);
  const before = e.props.state, option = fieldersChoiceOptions(before, true)[0], actualOut = before.bases[1];
  e.click('IN PLAY'); e.openSelectionWithRoute('Selección + error'); e.click(option.label);
  assert.doesNotMatch(renderToStaticMarkup(e.render()), /El tercer out fue/);
  nodes(e.render(), 'select').find(node => node.props.value === option.destinations[actualOut])
    .props.onChange({ currentTarget: { value: '0' } });
  assert.match(renderToStaticMarkup(e.render()), /El tercer out fue forzado/);
  assert.equal(nodes(e.render(), 'input').some(node => node.props.type === 'checkbox'), false);
  nodes(e.render(), DefensiveErrorFields)[0].props.onChange([{ playerId: before.lineups.home[5].id, position: 'SS', type: 'fielding' }]);
  nodes(e.render(), 'select').at(-1).props.onChange({ currentTarget: { value: '0' } });
  e.click('Confirmar jugada'); await e.settle();
  const command = e.commands[0], next = applyPrivateCommand(before, command);
  assert.equal(command.destinations[actualOut], 0); assert.ok(command.destinations[option.errorSavedRunnerId] > 0);
  assert.equal(command.validThirdOutRuns, undefined);
  assert.equal(next.log.at(-1).outs, 1); assert.equal(next.log.at(-1).runs.length, 0); assert.equal(next.side, 'home');
});

test('initial controls enable only pitches and IN PLAY; hits and outs stay disabled', t => {
  const e = setup(t);
  assert.match(e.button('IN PLAY').props.className, /\bprivateInPlayButton\b/);
  for (const label of ['Strike', 'Foul', 'Bola', 'OUT']) assert.doesNotMatch(e.button(label).props.className, /\bprivateInPlayButton\b/);
  for (const label of ['Strike', 'Foul', 'Bola', 'IN PLAY', 'Deshacer última anotación']) {
    assert.equal(Boolean(e.button(label).props.disabled), false);
  }
  for (const label of ['Sencillo', 'OUT', 'Rolling / rodado', 'Línea']) assert.equal(e.button(label).props.disabled, true);
  const html = renderToStaticMarkup(e.render());
  assert.match(html, /data-scoring-stage="pitch"/);
  assert.doesNotMatch(html, /<summary>(Más batazos y embasados|Toques|Jugadas sin batazo)/);
  assert.deepEqual(predeterminedPlayGroups[0].results.slice(0, 6), ['single', 'double', 'triple', 'homeRun', 'error', 'fieldersChoice']);
  assert.deepEqual(predeterminedPlayGroups[1].results, ['groundOut', 'lineOut', 'flyOut', 'buntOut', 'ruleOut']);
});

test('IN PLAY, OUT and back change only the interface, retaining count and runners', t => {
  const e = setup(t), before = structuredClone(e.props.state);
  e.click('IN PLAY');
  assert.equal(e.button('Sencillo').props.disabled, false);
  assert.equal(e.button('Strike').props.disabled, false);
  assert.equal(e.button('Rolling / rodado').props.disabled, true);
  e.click('OUT');
  assert.equal(e.button('Rolling / rodado').props.disabled, false);
  assert.equal(e.button('Sencillo').props.disabled, true);
  e.screenBack();
  e.click('Volver a lanzamientos');
  assert.deepEqual(e.commands, []);
  assert.deepEqual(e.props.state, before);
});

test('red controls omit the redundant forced-out shortcut in every phase and base pattern', t => {
  const e = setup(t), initial = e.props.state;
  for (let mask = 0; mask < 8; mask++) for (const outs of [0, 1, 2]) {
    e.props.state = { ...initial, bases: initial.lineups.away.slice(0, 3).map((player, index) => mask & (1 << index) ? player.id : null),
      indexes: { home: 0, away: 4 }, outs };
    for (const next of ['IN PLAY', 'OUT', 'Volver a IN PLAY', 'Volver a lanzamientos']) {
      assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Out forzado'), false);
      e.click(next);
    }
    assert.deepEqual(nodes(e.render(), 'button').filter(node => String(node.props.className).split(' ').includes('privatePlayOut'))
      .map(node => node.props.children), ['Rolling / rodado', 'Línea', 'Elevado', 'Toque', 'Out por regla', 'Infield fly']);
  }
  assert.deepEqual(e.commands, []);
});

test('pitches dispatch exactly once; successful plays return to initial controls', async t => {
  const e = setup(t);
  for (const label of ['Strike', 'Foul', 'Bola']) { e.click(label); await e.settle(); }
  assert.deepEqual(e.commands, ['strike', 'foul', 'ball'].map(value => ({ kind: 'pitch', value })));
  e.click('IN PLAY'); e.click('Sencillo'); await e.settle();
  assert.deepEqual(e.commands.at(-1), { kind: 'play', result: 'single' });
  assert.equal(e.render().props['data-scoring-stage'], 'pitch');
  e.click('IN PLAY'); e.click('OUT'); e.click('Rolling / rodado');
  e.click('6 · Campocorto'); e.click('3 · Primera base'); e.click('Confirmar out por batazo'); await e.settle();
  assert.deepEqual(e.commands.at(-1), { kind: 'play', result: 'groundOut', destinations: { [currentBatter(e.props.state)]: 0 },
    battedBallType: 'ground', fieldingSequence: [6, 3] });
});

for (const [strikeoutType, label] of [['swinging', 'Abanicando (K)'], ['looking', 'Cantado (ꓘ)']]) {
  test(`third strike waits for ${strikeoutType}, can cancel, and sends only one pitch`, async t => {
    const e = setup(t);
    e.props.state = { ...e.props.state, strikes: 2 };
    const before = structuredClone(e.props.state);
    e.click('Strike');
    assert.deepEqual(e.commands, []);
    assert.deepEqual(e.props.state, before);
    assert.equal(nodes(e.render(), 'button').filter(node => node.props.children === label).length, 1);
    assert.equal(nodes(e.render(), 'fieldset').filter(node => 'data-strikeout-choice' in node.props).length, 1);
    const pitches = nodes(e.render(), 'section').find(node => node.props['aria-label'] === 'Lanzamientos');
    const children = React.Children.toArray(pitches.props.children);
    const pitchButtons = children.findIndex(node => node.props.className?.includes('predeterminedPitchButtons'));
    assert.ok(pitchButtons >= 0);
    assert.ok('data-strikeout-choice' in children[pitchButtons + 1].props);
    assert.equal(nodes(pitches, 'button').filter(node => node.props.children === label).length, 1);
    for (const control of ['Strike', 'Bola', 'Foul', 'IN PLAY', 'Deshacer última anotación'])
      assert.equal(e.button(control).props.disabled, true);
    e.click('Cancelar ponche');
    assert.equal(e.button('Strike').props.disabled, false);
    e.click('Strike'); e.screenBack();
    assert.deepEqual(e.commands, []);
    e.click('Strike');
    const selected = e.button(label);
    selected.props.onClick(); selected.props.onClick();
    await e.settle();
    assert.deepEqual(e.commands, [{ kind: 'pitch', value: 'strike', strikeoutType }]);
    assert.equal(applyPrivateCommand(before, e.commands[0]).outs, 1);
  });
}

test('outs omit the manual strikeout while the third Strike preserves failure detail and retries safely', async t => {
  const e = setup(t);
  e.props.state = { ...e.props.state, strikes: 2 };
  e.click('IN PLAY'); e.click('OUT');
  assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Ponche'), false);
  assert.deepEqual(predeterminedPlayGroups.find(group => group.tone === 'out').results,
    ['groundOut', 'lineOut', 'flyOut', 'buntOut', 'ruleOut']);
  e.click('Strike');
  assert.deepEqual(e.commands, []);
  e.props.onCommand = async () => { throw new Error('No se pudo guardar'); };
  e.click('Cantado (ꓘ)'); await e.settle();
  assert.match(renderToStaticMarkup(e.render()), /No se pudo guardar/);
  e.props.onCommand = async command => { e.commands.push(command); return true; };
  e.click('Cantado (ꓘ)'); await e.settle();
  assert.deepEqual(e.commands, [{ kind: 'pitch', value: 'strike', strikeoutType: 'looking' }]);
});

test('third strike can open the uncaught form without recording an out', async t => {
  const e = setup(t);
  e.props.state = { ...e.props.state, strikes: 2 };
  e.click('Strike'); e.click('El receptor no lo retuvo');
  assert.deepEqual(e.commands, []);
  const select = placeholder => nodes(e.render(), 'select').find(node => React.Children.toArray(node.props.children)
    .some(child => React.isValidElement(child) && child.props.children === placeholder));
  select('Selecciona la causa').props.onChange({ currentTarget: { value: 'passed' } });
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  select('Selecciona el tipo').props.onChange({ currentTarget: { value: 'looking' } });
  e.click('Confirmar jugada'); await e.settle();
  const next = applyPrivateCommand(e.props.state, e.commands[0]);
  assert.equal(next.outs, 0);
  assert.equal(next.log.at(-1).strikeoutType, 'looking');
  assert.equal(next.bases[0], currentBatter(e.props.state));
});

test('an uncaught third strike with the batter out requires only a defensive route, never a batted-ball type', async t => {
  const e = setup(t);
  e.props.state = { ...e.props.state, strikes: 2 };
  e.click('IN PLAY'); e.click('Tercer strike caído');
  const select = placeholder => nodes(e.render(), 'select').find(node => React.Children.toArray(node.props.children)
    .some(child => React.isValidElement(child) && child.props.children === placeholder));
  select('Selecciona la causa').props.onChange({ currentTarget: { value: 'passed' } });
  select('Selecciona el tipo').props.onChange({ currentTarget: { value: 'swinging' } });
  const destination = nodes(e.render(), 'select').find(node => node.props.value === 1);
  destination.props.onChange({ currentTarget: { value: '0' } });
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  assert.equal(nodes(e.render(), DefensiveRouteFields)[0].props.onBallTypeChange, undefined);
  e.click('2 · Receptor'); e.click('3 · Primera base');
  e.click('Confirmar jugada'); await e.settle();
  assert.deepEqual(e.commands[0].fieldingSequence, [2, 3]);
  assert.equal(e.commands[0].battedBallType, undefined);
  const next = applyPrivateCommand(e.props.state, e.commands[0]);
  assert.equal(next.outs, 1);
  assert.equal(next.log.at(-1).result, 'droppedThirdStrike');
  assert.deepEqual(next.log.at(-1).fieldingSequence, [2, 3]);
});

for (const entry of ['strikeout', 'inPlay']) {
  test(`uncaught third strike from ${entry} stays directly below pitch buttons and cancels without writing`, t => {
    const e = setup(t);
    e.props.state = { ...e.props.state, strikes: 2 };
    const before = structuredClone(e.props.state);
    if (entry === 'strikeout') { e.click('Strike'); e.click('El receptor no lo retuvo'); }
    else { e.click('IN PLAY'); e.click('Tercer strike caído'); }
    const tree = e.render();
    assert.equal(nodes(tree, 'fieldset').filter(node => node.props['data-dropped-third-strike']).length, 1);
    assert.equal(nodes(tree, 'fieldset').filter(node => 'data-strikeout-choice' in node.props).length, 0);
    const pitches = nodes(tree, 'section').find(node => node.props['aria-label'] === 'Lanzamientos');
    const children = React.Children.toArray(pitches.props.children);
    const buttons = children.findIndex(node => node.props.className?.includes('predeterminedPitchButtons'));
    assert.equal(nodes(children[buttons + 1], 'fieldset')[0].props['data-dropped-third-strike'], true);
    for (const label of ['Strike', 'Foul', 'Bola', 'IN PLAY'])
      assert.equal(e.button(label).props.disabled, true);
    assert.equal(e.button('Confirmar jugada').props.disabled, true);
    e.click('Cancelar jugada');
    assert.equal(nodes(e.render(), 'fieldset').filter(node => node.props['data-dropped-third-strike']).length, 0);
    assert.deepEqual(e.commands, []);
    assert.deepEqual(e.props.state, before);
    assert.equal(e.button('Strike').props.disabled, false);
  });
}

test('other play details remain outside the pitch column', t => {
  const { playLabels } = require('@playsport/shared');
  const e = setup(t);
  e.click('IN PLAY'); e.click(playLabels.error);
  const pitches = nodes(e.render(), 'section').find(node => node.props['aria-label'] === 'Lanzamientos');
  assert.equal(nodes(pitches, 'fieldset').length, 0);
  assert.equal(nodes(e.render(), 'fieldset').filter(node => node.props.className === 'privateMultipleOut').length, 1);
});

test('Toque de bola is one direct green button that places the batter at first without a destination dialog', async t => {
  const { minimumDestinations } = require('@playsport/shared');
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'triple' });
  const before = e.props.state, batter = currentBatter(before);
  e.click('IN PLAY');
  assert.equal(nodes(e.render(), 'button').filter(node => node.props.children === 'Toque de bola').length, 1);
  assert.match(e.button('Toque de bola').props.className, /\bprivatePlayOnBase\b/);
  e.click('Toque de bola'); await e.settle();
  assert.deepEqual(e.commands, [{ kind: 'play', result: 'buntHit' }]);
  assert.equal(nodes(e.render(), 'fieldset').some(node => node.props.className === 'privateMultipleOut'), false);
  const state = applyPrivateCommand(before, { ...e.commands[0], destinations: minimumDestinations(before, 'buntHit') });
  assert.equal(state.bases[0], batter);
  assert.equal(state.bases[2], before.bases[2]);
  assert.deepEqual(state.scores, before.scores);
  assert.equal(state.outs, before.outs);
});

test('all pitches remain visible and update the count from pitch, IN PLAY and OUT', async t => {
  for (const phase of ['pitch', 'inPlay', 'out']) for (const [label, value] of [['Strike', 'strike'], ['Bola', 'ball'], ['Foul', 'foul']]) {
    await t.test(`${phase}/${value}`, async child => {
      const e = setup(child);
      e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'single' });
      const before = structuredClone(e.props.state), dispatch = e.props.onCommand;
      e.props.onCommand = async command => {
        await dispatch(command);
        e.props.state = applyPrivateCommand(e.props.state, command);
        return true;
      };
      if (phase !== 'pitch') e.click('IN PLAY');
      if (phase === 'out') e.click('OUT');
      const group = nodes(e.render(), 'section').find(node => node.props['aria-label'] === 'Lanzamientos');
      assert.equal(group.props['data-active'], true);
      e.click(label); await e.settle();
      assert.deepEqual(e.commands, [{ kind: 'pitch', value }]);
      assert.equal(e.props.state.balls, value === 'ball' ? 1 : 0);
      assert.equal(e.props.state.strikes, value === 'ball' ? 0 : 1);
      assert.deepEqual(e.props.state.bases, before.bases);
      assert.equal(e.props.state.outs, before.outs);
      assert.equal(e.render().props['data-scoring-stage'], 'pitch');
    });
  }
});

test('pending out confirmations and in-flight writes still block pitches', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'single' });
  e.click('IN PLAY'); e.click('OUT'); e.click('Rolling / rodado'); e.click('Doble jugada');
  for (const label of ['Strike', 'Bola', 'Foul']) assert.equal(e.button(label).props.disabled, true);
  e.click('Cancelar out por batazo');
  let release;
  e.props.onCommand = () => new Promise(resolve => { release = resolve; });
  e.click('Bola');
  for (const label of ['Strike', 'Bola', 'Foul']) assert.equal(e.button(label).props.disabled, true);
  release(false); await e.settle();
  for (const label of ['Strike', 'Bola', 'Foul']) assert.equal(e.button(label).props.disabled, false);
  e.props.disabled = true;
  for (const label of ['Strike', 'Bola', 'Foul']) assert.equal(e.button(label).props.disabled, true);
});

test('failed and rejected writes retain the selected stage and undo remains independent', async t => {
  const e = setup(t, { onCommand: async () => false });
  e.click('IN PLAY'); e.click('Sencillo'); await e.settle();
  assert.equal(e.render().props['data-scoring-stage'], 'inPlay');
  e.props.onCommand = async () => { throw new Error('Sin conexión.'); };
  e.click('Sencillo'); await e.settle();
  assert.match(renderToStaticMarkup(e.render()), /Sin conexión/);
  e.click('Deshacer última anotación');
  assert.equal(e.undos(), 1);
  e.props.disabled = true;
  assert.equal(e.render().props.disabled, undefined);
  assert.equal(e.button('Sencillo').props.disabled, true);
  assert.equal(e.button('Deshacer última anotación').props.disabled, false);
});

test('rapid repeated taps do not duplicate an in-flight scoring command', async t => {
  let release, calls = 0;
  const e = setup(t, { onCommand: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  e.click('IN PLAY');
  const action = e.button('Sencillo').props.onClick;
  action(); action();
  assert.equal(calls, 1);
  assert.equal(e.button('Deshacer última anotación').props.disabled, true);
  release(true); await e.settle();
  assert.equal(e.render().props['data-scoring-stage'], 'pitch');
});

test('double plays require explicit runner selection and preserve the other runner', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(applyPrivateCommand(e.props.state, { kind: 'play', result: 'single' }), { kind: 'play', result: 'single' });
  const before = e.props.state;
  e.click('IN PLAY'); e.click('OUT'); e.click('Rolling / rodado'); e.click('Doble jugada');
  assert.equal(e.commands.length, 0);
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  e.click('4 · Segunda base'); e.click('6 · Campocorto'); e.click('3 · Primera base');
  const inputs = nodes(e.render(), 'input');
  inputs[0].props.onChange({ currentTarget: { checked: true } });
  e.markOuts([1, 2]);
  e.click('Confirmar out por batazo'); await e.settle();
  const command = e.commands[0];
  assert.equal(command.destinations[currentBatter(before)], 0);
  assert.equal(command.destinations[before.bases[0]], 0);
  assert.equal(command.destinations[before.bases[1]], 2);
  assert.equal(applyPrivateCommand(before, command).outs, 2);
});

test('a double play with one runner identifies both outs without asking who, but still requires type and sequence', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  const before = e.props.state;
  e.click('IN PLAY'); e.click('OUT');
  assert.equal(nodes(e.render(), 'button').some(button => button.props.children === 'Doble jugada'), false);
  e.click('Rolling / rodado'); e.click('Doble jugada');
  assert.equal(e.commands.length, 0);
  assert.equal(nodes(e.render(), 'input').length, 0);
  assert.match(renderToStaticMarkup(e.render()), /El único corredor en base también queda eliminado/);
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  e.click('6 · Campocorto'); e.click('4 · Segunda base'); e.click('3 · Primera base');
  e.markOuts([1, 2]);
  e.click('Confirmar out por batazo'); await e.settle();
  assert.deepEqual(e.commands[0], { kind: 'play', result: 'doublePlay', battedBallType: 'ground',
    fieldingSequence: [6, 4, 3], outAt: [1, 2], destinations: { [currentBatter(before)]: 0, [before.bases[0]]: 0 } });
  assert.equal(applyPrivateCommand(before, e.commands[0]).outs, 2);
});

test('changing an automatic double play back to a single out does not eliminate the sole runner', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'double' });
  const before = e.props.state;
  e.click('IN PLAY'); e.click('OUT'); e.click('Línea'); e.click('Doble jugada');
  e.click('Out sencillo'); e.click('6 · Campocorto');
  e.click('Confirmar out por batazo'); await e.settle();
  assert.equal(e.commands[0].result, 'lineOut');
  assert.equal(e.commands[0].destinations[before.bases[1]], 2);
  assert.equal(applyPrivateCommand(before, e.commands[0]).outs, 1);
});

test('triple plays identify both runners automatically when no alternative exists and change innings only on confirmation', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(applyPrivateCommand(e.props.state, { kind: 'play', result: 'single' }), { kind: 'play', result: 'single' });
  const before = e.props.state;
  e.click('IN PLAY'); e.click('OUT'); e.click('Línea'); e.click('Triple jugada');
  assert.equal(nodes(e.render(), 'input').length, 0);
  assert.equal(e.commands.length, 0);
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  e.click('5 · Tercera base'); e.click('4 · Segunda base'); e.click('3 · Primera base');
  e.markOuts([0, 1, 2]);
  e.click('Confirmar out por batazo'); await e.settle();
  assert.equal(e.commands.length, 1);
  const next = applyPrivateCommand(before, e.commands[0]);
  assert.notEqual(next.side, before.side);
  assert.equal(next.outs, 0);
});

test('a triple play with loaded bases still requires choosing exactly two runners', async t => {
  const e = setup(t);
  for (let i = 0; i < 3; i++) e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  const before = e.props.state;
  e.click('IN PLAY'); e.click('OUT'); e.click('Rolling / rodado'); e.click('Triple jugada');
  e.click('5 · Tercera base'); e.click('4 · Segunda base'); e.click('3 · Primera base');
  const inputs = nodes(e.render(), 'input');
  assert.equal(inputs.length, 3);
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  inputs[0].props.onChange({ currentTarget: { checked: true } });
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  inputs[1].props.onChange({ currentTarget: { checked: true } });
  e.markOuts([0, 1, 2]);
  e.click('Confirmar out por batazo'); await e.settle();
  assert.equal(e.commands[0].destinations[before.bases[2]], 3);
  assert.equal(Object.values(e.commands[0].destinations).filter(destination => destination === 0).length, 3);
});

test('batted-out drafts require a sequence, support corrections and cancel without writing', t => {
  const e = setup(t), before = structuredClone(e.props.state);
  e.click('IN PLAY'); e.click('OUT'); e.click('Rolling / rodado');
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  e.click('3 · Primera base'); e.click('6 · Campocorto'); e.click('3 · Primera base');
  assert.equal(nodes(e.render(), 'output')[0].props.children, '3-6-3');
  e.click('Quitar último defensor');
  assert.equal(nodes(e.render(), 'output')[0].props.children, '3-6');
  e.click('Limpiar vía');
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  e.click('Cancelar out por batazo');
  assert.deepEqual(e.commands, []);
  assert.deepEqual(e.props.state, before);
  assert.equal(e.button('Rolling / rodado').props.disabled, false);
});

test('multiple-out choices distinguish each starting base even when two runners share the same name', t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' }), { kind: 'play', result: 'walk' });
  for (const players of [e.props.state.lineups.away, e.props.state.seed.rosters.away]) {
    players[0].name = 'Alex'; players[1].name = 'Alex';
  }
  e.click('IN PLAY'); e.click('OUT'); e.click('Rolling / rodado'); e.click('Doble jugada');
  const markup = renderToStaticMarkup(e.render());
  assert.match(markup, /Corredor en 1\.ª · Alex · eliminado/);
  assert.match(markup, /Corredor en 2\.ª · Alex · eliminado/);
});

test('sequence length never selects double play and a single caught line requires just one fielder', async t => {
  const e = setup(t);
  for (const [type, positions, result] of [
    ['Rolling / rodado', ['4 · Segunda base', '6 · Campocorto', '3 · Primera base'], 'groundOut'],
    ['Línea', ['6 · Campocorto'], 'lineOut'], ['Elevado', ['8 · Jardinero central'], 'flyOut']
  ]) {
    e.click('IN PLAY'); e.click('OUT'); e.click(type);
    for (const position of positions) e.click(position);
    assert.equal(e.button('Out sencillo').props['aria-pressed'], true);
    e.click('Confirmar out por batazo'); await e.settle();
    assert.equal(e.commands.at(-1).result, result);
    assert.equal(applyPrivateCommand(e.props.state, e.commands.at(-1)).outs, 1);
  }
});

test('simple caught balls replace the catching fielder and offer no route or prior-assist control', async t => {
  const { defensivePlayerAt } = require('@playsport/shared'), e = setup(t);
  e.click('IN PLAY'); e.click('OUT'); e.click('Línea');
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  e.button('Confirmar out por batazo').props.onClick(); await e.settle();
  assert.deepEqual(e.commands, []);
  const catcherPanel = () => nodes(e.render(), 'div').find(node => node.props['data-caught-ball']);
  assert.equal(nodes(catcherPanel(), 'output').length, 0);
  assert.equal(nodes(catcherPanel(), 'details').length, 0);
  assert.doesNotMatch(renderToStaticMarkup(catcherPanel()), /asistencia|Participación previa/);
  e.click('6 · Campocorto'); e.click('3 · Primera base');
  assert.equal(e.button('6 · Campocorto').props['aria-pressed'], false);
  assert.equal(e.button('3 · Primera base').props['aria-pressed'], true);
  e.click('Confirmar out por batazo'); await e.settle();
  assert.deepEqual(e.commands[0].fieldingSequence, [3]);
  assert.deepEqual(e.commands[0].caughtBy, { playerId: defensivePlayerAt(e.props.state, 3).id, position: 3 });
});

test('changing caught-ball modes discards the catcher instead of reusing it as a double-play route; changed defense blocks saving', async t => {
  const e = setup(t); e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  e.click('IN PLAY'); e.click('OUT'); e.click('Línea'); e.click('6 · Campocorto');
  e.click('Doble jugada');
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  e.click('6 · Campocorto'); e.click('3 · Primera base'); e.click('Out sencillo');
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  e.click('6 · Campocorto');
  e.props.state = { ...e.props.state, lineups: { ...e.props.state.lineups,
    home: e.props.state.lineups.home.filter(player => player.position !== 'SS') } };
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  e.button('Confirmar out por batazo').props.onClick(); await e.settle();
  assert.deepEqual(e.commands, []);
  e.click('Cancelar out por batazo');
});

test('a name-only friendly lineup asks for defensive positions instead of inventing a catching fielder', t => {
  const e = setup(t);
  e.props.state = { ...e.props.state, lineups: { ...e.props.state.lineups,
    home: e.props.state.lineups.home.map(player => ({ ...player, position: 'NA' })) } };
  e.click('IN PLAY'); e.click('OUT'); e.click('Línea');
  assert.equal(e.button('6 · Campocorto').props.disabled, true);
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  assert.match(renderToStaticMarkup(e.render()), /Asigna las posiciones en la alineación defensiva/);
  assert.deepEqual(e.commands, []);
});

test('a clock tick preserves the out draft but another scoring event invalidates it and still permits cancellation', t => {
  const e = setup(t);
  e.click('IN PLAY'); e.click('OUT'); e.click('Línea'); e.click('6 · Campocorto');
  e.props.state = { ...e.props.state, clock: { ...e.props.state.clock, elapsedSeconds: 100 } };
  assert.equal(e.button('Confirmar out por batazo').props.disabled, false);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'pitch', value: 'ball' });
  assert.equal(e.button('Confirmar out por batazo').props.disabled, true);
  assert.match(renderToStaticMarkup(e.render()), /El partido cambió/);
  e.click('Cancelar out por batazo');
  assert.deepEqual(e.commands, []);
});

test('failed out submissions retain type and sequence for retry while repeated confirmation cannot duplicate a write', async t => {
  const e = setup(t);
  let release, fail = true;
  e.props.onCommand = async command => {
    e.commands.push(command);
    if (fail) throw new Error('No se pudo guardar');
    return new Promise(resolve => { release = resolve; });
  };
  e.click('IN PLAY'); e.click('OUT'); e.click('Rolling / rodado');
  e.click('6 · Campocorto'); e.click('3 · Primera base');
  e.click('Confirmar out por batazo'); await e.settle();
  assert.match(renderToStaticMarkup(e.render()), /No se pudo guardar/);
  assert.equal(nodes(e.render(), 'output')[0].props.children, '6-3');
  fail = false;
  const confirm = e.button('Confirmar out por batazo');
  confirm.props.onClick(); confirm.props.onClick();
  assert.equal(e.commands.length, 2);
  assert.deepEqual(e.commands[0], e.commands[1]);
  release(true); await e.settle();
  assert.equal(e.render().props['data-scoring-stage'], 'pitch');
});

test('sacrifices remain available inside their batted-out type with explicit real advances', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'triple' });
  e.click('IN PLAY'); e.click('OUT'); e.click('Elevado'); e.click('8 · Jardinero central');
  assert.equal(nodes(e.render(), 'input').find(input => input.props.type === 'checkbox').props.disabled, true);
  nodes(e.render(), 'select').find(select => select.props.value === 3).props.onChange({ currentTarget: { value: '4' } });
  const sacrifice = nodes(e.render(), 'input').find(input => input.props.type === 'checkbox');
  assert.equal(sacrifice.props.disabled, false);
  sacrifice.props.onChange({ currentTarget: { checked: true } });
  e.click('Confirmar out por batazo'); await e.settle();
  assert.equal(e.commands[0].result, 'sacrificeFly');
  assert.equal(applyPrivateCommand(e.props.state, e.commands[0]).scores.away, 1);
});

test('a shortstop fly with a first-to-second advance cannot be marked as a sacrifice, even through the change handler', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  const runner = e.props.state.bases[0];
  e.click('IN PLAY'); e.click('OUT'); e.click('Elevado'); e.click('6 · Campocorto');
  const checkbox = () => nodes(e.render(), 'input').find(input => input.props.type === 'checkbox');
  assert.equal(checkbox().props.disabled, true);
  nodes(e.render(), 'select').find(select => select.props.value === 1).props.onChange({ currentTarget: { value: '2' } });
  assert.equal(checkbox().props.disabled, true);
  checkbox().props.onChange({ currentTarget: { checked: true } });
  assert.equal(checkbox().props.checked, false);
  assert.match(renderToStaticMarkup(e.render()), /Avanzar de base no basta/);
  e.click('Confirmar out por batazo'); await e.settle();
  assert.equal(e.commands[0].result, 'flyOut');
  assert.equal(e.commands[0].destinations[runner], 2);
  const next = applyPrivateCommand(e.props.state, e.commands[0]);
  assert.equal(next.outs, 1); assert.equal(next.bases[1], runner);
  assert.equal(next.scores.away, 0);
});

test('changing or removing a scoring destination clears sacrifice explicitly, while toggling never changes destinations', t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'triple' });
  e.click('IN PLAY'); e.click('OUT'); e.click('Elevado'); e.click('8 · Jardinero central');
  const destination = () => nodes(e.render(), 'select').find(select => typeof select.props.value === 'number');
  const checkbox = () => nodes(e.render(), 'input').find(input => input.props.type === 'checkbox');
  destination().props.onChange({ currentTarget: { value: '4' } });
  checkbox().props.onChange({ currentTarget: { checked: true } });
  checkbox().props.onChange({ currentTarget: { checked: false } });
  assert.equal(destination().props.value, 4);
  checkbox().props.onChange({ currentTarget: { checked: true } });
  destination().props.onChange({ currentTarget: { value: '3' } });
  assert.equal(checkbox().props.checked, false); assert.equal(checkbox().props.disabled, true);
  assert.match(renderToStaticMarkup(e.render()), /Se quitó la marca de sacrificio/);
  assert.deepEqual(e.commands, []);
});

test('an incoming game change also clears an incompatible sacrifice without altering the draft destinations', t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'triple' });
  e.click('IN PLAY'); e.click('OUT'); e.click('Elevado');
  nodes(e.render(), 'select').find(select => select.props.value === 3).props.onChange({ currentTarget: { value: '4' } });
  nodes(e.render(), 'input').find(input => input.props.type === 'checkbox').props.onChange({ currentTarget: { checked: true } });
  e.props.state = { ...e.props.state, outs: 2 };
  const effects = [];
  t.mock.method(React, 'useEffect', effect => effects.push(effect));
  e.render(); effects.forEach(effect => effect());
  assert.equal(nodes(e.render(), 'input').find(input => input.props.type === 'checkbox').props.checked, false);
  assert.equal(nodes(e.render(), 'select').find(select => typeof select.props.value === 'number').props.value, 4);
  assert.match(renderToStaticMarkup(e.render()), /Se quitó la marca de sacrificio/);
  assert.deepEqual(e.commands, []);
});

test('a sacrifice bunt needs an explicit advance, not an automatic destination change', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  e.click('IN PLAY'); e.click('OUT'); e.click('Toque'); e.click('1 · Pitcher'); e.click('3 · Primera base');
  const checkbox = () => nodes(e.render(), 'input').find(input => input.props.type === 'checkbox');
  assert.equal(checkbox().props.disabled, true);
  nodes(e.render(), 'select').find(select => select.props.value === 1).props.onChange({ currentTarget: { value: '2' } });
  assert.equal(checkbox().props.disabled, false);
  checkbox().props.onChange({ currentTarget: { checked: true } });
  checkbox().props.onChange({ currentTarget: { checked: false } });
  assert.equal(nodes(e.render(), 'select').find(select => typeof select.props.value === 'number').props.value, 2);
  checkbox().props.onChange({ currentTarget: { checked: true } });
  e.click('Confirmar out por batazo'); await e.settle();
  assert.equal(e.commands[0].result, 'sacrificeBunt');
  assert.equal(applyPrivateCommand(e.props.state, e.commands[0]).outs, 1);
});

for (const label of ['Elevado', 'Toque']) {
  test(`${label} cannot be marked as sacrifice with two outs, even after specifying home`, t => {
    const e = setup(t);
    e.props.state = { ...applyPrivateCommand(e.props.state, { kind: 'play', result: 'triple' }), outs: 2 };
    e.click('IN PLAY'); e.click('OUT'); e.click(label);
    nodes(e.render(), 'select').find(select => select.props.value === 3).props.onChange({ currentTarget: { value: '4' } });
    const checkbox = nodes(e.render(), 'input').find(input => input.props.type === 'checkbox');
    assert.equal(checkbox.props.disabled, true);
    checkbox.props.onChange({ currentTarget: { checked: true } });
    assert.equal(nodes(e.render(), 'input').find(input => input.props.type === 'checkbox').props.checked, false);
    assert.match(renderToStaticMarkup(e.render()), /menos de dos outs/);
  });
}

test('a sacrifice fly with error still cannot be confirmed without a scoring destination', t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  e.click('IN PLAY'); e.click('Elevado de sacrificio con error');
  const checkbox = nodes(e.render(), 'input').find(input => input.props.type === 'checkbox');
  assert.equal(checkbox.props.disabled, true);
  checkbox.props.onChange({ currentTarget: { checked: true } });
  assert.equal(nodes(e.render(), 'input').find(input => input.props.type === 'checkbox').props.checked, false);
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  assert.match(renderToStaticMarkup(e.render()), /Avanzar de base no basta/);
  assert.deepEqual(e.commands, []);
});

test('selection cannot be confirmed without both ball type and defensive route, and cancelling records nothing', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  e.click('IN PLAY'); e.click('Jugada de selección');
  e.click('Out forzado en segunda · corredor de primera');
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.click('6 · Campocorto'); e.click('4 · Segunda base');
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.click('Tipo de batazo: Rolling / rodado');
  assert.equal(e.button('Confirmar jugada').props.disabled, false);
  e.click('Limpiar vía');
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.click('Cancelar jugada');
  assert.deepEqual(e.commands, []);
  e.openSelectionWithRoute('Jugada de selección');
  e.click('Out forzado en segunda · corredor de primera');
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'pitch', value: 'ball' });
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.click('Cancelar jugada');
  assert.deepEqual(e.commands, []);
});

test('a forced runner out through fielders choice does not eliminate the batter or assume extra runner advances', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(applyPrivateCommand(e.props.state, { kind: 'play', result: 'single' }), { kind: 'play', result: 'single' });
  const before = e.props.state;
  e.click('IN PLAY'); e.openSelectionWithRoute('Jugada de selección');
  assert.equal(e.commands.length, 0);
  e.click('Out forzado en segunda · corredor de primera');
  e.click('Confirmar jugada'); await e.settle();
  const next = applyPrivateCommand(before, e.commands[0]);
  assert.equal(next.outs, 1);
  assert.equal(next.bases[0], currentBatter(before));
  assert.equal(next.bases[1], before.bases[1]);
  assert.equal(next.bases.includes(before.bases[0]), false);
  assert.equal(next.log.at(-1).result, 'fieldersChoice');
});

test('fielders choice waits for a contextual option, cancels cleanly and records the runner out once', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'single' });
  const before = structuredClone(e.props.state), batter = currentBatter(before), runner = before.bases[0];
  e.props.onCommand = async command => {
    e.commands.push(command);
    e.props.state = applyPrivateCommand(e.props.state, command);
    assert.doesNotThrow(() => e.render());
    return true;
  };
  e.click('IN PLAY'); e.openSelectionWithRoute('Jugada de selección');
  assert.deepEqual(e.commands, []);
  assert.deepEqual(e.props.state, before);
  assert.equal(nodes(e.render(), 'select').length, 1);
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  e.click('Cancelar jugada');
  assert.deepEqual(e.commands, []);
  e.openSelectionWithRoute('Jugada de selección');
  const label = 'Out forzado en segunda · corredor de primera';
  e.click(label);
  assert.deepEqual(e.commands, []);
  const confirm = e.button('Confirmar jugada');
  assert.equal(confirm.props.disabled, false);
  confirm.props.onClick(); confirm.props.onClick(); await e.settle();
  assert.deepEqual(e.commands, [{ kind: 'play', result: 'fieldersChoice', destinations: { [runner]: 0, [batter]: 1 }, note: label,
    battedBallType: 'ground', fieldingSequence: [6, 4] }]);
  const next = applyPrivateCommand(before, e.commands[0]);
  assert.deepEqual(next.bases, [batter, null, null]); assert.equal(next.outs, 1);
  assert.equal(next.log.at(-1).outs, 1); assert.equal(next.log.at(-1).result, 'fieldersChoice');
});

test('fielders choice preserves explicit safe destinations if no runner was retired', async t => {
  const e = setup(t);
  e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'single' });
  const before = structuredClone(e.props.state);
  e.click('IN PLAY'); e.openSelectionWithRoute('Jugada de selección');
  e.click('Intento de out a otro corredor: todos quietos');
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  nodes(e.render(), 'input')[0].props.onChange({ currentTarget: { checked: true } });
  e.click('Confirmar jugada'); await e.settle();
  const next = applyPrivateCommand(before, e.commands[0]);
  assert.equal(next.outs, 0); assert.deepEqual(next.bases, [currentBatter(before), before.bases[0], null]);
});

test('fielders choice displays exactly the contextual options for every base pattern', async t => {
  const { fieldersChoiceOptions } = require('@playsport/shared');
  for (let mask = 0; mask < 8; mask++) await t.test(`bases ${mask}`, async child => {
    const e = setup(child), ids = e.props.state.seed.lineups.away.slice(0, 3).map(player => player.id);
    e.props.state = { ...e.props.state, indexes: { home: 0, away: 4 },
      bases: ids.map((id, index) => mask & (1 << index) ? id : null) };
    e.click('IN PLAY');
    if (!mask) {
      assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Jugada de selección'), false);
      return;
    }
    const expected = fieldersChoiceOptions(e.props.state);
    e.openSelectionWithRoute('Jugada de selección');
    const actual = nodes(e.render(), 'button').filter(node => node.props['aria-pressed'] !== undefined && !node.props['aria-label']?.startsWith('Tipo de batazo:'));
    assert.deepEqual(actual.map(node => node.props.children), expected.map(option => option.label));
    assert.deepEqual(e.commands, []);
    e.click(expected[0].label);
    e.click('Confirmar jugada'); await e.settle();
    assert.deepEqual(e.commands[0].destinations, expected[0].destinations);
    assert.equal(applyPrivateCommand(e.props.state, e.commands[0]).outs, 1);
  });
});

test('selection allows a preceding run before a tag third out but never before a force third out', async t => {
  const { replayPrivate, scorecardPracticeCommands } = require('@playsport/shared');
  for (const forced of [false, true]) await t.test(forced ? 'force' : 'tag', async child => {
    const e = setup(child), seed = e.props.state.seed;
    e.props.state = replayPrivate(seed, [...scorecardPracticeCommands(seed, forced ? 'fieldersChoiceLoaded' : 'fieldersChoiceSecondThird'),
      { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' }]);
    e.click('IN PLAY'); e.openSelectionWithRoute('Jugada de selección');
    e.click(forced ? 'Out forzado en home · corredor de tercera' : 'Out por toque en tercera · corredor de segunda');
    const selects = nodes(e.render(), 'select').filter(node => typeof node.props.value === 'number');
    if (forced) {
      assert.equal(selects.some(node => nodes(node, 'option').some(option => option.props.value === 4)), false);
    } else {
      selects.find(node => node.props.value === 3).props.onChange({ currentTarget: { value: '4' } });
      nodes(e.render(), 'input')[0].props.onChange({ currentTarget: { checked: true } });
    }
    e.click('Confirmar jugada'); await e.settle();
    assert.equal(e.commands[0].validThirdOutRuns, forced ? undefined : true);
    const next = applyPrivateCommand(e.props.state, e.commands[0]);
    assert.equal(next.side, 'home');
    assert.equal(next.scores.away, forced ? 0 : 1);
  });
});

test('forced outs through fielders choice retain unforced runners and record no invented runs in every eligible base pattern', async t => {
  const cases = [
    [[true, false, false], 0, ['batter', null, null]],
    [[true, true, false], 0, ['batter', 1, null]],
    [[true, true, false], 1, ['batter', 0, null]],
    [[true, false, true], 0, ['batter', null, 2]],
    [[true, true, true], 0, ['batter', 1, 2]],
    [[true, true, true], 1, ['batter', 0, 2]],
    [[true, true, true], 2, ['batter', 0, 1]],
  ];
  for (const [occupied, forced, expected] of cases) await t.test(`${occupied.join(',')}/${forced}`, async child => {
    const e = setup(child);
    const ids = e.props.state.seed.lineups.away.slice(0, 3).map(player => player.id);
    e.props.state = { ...e.props.state, indexes: { ...e.props.state.indexes, away: 4 },
      bases: occupied.map((present, index) => present ? ids[index] : null) };
    const batter = currentBatter(e.props.state);
    e.click('IN PLAY'); e.openSelectionWithRoute('Jugada de selección');
    const option = require('@playsport/shared').fieldersChoiceOptions(e.props.state)
      .find(option => option.forced && option.outRunnerId === ids[forced]);
    e.click(option.label);
    e.click('Confirmar jugada'); await e.settle();
    const next = applyPrivateCommand(e.props.state, e.commands[0]);
    assert.deepEqual(next.bases, expected.map(value => value === 'batter' ? batter : value === null ? null : ids[value]));
    assert.equal(next.outs, 1);
    assert.deepEqual(next.scores, e.props.state.scores);
  });
});

test('impossible multiple outs are unavailable and all green plays use IN PLAY', async t => {
  const e = setup(t);
  e.click('IN PLAY'); e.click('OUT');
  e.click('Rolling / rodado');
  assert.equal(e.button('Doble jugada').props.disabled, true);
  assert.equal(e.button('Triple jugada').props.disabled, true);
  e.click('Cancelar out por batazo'); e.click('Volver a IN PLAY'); e.click('Volver a lanzamientos');
  assert.equal(e.button('Golpeado por lanzamiento').props.disabled, true);
  e.click('IN PLAY');
  e.click('Golpeado por lanzamiento'); await e.settle();
  assert.deepEqual(e.commands[0], { kind: 'play', result: 'hitByPitch' });
  e.props.undoDisabled = true;
  assert.equal(e.button('Deshacer última anotación').props.disabled, true);
});

for (const [label, ballType, fixedType] of [
  ['Se embasa por error', 'ground', false], ['Sencillo + error', 'ground', false],
  ['Toque de sacrificio con error', 'bunt', true], ['Elevado de sacrificio con error', 'fly', true]
]) {
test(`${label} records runner outs with a route and preserves a known sacrifice type`, async t => {
  const { DefensiveErrorFields } = require('../app/demo/[slug]/defensive-error-fields');
  const { ErrorOutsField } = require('../app/demo/[slug]/run-accounting-panel');
  const e = setup(t);
  for (let index = 0; index < 3; index++) e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  const batter = currentBatter(e.props.state);
  e.click('IN PLAY'); e.click(label);
  nodes(e.render(), 'select').find(node => node.props.value === 2).props.onChange({ currentTarget: { value: '0' } });
  nodes(e.render(), DefensiveErrorFields)[0].props.onChange([
    { playerId: e.props.state.lineups.home[5].id, position: 'SS', type: 'throwing' }
  ]);
  nodes(e.render(), ErrorOutsField)[0].props.onChange('1');
  const rbi = nodes(e.render(), 'select').find(node => React.Children.toArray(node.props.children)
    .some(child => React.isValidElement(child) && child.props.children === 'Confirma las impulsadas'));
  rbi.props.onChange({ currentTarget: { value: '0' } });
  const sacrifice = nodes(e.render(), 'input').find(node => node.props.type === 'checkbox');
  if (sacrifice) sacrifice.props.onChange({ currentTarget: { checked: true } });
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  if (fixedType) {
    assert.equal(nodes(e.render(), DefensiveRouteFields)[0].props.onBallTypeChange, undefined);
    e.click('6 · Campocorto'); e.click('4 · Segunda base');
  } else e.fielding();
  e.click('Confirmar jugada'); await e.settle();
  assert.equal(e.commands[0].battedBallType, ballType);
  assert.deepEqual(e.commands[0].fieldingSequence, [6, 4]);
  const next = applyPrivateCommand(e.props.state, e.commands[0]);
  assert.equal(next.outs, 1);
  assert.equal(next.bases[0], batter);
  assert.deepEqual(next.log.at(-1).fieldingSequence, [6, 4]);
});
}

for (const label of ['Se embasa por error', 'Sencillo + error', 'Doble + error', 'Triple + error',
  'Toque de sacrificio con error', 'Elevado de sacrificio con error', 'Interferencia / obstrucción del receptor']) {
test(`${label} requires a defender and explicit RBI confirmation before dispatch`, async t => {
  const { DefensiveErrorFields } = require('../app/demo/[slug]/defensive-error-fields');
  const e = setup(t);
  if (label === 'Toque de sacrificio con error') e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'walk' });
  if (label === 'Elevado de sacrificio con error') e.props.state = applyPrivateCommand(e.props.state, { kind: 'play', result: 'triple' });
  e.click('IN PLAY'); e.click(label);
  assert.equal(e.commands.length, 0);
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  const rbi = nodes(e.render(), 'select').find(node => React.Children.toArray(node.props.children)
    .some(child => React.isValidElement(child) && child.props.children === 'Confirma las impulsadas'));
  rbi.props.onChange({ currentTarget: { value: '0' } });
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  const receiver = label === 'Interferencia / obstrucción del receptor';
  const errors = [{ playerId: e.props.state.lineups.home[receiver ? 1 : 5].id, position: receiver ? 'C' : 'SS', type: 'throwing' }];
  nodes(e.render(), DefensiveErrorFields)[0].props.onChange(errors);
  const sacrifice = nodes(e.render(), 'input').find(node => node.props.type === 'checkbox');
  if (sacrifice) {
    assert.equal(e.button('Confirmar jugada').props.disabled, true);
    sacrifice.props.onChange({ currentTarget: { checked: true } });
  }
  e.click('Confirmar jugada'); await e.settle();
  assert.equal(e.commands.length, 1);
  assert.deepEqual(e.commands[0].errors, errors);
  assert.equal(e.commands[0].rbis, 0);
});
}

test('uncaught strike detail blocks pitch buttons and back cancels without writing', t => {
  const e = setup(t);
  e.props.state = { ...e.props.state, strikes: 2 };
  e.click('IN PLAY');
  e.click('Tercer strike caído');
  assert.equal(e.button('Confirmar jugada').props.disabled, true);
  assert.equal(e.button('Strike').props.disabled, true);
  assert.equal(e.button('IN PLAY').props.disabled, true);
  e.screenBack();
  e.click('Volver a lanzamientos');
  assert.equal(e.button('Strike').props.disabled, false);
  assert.deepEqual(e.commands, []);
});

test('all added plays are direct green buttons in the original group without disclosure menus', t => {
  const { playLabels } = require('@playsport/shared');
  const e = setup(t);
  e.props.state = { ...e.props.state, strikes: 2 };
  e.click('IN PLAY');
  const group = nodes(e.render(), 'section').find(node => node.props['aria-label'] === 'Batazos y embasados');
  const buttons = nodes(group, 'button');
  for (const result of ['intentionalWalk', 'insideParkHomeRun', 'groundRuleDouble', 'buntHit',
    'hitByPitch', 'droppedThirdStrike', 'sacrificeBuntError', 'sacrificeFlyError', 'catcherInterference']) {
    const matches = buttons.filter(button => button.props.children === playLabels[result]);
    assert.equal(matches.length, 1, result);
    assert.match(matches[0].props.className, /\bprivatePlayOnBase\b/, result);
    assert.equal(Boolean(matches[0].props.disabled), false, result);
  }
  for (const label of ['Sencillo + error', 'Doble + error', 'Triple + error']) {
    assert.match(e.button(label).props.className, /\bprivatePlayOnBase\b/);
  }
  assert.equal(nodes(group, 'details').length, 0);
  assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Toque foul'), false);
  assert.equal(nodes(e.render(), 'button').some(node => node.props.children === 'Out en toque'), false);
  assert.equal(e.button('Foul').props.disabled, false);
  assert.equal(e.button('Toque de bola').props.disabled, false);
});
