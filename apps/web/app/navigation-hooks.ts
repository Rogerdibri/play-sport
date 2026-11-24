'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { demoIdentity } from './platform-navigation';
import { readNavigationDraft } from './navigation-drafts';
import { usePlatformSession } from './platform-session';

// eslint-disable-next-line no-unused-vars -- Type-only predicate parameter.
export function useNavigationDraft<T>(key: string | null, initial: T, valid: (value: unknown) => value is T, ownerId?: string): [T, Dispatch<SetStateAction<T>>, boolean] {
  const { session, reportNavigationError } = usePlatformSession();
  const storageKey = key === null ? null : `playsport:draft:v1:${ownerId ?? (session ? demoIdentity(session).id : 'entry')}:${key}`;
  const settings = useRef({ initial, valid });
  settings.current = { initial, valid };
  const current = useRef({ key: storageKey, value: initial });
  const [value, setValue] = useState(initial);
  const [loadedKey, setLoadedKey] = useState<string | null>();
  useEffect(() => {
    try {
      const restored = storageKey === null ? settings.current.initial :
        readNavigationDraft(globalThis.sessionStorage.getItem(storageKey), settings.current.initial, settings.current.valid);
      current.current = { key: storageKey, value: restored };
      setValue(restored);
      setLoadedKey(storageKey);
    } catch (failure) {
      reportNavigationError(failure instanceof Error ? failure.message : 'No se pudo recuperar el borrador.');
    }
  }, [storageKey, reportNavigationError]);
  const update = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    try {
      const previous = current.current.key === storageKey ? current.current.value :
        storageKey === null ? settings.current.initial :
          readNavigationDraft(globalThis.sessionStorage.getItem(storageKey), settings.current.initial, settings.current.valid);
      // eslint-disable-next-line no-unused-vars -- Type-only updater parameter.
      const updated = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
      if (!settings.current.valid(updated)) throw new Error('No se pudo conservar un borrador inválido.');
      if (storageKey !== null) globalThis.sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, value: updated }));
      current.current = { key: storageKey, value: updated };
      setValue(updated);
    } catch (failure) {
      reportNavigationError(failure instanceof Error ? failure.message : 'No se pudo conservar el borrador. Revisa el almacenamiento del navegador.');
    }
  }, [storageKey, reportNavigationError]);
  return [value, update, loadedKey === storageKey];
}

export function useNavigationBusy(busy: boolean) {
  const { registerNavigationBusy } = usePlatformSession();
  useEffect(() => busy ? registerNavigationBusy() : undefined, [busy, registerNavigationBusy]);
}

export function useScreenBack(action: () => void, active: boolean, priority = 1) {
  const { registerScreenBack } = usePlatformSession();
  const latest = useRef(action);
  latest.current = action;
  useEffect(() => active ? registerScreenBack(() => latest.current(), priority) : undefined, [active, priority, registerScreenBack]);
}
