const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const native = {
  View: 'view', Text: 'text', TextInput: 'input', Pressable: 'button', StyleSheet: { create: value => value }
};
const nativePath = require.resolve('react-native');
require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true, exports: native };
const values = new Map();
const storage = {
  getItem: async key => values.get(key) ?? null,
  setItem: async (key, value) => { values.set(key, value); }
};
const storagePath = require.resolve('@react-native-async-storage/async-storage');
require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: storage };
const shared = require('@playsport/shared');
const ScoringControls = require('../scoring-controls').default;
const { prepareNativeScoringCommand } = require('../scoring-controls');
const ScoringPractice = require('../scoring-practice').default;
const { nativeScoringPracticeSeed } = require('../scoring-practice');
const DefensiveErrorsSheet = require('../defensive-errors-sheet').default;
const GameClockDisplay = require('../game-clock').default;
const { officialAccountDestination } = require('../official-account-link');

function nodes(node) {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
}
function text(node) {
  if (!React.isValidElement(node)) return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
  return React.Children.toArray(node.props.children).map(text).join('');
}
function hooks(t, Component, props) {
  const states = [], refs = [], effects = [];
  let stateIndex, refIndex, effectIndex, pending;
  t.mock.method(React, 'useState', initial => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], update => { states[index] = typeof update === 'function' ? update(states[index]) : update; }];
  });
  t.mock.method(React, 'useRef', initial => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }));
  t.mock.method(React, 'useEffect', (effect, dependencies) => {
    const index = effectIndex++, previous = effects[index];
    if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
      pending.push(() => {
        previous?.cleanup?.();
        effects[index] = { dependencies, cleanup: effect() };
      });
    }
  });
  t.after(() => effects.forEach(effect => effect.cleanup?.()));
  return {
    render() {
      stateIndex = refIndex = effectIndex = 0; pending = [];
      const tree = Component(props);
      pending.forEach(effect => effect());
      return tree;
    },
    get(label) {
      const found = nodes(this.render()).filter(node => node.type === native.Pressable && text(node) === label);
      assert.equal(found.length, 1, `Expected one button: ${label}`);
      return found[0];
    },
    async click(label) {
      const button = this.get(label);
      assert.ok(!button.props.disabled, `Button disabled: ${label}`);
      button.props.onPress();
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}
function controls(t, commands = []) {
  const seed = nativeScoringPracticeSeed(), history = [...commands], sent = [];
  const props = {
    state: shared.replayPrivate(seed, history), disabled: false, canUndo: history.length > 0,
    onCommand: async command => {
      sent.push(command); history.push(command);
      props.state = shared.applyPrivateCommand(props.state, command); props.canUndo = true;
      return true;
    },
    onUndo: async () => {
      const previous = shared.undoPrivateCommand(seed, history);
      history.splice(0, history.length, ...previous.commands);
      props.state = previous.state; props.canUndo = history.length > 0;
      return true;
    }
  };
  return { ...hooks(t, ScoringControls, props), props, sent };
}

test('native IN PLAY never offers an ordinary walk shortcut at any count', async t => {
  const ui = controls(t), initial = ui.props.state;
  await ui.click('IN PLAY');
  for (let balls = 0; balls <= 3; balls++) for (let strikes = 0; strikes <= 2; strikes++) {
    ui.props.state = { ...initial, balls, strikes };
    assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === 'Base por bolas'), false);
    assert.equal(ui.get('Base intencional').props.disabled, false);
  }
  await ui.click('OUT');
  assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === 'Base por bolas'), false);
});

test('native fourth-ball walk from 2-2 and undo preserve the count, with intentional walks still separate', async t => {
  const seed = nativeScoringPracticeSeed(), ui = controls(t, shared.scorecardPracticeCommands(seed, 'walkCount'));
  const before = structuredClone(ui.props.state), batter = shared.currentBatter(before);
  await ui.click('IN PLAY'); await ui.click('Bola');
  assert.equal(ui.props.state.balls, 3); assert.equal(ui.props.state.strikes, 2);
  assert.equal(shared.currentBatter(ui.props.state), batter); assert.deepEqual(ui.props.state.bases, before.bases);
  await ui.click('Bola');
  assert.deepEqual(ui.sent, [{ kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'ball' }]);
  assert.equal(ui.props.state.balls, 0); assert.equal(ui.props.state.strikes, 0);
  assert.equal(ui.props.state.bases[0], batter); assert.notEqual(shared.currentBatter(ui.props.state), batter);
  assert.equal(ui.props.state.log.at(-1).result, 'walk');
  assert.equal(shared.privateStats(ui.props.state, 'away', batter).walks, 1);
  await ui.click('Deshacer última anotación');
  assert.equal(ui.props.state.balls, 3); assert.equal(ui.props.state.strikes, 2); assert.deepEqual(ui.props.state.bases, before.bases);
  await ui.click('Deshacer última anotación');
  assert.deepEqual(ui.props.state, before);
  await ui.click('IN PLAY'); await ui.click('Base intencional');
  assert.equal(ui.sent.at(-1).result, 'intentionalWalk');
  assert.equal(ui.props.state.log.at(-1).result, 'intentionalWalk');
});

test('native runner rule outs require a contextual cause, appeal and umpire confirmation before saving', async t => {
  for (const reason of shared.runnerRuleOutReasons) await t.test(reason, async child => {
    const seed = nativeScoringPracticeSeed(), ui = controls(child, shared.scorecardPracticeCommands(seed, 'runnerRuleOut'));
    const before = structuredClone(ui.props.state);
    await ui.click('Mover corredor de 2.ª base'); await ui.click('Out por regla');
    assert.equal(ui.get('Confirmar movimiento').props.disabled, true);
    await ui.click(shared.runnerRuleOutLabels[reason]);
    assert.equal(ui.get('Confirmar movimiento').props.disabled, true);
    if (['missedBase', 'missedRetouch'].includes(reason)) await ui.click('1.ª base');
    if (reason === 'other') nodes(ui.render()).find(node => node.type === native.TextInput).props.onChangeText('Abandono declarado por el árbitro.');
    await ui.click('El árbitro declaró out a este corredor');
    await ui.click('Cancelar movimiento');
    assert.deepEqual(ui.props.state, before); assert.deepEqual(ui.sent, []);
    await ui.click('Mover corredor de 2.ª base'); await ui.click('Out por regla');
    await ui.click(shared.runnerRuleOutLabels[reason]);
    if (['missedBase', 'missedRetouch'].includes(reason)) await ui.click('1.ª base');
    if (reason === 'other') nodes(ui.render()).find(node => node.type === native.TextInput).props.onChangeText('Abandono declarado por el árbitro.');
    await ui.click('El árbitro declaró out a este corredor'); await ui.click('Confirmar movimiento');
    assert.equal(ui.sent.length, 1); assert.equal(ui.sent[0].ruleOut.reason, reason);
    assert.equal(ui.props.state.outs, 1); assert.equal(ui.props.state.balls, 2); assert.equal(ui.props.state.strikes, 2);
    assert.deepEqual(ui.props.state.bases, [before.bases[0], null, before.bases[2]]);
    assert.deepEqual(ui.props.state.log.at(-1).ruleOut, ui.sent[0].ruleOut);
    await ui.click('Deshacer última anotación'); assert.deepEqual(ui.props.state, before);
  });
});

test('native baseball omits the softball early-departure cause but retains retouch appeals', async t => {
  const ui = controls(t, [{ kind: 'rules', rules: 'baseball' }, { kind: 'play', result: 'walk' }]);
  await ui.click('Mover corredor de 1.ª base'); await ui.click('Out por regla');
  assert.equal(nodes(ui.render()).some(node => text(node) === shared.runnerRuleOutLabels.leftEarly), false);
  assert.equal(ui.get(shared.runnerRuleOutLabels.missedRetouch).props.disabled, false);
});

test('native two-out selection offers only valid ordered options, keeps the batter safe and undoes the full play', async t => {
  const seed = nativeScoringPracticeSeed(), ui = controls(t, shared.scorecardPracticeCommands(seed, 'selectionTwoOuts'));
  const before = structuredClone(ui.props.state), batter = shared.currentBatter(before), save = ui.props.onCommand;
  ui.props.onCommand = async command => {
    const accepted = await save(command); assert.doesNotThrow(() => ui.render()); return accepted;
  };
  await ui.click('IN PLAY'); await ui.click('Jugada de selección · 2 outs');
  const options = shared.fieldersChoiceTwoOutOptions(before);
  assert.deepEqual(nodes(ui.render()).filter(node => node.type === native.Pressable &&
    ['1.ª base', '2.ª base', '3.ª base', 'Home'].includes(text(node))).map(text), ['2.ª base', '3.ª base', 'Home']);
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  const option = options.find(option => option.selectionOuts[0].base === 4 && option.selectionOuts[1].base === 3);
  await ui.click('Home'); assert.equal(ui.get('Confirmar jugada').props.disabled, true); await ui.click('3.ª base');
  assert.deepEqual(ui.sent, []); assert.deepEqual(ui.props.state, before);
  await ui.click('Cancelar jugada'); assert.deepEqual(ui.sent, []);
  await ui.click('Jugada de selección · 2 outs'); await ui.click('Home'); await ui.click('3.ª base'); await ui.click('Confirmar jugada');
  assert.equal(ui.sent.length, 1); assert.deepEqual(ui.sent[0].selectionOuts, option.selectionOuts);
  assert.equal(ui.props.state.bases[0], batter); assert.equal(ui.props.state.outs, 2);
  assert.equal(shared.privateStats(ui.props.state, 'away', batter).hits, 0);
  assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === 'Jugada de selección · 2 outs'), false);
  await ui.click('Deshacer última anotación'); assert.deepEqual(ui.props.state, before);
});

test('native guided outs cover every valid sequence, ask only on ambiguous bases and clear later choices on back', async t => {
  const ui = controls(t), initial = ui.props.state;
  const baseLabels = shared.fieldersChoiceBaseLabels;
  const basesShown = () => nodes(ui.render()).filter(node => node.type === native.Pressable)
    .map(text).filter(label => Object.values(baseLabels).includes(label));
  await ui.click('IN PLAY');
  for (let mask = 0; mask < 8; mask++) for (const outs of [0, 1, 2]) {
    const state = { ...initial, bases: initial.lineups.away.slice(0, 3).map((player, index) => mask & (1 << index) ? player.id : null),
      indexes: { home: 0, away: 4 }, outs };
    ui.props.state = state;
    const pairs = shared.fieldersChoiceTwoOutOptions(state);
    if (!pairs.length) {
      assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === 'Jugada de selección · 2 outs'), false);
      continue;
    }
    for (const pair of pairs) {
      await ui.click('Jugada de selección · 2 outs');
      assert.deepEqual(basesShown(), [...new Set(pairs.map(option => option.selectionOuts[0].base))].sort().map(base => baseLabels[base]));
      for (let step = 0; step < 2; step++) {
        const out = pair.selectionOuts[step];
        const candidates = pairs.filter(option => (!step || option.selectionOuts[0].runnerId === pair.selectionOuts[0].runnerId &&
          option.selectionOuts[0].base === pair.selectionOuts[0].base) && option.selectionOuts[step].base === out.base);
        await ui.click(baseLabels[out.base]);
        if (new Set(candidates.map(option => option.selectionOuts[step].runnerId)).size > 1) {
          assert.equal(ui.get('Confirmar jugada').props.disabled, true);
          const origin = state.bases.indexOf(out.runnerId) + 1;
          await ui.click(`${out.base === origin ? 'Toque al regresar' : 'Toque al avanzar'} · corredor de ${origin}.ª`);
        }
        if (step === 0) {
          assert.deepEqual(basesShown(), [...new Set(pairs.filter(option =>
            option.selectionOuts[0].runnerId === out.runnerId && option.selectionOuts[0].base === out.base)
            .map(option => option.selectionOuts[1].base))].sort().map(base => baseLabels[base]));
          assert.equal(ui.get('Confirmar jugada').props.disabled, true);
        }
      }
      assert.equal(ui.get('Confirmar jugada').props.disabled, false);
      assert.deepEqual(ui.sent, []); assert.deepEqual(ui.props.state, state);
      await ui.click('Cambiar segundo out'); assert.equal(ui.get('Confirmar jugada').props.disabled, true);
      await ui.click('Cambiar primer out'); assert.equal(ui.get('Confirmar jugada').props.disabled, true);
      assert.deepEqual(basesShown(), [...new Set(pairs.map(option => option.selectionOuts[0].base))].sort().map(base => baseLabels[base]));
      await ui.click('Cancelar jugada');
    }
  }
  assert.deepEqual(ui.sent, []);
});

test('native selection plus error identifies multiple defenders, saves no fictitious out and supports undo', async t => {
  const ui = controls(t, [{ kind: 'play', result: 'single' }]);
  const before = structuredClone(ui.props.state), runner = before.bases[0], batter = shared.currentBatter(before);
  const save = ui.props.onCommand;
  ui.props.onCommand = async command => {
    const accepted = await save(command); assert.doesNotThrow(() => ui.render()); return accepted;
  };
  await ui.click('IN PLAY'); await ui.click('Selección + error');
  const option = shared.fieldersChoiceOptions(before, true)[0];
  await ui.click(option.label);
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  assert.deepEqual(ui.sent, []); assert.deepEqual(ui.props.state, before);
  await ui.click('Cancelar jugada'); assert.deepEqual(ui.sent, []);
  await ui.click('Selección + error'); await ui.click(option.label);
  await ui.click('SS · Jugador 6'); await ui.click('Tiro · Error 1'); await ui.click('Añadir otro error');
  const defenders = nodes(ui.render()).filter(node => node.type === native.Pressable && text(node) === '2B · Jugador 4');
  assert.equal(defenders.length, 2);
  defenders[1].props.onPress(); ui.render();
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === '0 outs evitados'), false);
  await ui.click('0 impulsadas'); await ui.click('Confirmar jugada');
  assert.equal(ui.sent.length, 1); assert.equal(ui.sent[0].errorSavedRunnerId, runner);
  assert.equal(ui.sent[0].errors.length, 2); assert.equal(ui.sent[0].errors[0].type, 'throwing');
  assert.equal(ui.props.state.log.at(-1).outs, 0); assert.equal(ui.props.state.outs, 0);
  assert.deepEqual(ui.props.state.bases, [batter, runner, null]);
  assert.equal(shared.privateFieldingStats(ui.props.state, 'home').errors, 2);
  await ui.click('Deshacer última anotación'); assert.deepEqual(ui.props.state, before);
});

test('native selection error keeps two outs after a failed force and closes only on an actual third out', async t => {
  const ui = controls(t, [...shared.scorecardPracticeCommands(nativeScoringPracticeSeed(), 'fieldersChoiceLoaded'),
    { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' }]);
  const before = structuredClone(ui.props.state), option = shared.fieldersChoiceOptions(before, true)[0], actualOut = before.bases[1];
  await ui.click('IN PLAY'); await ui.click('Selección + error'); await ui.click(option.label);
  assert.doesNotMatch(text(ui.render()), /El tercer out fue/);
  assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === '2 outs evitados'), false);
  const label = `Corredor · ${shared.playerName(before, actualOut)}`;
  const group = nodes(ui.render()).find(node => node.type === native.View &&
    React.Children.toArray(node.props.children).some(child => child.type === native.Text && text(child) === label));
  nodes(group).find(node => node.type === native.Pressable && text(node) === 'Out').props.onPress();
  assert.match(text(ui.render()), /El tercer out fue forzado/);
  await ui.click('SS · Jugador 6'); await ui.click('0 impulsadas'); await ui.click('Confirmar jugada');
  assert.equal(ui.sent[0].destinations[actualOut], 0); assert.equal(ui.props.state.side, 'home');
  assert.equal(ui.props.state.log.at(-1).outs, 1); assert.equal(ui.props.state.log.at(-1).runs.length, 0);
  await ui.click('Deshacer última anotación'); assert.deepEqual(ui.props.state, before);
});

test('native fielders choice requires a contextual option, records one out without a hit and undoes', async t => {
  const ui = controls(t, [{ kind: 'play', result: 'single' }]);
  const before = structuredClone(ui.props.state), batter = shared.currentBatter(before), runner = before.bases[0];
  const save = ui.props.onCommand;
  ui.props.onCommand = async command => {
    const accepted = await save(command);
    assert.doesNotThrow(() => ui.render());
    return accepted;
  };
  await ui.click('IN PLAY'); await ui.click('Jugada de selección');
  assert.deepEqual(ui.sent, []); assert.deepEqual(ui.props.state, before);
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  assert.equal(nodes(ui.render()).some(node => node.type === native.Text && text(node).startsWith('Corredor ·')), false);
  await ui.click('Cancelar jugada');
  assert.deepEqual(ui.props.state, before); assert.deepEqual(ui.sent, []);
  await ui.click('Jugada de selección');
  const label = 'Out forzado en segunda · corredor de primera';
  await ui.click(label);
  const confirm = ui.get('Confirmar jugada');
  assert.equal(confirm.props.disabled, false);
  confirm.props.onPress(); confirm.props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ui.sent, [{ kind: 'play', result: 'fieldersChoice', destinations: { [runner]: 0, [batter]: 1 }, note: label }]);
  assert.equal(ui.props.state.outs, 1); assert.deepEqual(ui.props.state.bases, [batter, null, null]);
  assert.equal(shared.privateStats(ui.props.state, 'away', batter).hits, 0);
  const saved = shared.readPrivateSave(JSON.stringify({ version: 1, seed: before.seed,
    commands: [{ kind: 'play', result: 'single' }, ...ui.sent] }));
  assert.deepEqual(shared.replayPrivate(saved.seed, saved.commands), ui.props.state);
  await ui.click('Deshacer última anotación');
  assert.deepEqual(ui.props.state, before);
});

test('native selection options match all seven occupied scenarios and disappear without runners', async t => {
  const scenarios = ['fresh', ...Object.keys(shared.scorecardPracticeScenarios).filter(key => key.startsWith('fieldersChoice'))];
  for (const scenario of scenarios) await t.test(scenario, async child => {
    const seed = nativeScoringPracticeSeed(), ui = controls(child, shared.scorecardPracticeCommands(seed, scenario));
    const before = structuredClone(ui.props.state), expected = shared.fieldersChoiceOptions(before);
    await ui.click('IN PLAY');
    if (!expected.length) {
      assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === 'Jugada de selección'), false);
      return;
    }
    await ui.click('Jugada de selección');
    const actual = nodes(ui.render()).filter(node => node.type === native.Pressable &&
      (/^Out (forzado en|por toque)/.test(text(node)) || text(node) === 'Intento de out a otro corredor: todos quietos'));
    assert.deepEqual(actual.map(text), expected.map(option => option.label));
    await ui.click(expected[0].label);
    assert.deepEqual(ui.sent, []); assert.deepEqual(ui.props.state, before);
    await ui.click('Confirmar jugada');
    assert.deepEqual(ui.sent[0].destinations, expected[0].destinations);
    assert.equal(ui.props.state.outs, 1);
    await ui.click('Deshacer última anotación');
    assert.deepEqual(ui.props.state, before);
  });
});

test('native all-safe selection requires the first-base judgment and resets it when changing options', async t => {
  const ui = controls(t, [{ kind: 'play', result: 'single' }]);
  await ui.click('IN PLAY'); await ui.click('Jugada de selección');
  await ui.click('Intento de out a otro corredor: todos quietos');
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  await ui.click('La defensa podía retirar al bateador en primera con esfuerzo normal.');
  assert.equal(ui.get('Confirmar jugada').props.disabled, false);
  await ui.click('Out forzado en segunda · corredor de primera');
  await ui.click('Intento de out a otro corredor: todos quietos');
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  await ui.click('La defensa podía retirar al bateador en primera con esfuerzo normal.');
  await ui.click('Confirmar jugada');
  assert.equal(ui.props.state.outs, 0);
  assert.equal(shared.privateStats(ui.props.state, 'away', 'native-practice-away-2').hits, 0);
});

test('native tag third out requires explicit timing to count a preceding runner', async t => {
  const seed = nativeScoringPracticeSeed();
  const ui = controls(t, [...shared.scorecardPracticeCommands(seed, 'fieldersChoiceSecondThird'),
    { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' }]);
  const before = structuredClone(ui.props.state), name = shared.playerName(before, before.bases[2]);
  await ui.click('IN PLAY'); await ui.click('Jugada de selección');
  await ui.click('Out por toque en tercera · corredor de segunda');
  const participant = nodes(ui.render()).find(node => node.type === native.View &&
    React.Children.toArray(node.props.children).some(child => React.isValidElement(child) &&
      child.type === native.Text && text(child) === `Corredor · ${name}`));
  const home = nodes(participant).find(node => node.type === native.Pressable && text(node) === 'Home · carrera');
  assert.ok(home); home.props.onPress();
  await ui.click('Las carreras llegaron antes del tercer out por toque y el bateador ya había alcanzado primera.');
  await ui.click('Confirmar jugada');
  assert.equal(ui.sent[0].validThirdOutRuns, true);
  assert.equal(ui.props.state.scores.away, 1); assert.equal(ui.props.state.side, 'home');
  await ui.click('Deshacer última anotación');
  assert.deepEqual(ui.props.state, before);
});

test('native defensive sheets show every error, team totals and repeated responsible players without charging the batter', () => {
  const seed = nativeScoringPracticeSeed();
  const state = shared.replayPrivate(seed, shared.scorecardPracticeCommands(seed, 'errors'));
  const home = text(DefensiveErrorsSheet({ state, side: 'home' }));
  const away = text(DefensiveErrorsSheet({ state, side: 'away' }));
  assert.match(home, /E: 3 · total del equipo/);
  assert.match(home, /Jugador 6 · E: 2/);
  assert.match(home, /Jugador 3 · E: 1/);
  assert.equal((home.match(/Entrada 1/g) ?? []).length, 3);
  assert.match(away, /E: 1 · total del equipo/);
  assert.equal(shared.privateFieldingStats(state, 'away', seed.lineups.away[0].id).errors, 0);
});

test('native defensive sheets explicitly preserve unknown attribution and incomplete history', () => {
  const seed = nativeScoringPracticeSeed();
  const state = shared.replayPrivate(seed, [{ kind: 'play', result: 'error' }]);
  assert.match(text(DefensiveErrorsSheet({ state, side: 'home' })), /1 sin atribuir/);
  assert.match(text(DefensiveErrorsSheet({ state: { ...state, fieldingIncomplete: true }, side: 'home' })), /Historial defensivo incompleto/);
});

test('native obstruction requires the awarded destination and defender, preserves others, and undoes cleanly', async t => {
  const ui = controls(t, [{ kind: 'play', result: 'single' }, { kind: 'play', result: 'single' },
    { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'strike' }]);
  const before = structuredClone(ui.props.state), runner = before.bases[0];
  await ui.click('Mover corredor de 1.ª base');
  await ui.click('Avance por obstrucción defensiva');
  assert.equal(ui.get('Confirmar movimiento').props.disabled, true);
  assert.equal(ui.get('Segunda').props.disabled, true);
  await ui.click('SS · Jugador 6');
  assert.equal(ui.get('Confirmar movimiento').props.disabled, true);
  await ui.click('Tercera');
  await ui.click('0 outs evitados');
  assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === 'Añadir otro error'), false);
  await ui.click('Cancelar movimiento');
  assert.deepEqual(ui.props.state, before); assert.deepEqual(ui.sent, []);
  await ui.click('Mover corredor de 1.ª base'); await ui.click('Avance por obstrucción defensiva');
  await ui.click('SS · Jugador 6'); await ui.click('Tercera'); await ui.click('0 outs evitados');
  await ui.click('Confirmar movimiento');
  assert.deepEqual(ui.sent, [{ kind: 'runner', action: 'obstruction', from: 1, to: 3, errorOuts: 0,
    errors: [{ playerId: 'native-practice-home-6', position: 'SS', type: 'obstruction' }] }]);
  assert.deepEqual(ui.props.state.bases, [null, before.bases[1], runner]);
  assert.equal(ui.props.state.balls, 1); assert.equal(ui.props.state.strikes, 1); assert.equal(ui.props.state.outs, 0);
  assert.equal(shared.privateFieldingStats(ui.props.state, 'home').errors, 1);
  assert.match(text(DefensiveErrorsSheet({ state: ui.props.state, side: 'home' })), /Error por obstrucción defensiva/);
  await ui.click('Deshacer última anotación');
  assert.deepEqual(ui.props.state, before);
});

test('native preflight rejects unattributed errors and supplies exact default destinations', () => {
  const state = shared.createPrivateState(nativeScoringPracticeSeed());
  assert.throws(() => prepareNativeScoringCommand(state, { kind: 'play', result: 'error' }), /error|defensor/i);
  for (const result of ['intentionalWalk', 'insideParkHomeRun', 'groundRuleDouble', 'buntHit', 'buntOut', 'hitByPitch']) {
    const prepared = prepareNativeScoringCommand(state, { kind: 'play', result });
    assert.deepEqual(prepared.destinations, shared.minimumDestinations(state, result));
    assert.doesNotThrow(() => shared.readPrivateSave(JSON.stringify({ version: 1, seed: state.seed, commands: [prepared] })));
  }
});
for (const entry of ['strikeout', 'inPlay']) {
  test(`native uncaught third strike from ${entry} stays directly below pitches and cancels without writing`, async t => {
    const ui = controls(t, [{ kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }]);
    const before = structuredClone(ui.props.state);
    if (entry === 'strikeout') { await ui.click('Strike'); await ui.click('El receptor no lo retuvo'); }
    else { await ui.click('IN PLAY'); await ui.click(shared.playLabels.droppedThirdStrike); }
    const tree = ui.render(), children = React.Children.toArray(tree.props.children);
    assert.equal(nodes(tree).filter(node => node.props.testID === 'dropped-third-strike').length, 1);
    const pitches = children.findIndex(node => nodes(node).some(child => child.type === native.Pressable && text(child) === 'IN PLAY'));
    assert.ok(pitches >= 0);
    assert.equal(children[pitches + 1].props.testID, 'dropped-third-strike');
    assert.equal(ui.get('Confirmar jugada').props.disabled, true);
    await ui.click('Cancelar jugada');
    assert.equal(nodes(ui.render()).filter(node => node.props.testID === 'dropped-third-strike').length, 0);
    assert.deepEqual(ui.sent, []);
    assert.deepEqual(ui.props.state, before);
    assert.equal(ui.get('Strike').props.disabled, false);
  });
}

test('native Toque de bola immediately places the batter at first without a destination dialog', async t => {
  const ui = controls(t, [{ kind: 'play', result: 'triple' }]), before = ui.props.state;
  const batter = shared.currentBatter(before);
  await ui.click('IN PLAY'); await ui.click('Toque de bola');
  assert.equal(ui.sent.length, 1);
  assert.equal(ui.sent[0].result, 'buntHit');
  assert.equal(ui.sent[0].destinations[batter], 1);
  assert.equal(ui.props.state.bases[0], batter);
  assert.equal(ui.props.state.bases[2], before.bases[2]);
  assert.deepEqual(ui.props.state.scores, before.scores);
  assert.equal(ui.props.state.outs, before.outs);
  assert.doesNotMatch(text(ui.render()), /Confirmar jugada|Hit de toque/);
});
test('native pitches remain visible and update the count from every scoring phase', async t => {
  for (const phase of ['pitch', 'inPlay', 'out']) for (const [label, value] of [['Strike', 'strike'], ['Bola', 'ball'], ['Foul', 'foul']]) {
    await t.test(`${phase}/${value}`, async child => {
      const ui = controls(child, [{ kind: 'play', result: 'single' }]), before = structuredClone(ui.props.state);
      if (phase !== 'pitch') await ui.click('IN PLAY');
      if (phase === 'out') await ui.click('OUT');
      await ui.click(label);
      assert.deepEqual(ui.sent, [{ kind: 'pitch', value }]);
      assert.equal(ui.props.state.balls, value === 'ball' ? 1 : 0);
      assert.equal(ui.props.state.strikes, value === 'ball' ? 0 : 1);
      assert.deepEqual(ui.props.state.bases, before.bases);
      assert.equal(ui.props.state.outs, before.outs);
    });
  }
});
test('native pending details and in-flight writes still block pitch buttons', async t => {
  const ui = controls(t);
  await ui.click('IN PLAY'); await ui.click(shared.playLabels.error);
  for (const label of ['Strike', 'Bola', 'Foul']) assert.equal(ui.get(label).props.disabled, true);
  await ui.click('Cancelar jugada');
  let release;
  ui.props.onCommand = () => new Promise(resolve => { release = resolve; });
  ui.get('Bola').props.onPress();
  for (const label of ['Strike', 'Bola', 'Foul']) assert.equal(ui.get(label).props.disabled, true);
  release(false); await new Promise(resolve => setImmediate(resolve));
  for (const label of ['Strike', 'Bola', 'Foul']) assert.equal(ui.get(label).props.disabled, false);
  ui.props.disabled = true;
  for (const label of ['Strike', 'Bola', 'Foul']) assert.equal(ui.get(label).props.disabled, true);
});
test('native added plays appear directly beside existing plays with identical green styling', async t => {
  const ui = controls(t, [{ kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }]);
  await ui.click('IN PLAY');
  const reference = ui.get(shared.playLabels.single).props.style[1];
  assert.equal(reference.backgroundColor, '#e3f2e7');
  for (const result of ['intentionalWalk', 'insideParkHomeRun', 'groundRuleDouble', 'buntHit',
    'hitByPitch', 'droppedThirdStrike', 'sacrificeBuntError', 'sacrificeFlyError', 'catcherInterference']) {
    const button = ui.get(shared.playLabels[result]);
    assert.equal(button.props.disabled, false, result);
    assert.equal(button.props.style[1], reference, result);
  }
  for (const label of ['Sencillo + error', 'Doble + error', 'Triple + error']) {
    assert.equal(ui.get(label).props.style[1], reference, label);
  }
  assert.doesNotMatch(text(ui.render()), /Más batazos y embasados|Jugadas sin batazo/);
  assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === 'Toque foul'), false);
  assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === 'Out en toque'), false);
  assert.equal(ui.get('Foul').props.disabled, false);
  assert.equal(ui.get('Toque de bola').props.disabled, false);
});
test('native error waits for defender and RBIs; applying and undoing preserve the shared scorecard', async t => {
  const ui = controls(t);
  await ui.click('IN PLAY'); await ui.click(shared.playLabels.error);
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  await ui.click('SS · Jugador 6'); await ui.click('0 impulsadas');
  await ui.click('Confirmar jugada');
  assert.deepEqual(ui.sent[0].errors, [{ playerId: 'native-practice-home-6', position: 'SS', type: 'fielding' }]);
  assert.equal(ui.props.state.bases[0], 'native-practice-away-1');
  assert.equal(ui.props.state.outs, 0);
  await ui.click('Deshacer última anotación');
  assert.deepEqual(ui.props.state.bases, [null, null, null]);
  assert.equal(ui.props.state.log.length, 0);
});
for (const label of ['Se embasa por error', 'Sencillo + error', 'Doble + error', 'Triple + error',
  'Toque de sacrificio con error', 'Elevado de sacrificio con error', 'Interferencia / obstrucción del receptor']) {
  test(`native ${label} cannot save before the responsible defender is selected`, async t => {
    const ui = controls(t, shared.scorecardPracticeScenarios.third.commands);
    await ui.click('IN PLAY'); await ui.click(label);
    await ui.click('0 impulsadas');
    assert.equal(ui.get('Confirmar jugada').props.disabled, true);
    assert.equal(ui.sent.length, 0);
    const receiver = label === 'Interferencia / obstrucción del receptor';
    await ui.click(receiver ? 'C · Jugador 2' : 'SS · Jugador 6');
    if (['Toque de sacrificio con error', 'Elevado de sacrificio con error'].includes(label))
      await ui.click('Confirmo el sacrificio sin el error');
    await ui.click('Confirmar jugada');
    assert.equal(ui.sent.length, 1);
    assert.equal(ui.props.state.log.at(-1).errors[0].position, receiver ? 'C' : 'SS');
  });
}
test('native dropped third strike requires WP/PB, records a strikeout and does not invent an out', async t => {
  const ui = controls(t, [{ kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }]);
  await ui.click('IN PLAY'); await ui.click(shared.playLabels.droppedThirdStrike);
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  await ui.click('Bola pasada (PB)');
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  await ui.click('Cantado (ꓘ)'); await ui.click('Confirmar jugada');
  assert.equal(ui.sent[0].thirdStrikeCause, 'passed');
  assert.equal(ui.sent[0].strikeoutType, 'looking');
  assert.equal(ui.props.state.outs, 0);
  assert.equal(ui.props.state.bases[0], 'native-practice-away-1');
  assert.equal(shared.privateStats(ui.props.state, 'away', 'native-practice-away-1').strikeouts, 1);
});
for (const [strikeoutType, label, code] of [['swinging', 'Abanicando (K)', 'K'], ['looking', 'Cantado (ꓘ)', 'ꓘ']]) {
  test(`native third strike confirms ${strikeoutType}, persists its type and undoes exactly`, async t => {
    const ui = controls(t, [{ kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }]);
    const before = structuredClone(ui.props.state);
    await ui.click('Strike');
    assert.equal(ui.sent.length, 0);
    assert.deepEqual(ui.props.state, before);
    for (const control of ['Strike', 'Bola', 'Foul', 'IN PLAY', 'Deshacer última anotación'])
      assert.equal(ui.get(control).props.disabled, true);
    await ui.click('Cancelar ponche');
    assert.deepEqual(ui.props.state, before);
    await ui.click('Strike'); await ui.click(label);
    assert.deepEqual(ui.sent, [{ kind: 'pitch', value: 'strike', strikeoutType }]);
    assert.equal(ui.props.state.outs, 1);
    assert.equal(shared.privateInningSummary(ui.props.state.log, shared.currentBatter(before))[0].code, code);
    await ui.click('Deshacer última anotación');
    assert.deepEqual(ui.props.state, before);
  });
}
test('native third-strike prompt retains the uncaught strike route without an automatic out', async t => {
  const ui = controls(t, [{ kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }]);
  await ui.click('Strike'); await ui.click('El receptor no lo retuvo');
  await ui.click('Abanicando (K)'); await ui.click('Lanzamiento descontrolado (WP)');
  await ui.click('Confirmar jugada');
  assert.equal(ui.sent.length, 1);
  assert.equal(ui.props.state.outs, 0);
  assert.equal(ui.props.state.bases[0], 'native-practice-away-1');
  assert.equal(ui.props.state.log.at(-1).strikeoutType, 'swinging');
});
test('native outs omit the manual strikeout and keep the typed third Strike available', async t => {
  const ui = controls(t, [{ kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }]);
  await ui.click('IN PLAY'); await ui.click('OUT');
  assert.equal(nodes(ui.render()).some(node => node.type === native.Pressable && text(node) === 'Ponche'), false);
  for (const result of shared.scorecardPlayGroups.find(group => group.tone === 'out').results)
    assert.equal(ui.get(shared.playLabels[result]).props.disabled, ['doublePlay', 'triplePlay'].includes(result));
  await ui.click('Strike');
  assert.equal(ui.sent.length, 0);
  await ui.click('Cantado (ꓘ)');
  assert.deepEqual(ui.sent, [{ kind: 'pitch', value: 'strike', strikeoutType: 'looking' }]);
  assert.equal(ui.props.state.outs, 1);
});
test('native sacrifice fly error requires sacrifice confirmation and an active defender', async t => {
  const ui = controls(t, shared.scorecardPracticeScenarios.third.commands);
  await ui.click('IN PLAY');
  await ui.click(shared.playLabels.sacrificeFlyError);
  await ui.click('CF · Jugador 8'); await ui.click('0 impulsadas');
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  await ui.click('Confirmo el sacrificio sin el error'); await ui.click('Confirmar jugada');
  assert.equal(ui.sent[0].result, 'sacrificeFlyError');
  assert.equal(ui.props.state.outs, 0);
  assert.equal(ui.props.state.log.at(-1).errors[0].position, 'CF');
});
test('native runner movement requires a cause and attributes advancement errors', async t => {
  const ui = controls(t, [{ kind: 'play', result: 'single' }]);
  await ui.click('Mover corredor de 1.ª base');
  assert.equal(ui.get('Confirmar movimiento').props.disabled, true);
  await ui.click(shared.runnerLabels.error);
  assert.equal(ui.get('Confirmar movimiento').props.disabled, true);
  await ui.click('SS · Jugador 6'); await ui.click('Tiro · Error 1'); await ui.click('0 outs evitados');
  await ui.click('Confirmar movimiento');
  assert.deepEqual(ui.sent[0], { kind: 'runner', from: 1, to: 2, action: 'error',
    errors: [{ playerId: 'native-practice-home-6', position: 'SS', type: 'throwing' }], errorOuts: 0 });
  assert.equal(ui.props.state.bases[1], 'native-practice-away-1');
});
test('native foul error preserves batter and count', async t => {
  const ui = controls(t, [{ kind: 'pitch', value: 'strike' }]);
  await ui.click('Error en foul que prolonga el turno'); await ui.click('C · Jugador 2');
  await ui.click('Confirmar error en foul');
  assert.equal(ui.sent[0].kind, 'misplay'); assert.equal(ui.sent[0].errorOuts, 1);
  assert.equal(ui.props.state.strikes, 1);
  assert.equal(shared.currentBatter(ui.props.state), 'native-practice-away-1');
});
test('native slowpitch blocks unsupported plays and becomes immutable after a pitch', async t => {
  const ui = controls(t);
  await ui.click(`Reglamento: ${shared.scoringRuleLabels.baseball}`); await ui.click(shared.scoringRuleLabels['softball-slowpitch']);
  await ui.click('IN PLAY');
  assert.equal(ui.get(shared.playLabels.droppedThirdStrike).props.disabled, true);
  assert.equal(ui.get(shared.playLabels.hitByPitch).props.disabled, true);
  await ui.click('Volver a lanzamientos'); await ui.click('Strike');
  assert.equal(ui.get(shared.scoringRuleLabels.baseball).props.disabled, true);
});
test('native failed save retains the detail and prevents a concurrent duplicate submission', async t => {
  const ui = controls(t);
  let finish, calls = 0;
  ui.props.onCommand = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  await ui.click('IN PLAY'); await ui.click(shared.playLabels.error);
  await ui.click('SS · Jugador 6'); await ui.click('0 impulsadas');
  const confirm = ui.get('Confirmar jugada');
  confirm.props.onPress(); confirm.props.onPress();
  assert.equal(calls, 1);
  assert.equal(ui.get('Confirmar jugada').props.disabled, true);
  finish(false); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.get('Confirmar jugada').props.disabled, false);
  assert.match(text(ui.render()), /Responsable: Jugador 6/);
});
test('native practice persists separately, restores after reopening, and undoes without an API', async t => {
  values.clear();
  const ui = hooks(t, ScoringPractice, { onBack() {} });
  ui.render(); await new Promise(resolve => setImmediate(resolve));
  let control = nodes(ui.render()).find(node => node.type === ScoringControls);
  assert.ok(control);
  const command = prepareNativeScoringCommand(control.props.state, { kind: 'play', result: 'intentionalWalk' });
  assert.equal(await control.props.onCommand(command), true);
  const key = 'playsport:scorecard-practice:native:v1:third';
  const saved = shared.readPrivateSave(values.get(key));
  assert.equal(saved.commands.at(-1).result, 'intentionalWalk');
  assert.deepEqual({ ...shared.replayPrivate(saved.seed, saved.commands), clock: saved.clock }, nodes(ui.render()).find(node => node.type === ScoringControls).props.state);
  await ui.click(shared.scorecardPracticeScenarios.fresh.label);
  ui.render(); await new Promise(resolve => setImmediate(resolve));
  await ui.click(shared.scorecardPracticeScenarios.third.label);
  ui.render(); await new Promise(resolve => setImmediate(resolve));
  control = nodes(ui.render()).find(node => node.type === ScoringControls);
  assert.equal(control.props.state.log.at(-1).result, 'intentionalWalk');
  assert.equal(await control.props.onUndo(), true);
  assert.equal(shared.readPrivateSave(values.get(key)).commands.length, saved.commands.length - 1);
  assert.equal([...values.keys()].every(value => value.startsWith('playsport:scorecard-practice:native:')), true);
});
test('native practice starts time on new scoring, resumes without counting pauses, and restores it without replay side effects', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-17T00:00:00.000Z') });
  values.clear();
  const ui = hooks(t, ScoringPractice, { onBack() {} });
  ui.render(); await new Promise(resolve => setImmediate(resolve));
  const control = () => nodes(ui.render()).find(node => node.type === ScoringControls);
  const clock = () => nodes(ui.render()).find(node => node.type === GameClockDisplay);
  assert.equal(clock().props.clock, undefined, 'replaying the exercise must not start a clock');
  await control().props.onCommand({ kind: 'pitch', value: 'ball' });
  assert.equal(clock().props.clock.runningSince, '2026-11-17T00:00:00.000Z');
  t.mock.timers.tick(10000);
  clock().props.onAction('pause'); await new Promise(resolve => setImmediate(resolve));
  const paused = clock().props.clock;
  assert.equal(paused.elapsedMs, 10000);
  t.mock.timers.tick(90000);
  await control().props.onUndo();
  assert.deepEqual(clock().props.clock, paused);
  const failingWrite = t.mock.method(storage, 'setItem', async () => { throw new Error('Storage unavailable'); });
  assert.equal(await control().props.onCommand({ kind: 'pitch', value: 'ball' }), false);
  assert.deepEqual(clock().props.clock, paused);
  failingWrite.mock.restore();
  await control().props.onCommand({ kind: 'pitch', value: 'ball' });
  assert.equal(clock().props.clock.runningSince, '2026-11-17T00:01:40.000Z');
  assert.equal(clock().props.clock.elapsedMs, 10000);
  const resumed = clock().props.clock;
  await ui.click(shared.scorecardPracticeScenarios.fresh.label);
  await ui.click(shared.scorecardPracticeScenarios.third.label);
  ui.render(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(clock().props.clock, resumed);
});
test('native practice failed storage does not advance the scorecard or overwrite saved state', async t => {
  values.clear();
  const ui = hooks(t, ScoringPractice, { onBack() {} });
  ui.render(); await new Promise(resolve => setImmediate(resolve));
  const control = nodes(ui.render()).find(node => node.type === ScoringControls);
  t.mock.method(storage, 'setItem', async () => { throw new Error('Storage unavailable'); });
  assert.equal(await control.props.onCommand({ kind: 'play', result: 'intentionalWalk' }), false);
  assert.equal(nodes(ui.render()).find(node => node.type === ScoringControls).props.state, control.props.state);
  assert.equal(values.size, 0); assert.match(text(ui.render()), /Storage unavailable/);
});
test('native practice exposes corrupt storage instead of silently resetting it', async t => {
  values.clear(); values.set('playsport:scorecard-practice:native:v1:third', '{broken');
  const ui = hooks(t, ScoringPractice, { onBack() {} });
  ui.render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes(ui.render()).some(node => node.type === ScoringControls), false);
  assert.ok(nodes(ui.render()).some(node => node.props.accessibilityRole === 'alert'));
  assert.equal(values.get('playsport:scorecard-practice:native:v1:third'), '{broken');
});
test('native official scoring retains the account-authenticated web destination', () => {
  for (const role of ['organizer', 'scorekeeper']) {
    assert.equal(officialAccountDestination('live-scoring', role).path, `/demo/live-scoring?view=${role}`);
  }
  assert.equal(officialAccountDestination('live-scoring', 'player'), null);
});
test('native compatibility supplies cloning only when missing and preserves nested values', () => {
  const path = require.resolve('../polyfills'), original = globalThis.structuredClone;
  try {
    globalThis.structuredClone = undefined;
    delete require.cache[path]; require(path);
    const source = { entries: [{ when: new Date(0), scores: new Map([['home', 1]]) }] };
    const copy = structuredClone(source);
    assert.notEqual(copy.entries[0], source.entries[0]);
    assert.equal(copy.entries[0].when.getTime(), 0);
    assert.equal(copy.entries[0].scores.get('home'), 1);
    assert.throws(() => structuredClone({ invalid() {} }));
    assert.throws(() => structuredClone(source, { transfer: [new ArrayBuffer(4)] }), /transferencia/);
    globalThis.structuredClone = original;
    delete require.cache[path]; require(path);
    assert.equal(globalThis.structuredClone, original);
  } finally { globalThis.structuredClone = original; delete require.cache[path]; }
});
