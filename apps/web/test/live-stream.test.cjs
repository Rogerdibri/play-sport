const assert = require('node:assert/strict');
const { test } = require('node:test');
const { connectVisibleStream } = require('../app/demo/[slug]/live-stream');

function browser(t, visibilityState = 'visible') {
  const document = new EventTarget();
  document.visibilityState = visibilityState;
  const sources = [];
  class Source extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.closed = false;
      sources.push(this);
    }
    close() { this.closed = true; }
  }
  for (const [key, value] of Object.entries({ document, EventSource: Source })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  return {
    sources,
    visibility(value) {
      document.visibilityState = value;
      document.dispatchEvent(new Event('visibilitychange'));
    }
  };
}

test('visible pages open one stream without duplicating it on visibility notifications', (t) => {
  const page = browser(t);
  let configured = 0;
  const disconnect = connectVisibleStream('/game/stream', () => configured++);
  page.visibility('visible');
  assert.equal(page.sources.length, 1);
  assert.equal(page.sources[0].url, '/game/stream');
  assert.equal(configured, 1);
  disconnect();
  assert.equal(page.sources[0].closed, true);
});

test('hidden pages do not consume a persistent connection', (t) => {
  const page = browser(t, 'hidden');
  const disconnect = connectVisibleStream('/game/stream', () => {});
  page.visibility('hidden');
  assert.equal(page.sources.length, 0);
  page.visibility('visible');
  assert.equal(page.sources.length, 1);
  disconnect();
});

test('hiding releases the connection and returning reinstalls snapshot handlers', (t) => {
  const page = browser(t);
  let snapshots = 0;
  const disconnect = connectVisibleStream('/game/stream', (source) => {
    source.addEventListener('snapshot', () => snapshots++);
  });
  page.sources[0].dispatchEvent(new Event('snapshot'));
  page.visibility('hidden');
  assert.equal(page.sources[0].closed, true);
  page.visibility('visible');
  assert.equal(page.sources.length, 2);
  assert.equal(page.sources[1].closed, false);
  page.sources[1].dispatchEvent(new Event('snapshot'));
  assert.equal(snapshots, 2);
  disconnect();
});

test('unmounting removes the visibility listener and cannot reopen a stream', (t) => {
  const page = browser(t);
  const disconnect = connectVisibleStream('/game/stream', () => {});
  disconnect();
  page.visibility('hidden');
  page.visibility('visible');
  assert.equal(page.sources.length, 1);
  assert.equal(page.sources[0].closed, true);
});
