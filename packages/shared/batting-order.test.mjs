import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignBattingOrder, availableLineupPositions, findDuplicateFieldPosition } from './dist/index.js';

const player = (id, lineupRole = 'PLAYER', battingOrder = null) => ({
  id, lineupRole, battingOrder
});

test('assigns consecutive turns in insertion order without mutating input', () => {
  const entries = [player('A'), player('B', 'DP'), player('C', 'EH')];
  assert.deepEqual(assignBattingOrder(entries).map((entry) => entry.battingOrder), [1, 2, 3]);
  assert.equal(entries[0].battingOrder, null);
});

test('FLEX has no turn and does not displace later batters', () => {
  const entries = [player('A'), player('F', 'FLEX'), player('B')];
  assert.deepEqual(assignBattingOrder(entries).map(({ id, battingOrder }) => [id, battingOrder]),
    [['A', 1], ['B', 2], ['F', null]]);
});

test('removing a batter closes gaps and updating in place preserves the turn', () => {
  const entries = assignBattingOrder([player('A'), player('B'), player('C')]);
  const removed = assignBattingOrder(entries.filter((entry) => entry.id !== 'B'));
  assert.deepEqual(removed.map((entry) => entry.battingOrder), [1, 2]);
  const updated = assignBattingOrder(removed.map((entry) => entry.id === 'A' ? { ...entry, lineupRole: 'DP' } : entry));
  assert.equal(updated[0].id, 'A');
  assert.equal(updated[0].battingOrder, 1);
});

test('role changes close gaps and append a former FLEX to the batting order', () => {
  const entries = assignBattingOrder([player('A'), player('B'), player('F', 'FLEX')]);
  const converted = assignBattingOrder(entries.map((entry) => entry.id === 'A' ? { ...entry, lineupRole: 'FLEX' } : entry));
  assert.equal(converted[0].id, 'B');
  assert.equal(converted[0].battingOrder, 1);
  const restored = assignBattingOrder(entries.map((entry) => entry.id === 'F' ? { ...entry, lineupRole: 'PLAYER' } : entry));
  assert.equal(restored[2].battingOrder, 3);
  assert.deepEqual(assignBattingOrder([]), []);
});

test('occupied positions disappear, an edited player retains its own position, and removal releases it', () => {
  const entries = [
    { identificationNumber: 'A', fieldPosition: 'P' },
    { identificationNumber: 'B', fieldPosition: 'C' }
  ];
  assert.equal(availableLineupPositions(entries, 'new').includes('P'), false);
  assert.equal(availableLineupPositions(entries, 'new').includes('C'), false);
  assert.equal(availableLineupPositions(entries, 'A').includes('P'), true);
  assert.equal(availableLineupPositions(entries, 'A').includes('C'), false);
  assert.equal(availableLineupPositions(entries.slice(1), 'new').includes('P'), true);
});

test('repeated field positions and designated hitter are rejected, but NA occupies no position', () => {
  assert.equal(findDuplicateFieldPosition(Array.from({ length: 9 }, () => ({ fieldPosition: 'P' }))), 'P');
  assert.equal(findDuplicateFieldPosition([{ fieldPosition: 'DH' }, { fieldPosition: 'DH' }]), 'DH');
  assert.equal(findDuplicateFieldPosition([{ fieldPosition: 'P' }, { fieldPosition: 'NA' }, { fieldPosition: 'NA' }]), null);
});
