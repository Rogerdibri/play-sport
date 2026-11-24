const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { sportsTheme } = require('@playsport/shared');
const css = readFileSync(require.resolve('../app/globals.css'), 'utf8');

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(channel => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('web variables and the native shared palette stay equivalent', () => {
  for (const [name, value] of Object.entries(sportsTheme)) {
    const variable = name.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
    assert.match(css, new RegExp(`--sport-${variable}:\\s*${value}\\s*;`), name);
  }
});

test('reading surfaces, dark headers and red actions meet normal-text WCAG AA contrast', () => {
  for (const [foreground, background] of [
    ['text', 'surface'], ['muted', 'surface'], ['muted', 'surfaceAlt'],
    ['onDark', 'ink'], ['mutedOnDark', 'ink'], ['onDark', 'accent'],
    ['onDark', 'accentPressed'], ['accent', 'surface'], ['accent', 'accentSoft']
  ]) {
    assert.ok(contrast(sportsTheme[foreground], sportsTheme[background]) >= 4.5, `${foreground} on ${background}`);
  }
  for (const background of ['surface', 'ink']) {
    assert.ok(contrast(sportsTheme.focus, sportsTheme[background]) >= 3, `focus on ${background}`);
  }
});

test('game-state visual treatments cover official and calendar statuses without replacing controls', () => {
  for (const status of ['live', 'in_progress', 'finished', 'final']) {
    assert.ok(css.includes(`.eventsGame[data-game-status="${status}"]`));
  }
  const official = readFileSync(require.resolve('../app/demo/[slug]/official-calendar.tsx'), 'utf8');
  assert.match(official, /data-game-status=\{game\.status\}/);
  assert.match(css, /\.calendarDateShortcuts button\[aria-pressed="true"\]/);
  assert.match(css, /\.gameClockButton:disabled\s*\{[^}]*cursor:\s*not-allowed/s);
});

test('balls, strikes and outs retain distinct colors legible on the dark counter', () => {
  const colors = ['balls', 'strikes', 'outs'].map(kind => {
    const color = css.match(new RegExp(`\\.privateGameCount \\[data-count="${kind}"\\] dd\\s*\\{\\s*color:\\s*(#[0-9a-f]{6})`))?.[1];
    assert.ok(color, kind);
    assert.ok(contrast(color, sportsTheme.ink) >= 4.5, kind);
    return color;
  });
  assert.equal(new Set(colors).size, 3);
});
