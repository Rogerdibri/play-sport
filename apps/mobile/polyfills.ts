import clone from '@ungap/structured-clone';

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T, options?: { transfer?: readonly unknown[] }): T => {
    if (options?.transfer?.length) throw new Error('La transferencia de objetos no está disponible en este motor.');
    return clone(value);
  };
}
