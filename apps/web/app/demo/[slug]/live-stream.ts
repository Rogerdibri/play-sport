// eslint-disable-next-line no-unused-vars -- Type-only callback parameter.
export function connectVisibleStream(url: string, configure: (source: globalThis.EventSource) => void) {
  let source: globalThis.EventSource | null = null;
  const synchronize = () => {
    if (globalThis.document.visibilityState === 'hidden') {
      source?.close();
      source = null;
    } else if (!source) {
      source = new globalThis.EventSource(url, { withCredentials: true });
      configure(source);
    }
  };
  globalThis.document.addEventListener('visibilitychange', synchronize);
  synchronize();
  return () => {
    globalThis.document.removeEventListener('visibilitychange', synchronize);
    source?.close();
  };
}
