import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import {
  MobileDraftStorage, managerDraftKey, officialDraftKey, newManagerGameDraft, newOfficialGameDraft, newMobileDrafts,
  type ManagerDraftContext, type ManagerGameDraft, type MobileDrafts, type OfficialDraftContext, type OfficialDraftRole, type OfficialGameDraft
} from './drafts';

type Field<T> = [T, Dispatch<SetStateAction<T>>];
function nextValue<T>(action: SetStateAction<T>, previous: T): T {
  // eslint-disable-next-line no-unused-vars -- Type-only updater parameter.
  return typeof action === 'function' ? (action as (value: T) => T)(previous) : action;
}
const message = (failure: unknown) => failure instanceof Error ? failure.message : 'No se pudieron guardar los borradores en este dispositivo.';

export function useMobileDrafts() {
  const [store] = useState(() => new MobileDraftStorage(AsyncStorage));
  const current = useRef(newMobileDrafts());
  const mounted = useRef(false);
  const loaded = useRef(false);
  const pending = useRef(0);
  const revision = useRef(0);
  const loadRequest = useRef(0);
  const [state, setState] = useState(current.current);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    const request = ++loadRequest.current;
    setLoading(true); setError('');
    try {
      const restored = await store.load();
      if (mounted.current && request === loadRequest.current) {
        current.current = restored; setState(restored); loaded.current = true;
      }
    } catch (failure) {
      if (mounted.current && request === loadRequest.current) setError(message(failure));
    } finally { if (mounted.current && request === loadRequest.current) setLoading(false); }
  };
  const persist = (updated: MobileDrafts) => {
    const version = ++revision.current;
    current.current = updated; setState(updated);
    pending.current += 1; setSaving(true);
    void store.save(updated).then(() => {
      if (mounted.current && version === revision.current) setError('');
    }, (failure: unknown) => {
      if (mounted.current) setError(message(failure));
    }).finally(() => {
      pending.current -= 1;
      if (mounted.current) setSaving(pending.current > 0);
    });
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') void store.flush().catch((failure: unknown) => {
        if (mounted.current) setError(message(failure));
      });
    });
    return () => { mounted.current = false; loadRequest.current += 1; subscription.remove(); };
  }, [store]);
  const update = (modify: (value: MobileDrafts) => MobileDrafts) => { // eslint-disable-line no-unused-vars
    if (!loaded.current || error) return;
    persist(modify(current.current));
  };
  function managerContext<K extends keyof ManagerDraftContext>(key: K): Field<ManagerDraftContext[K]> {
    return [state.manager.context[key], (action) => update((value) => ({
      ...value, manager: { ...value.manager, context: { ...value.manager.context, [key]: nextValue(action, value.manager.context[key]) } }
    }))];
  }
  function managerGame<K extends keyof ManagerGameDraft>(field: K): Field<ManagerGameDraft[K]> {
    const key = managerDraftKey(state.manager.context);
    const game = state.manager.games[key] ?? newManagerGameDraft();
    return [game[field], (action) => update((value) => {
      const previous = value.manager.games[key] ?? newManagerGameDraft();
      return { ...value, manager: { ...value.manager, games: { ...value.manager.games, [key]: { ...previous, [field]: nextValue(action, previous[field]) } } } };
    })];
  }
  function officialContext<K extends keyof OfficialDraftContext>(role: OfficialDraftRole, key: K): Field<OfficialDraftContext[K]> {
    return [state.officials[role].context[key], (action) => update((value) => ({
      ...value, officials: { ...value.officials, [role]: {
        ...value.officials[role], context: { ...value.officials[role].context, [key]: nextValue(action, value.officials[role].context[key]) }
      } }
    }))];
  }
  function officialGame<K extends keyof OfficialGameDraft>(role: OfficialDraftRole, field: K): Field<OfficialGameDraft[K]> {
    const key = officialDraftKey(state.officials[role].context);
    const game = state.officials[role].games[key] ?? newOfficialGameDraft();
    return [game[field], (action) => update((value) => {
      const profile = value.officials[role], previous = profile.games[key] ?? newOfficialGameDraft();
      return { ...value, officials: { ...value.officials, [role]: {
        ...profile, games: { ...profile.games, [key]: { ...previous, [field]: nextValue(action, previous[field]) } }
      } } };
    })];
  }
  return {
    managerContext, managerGame, officialContext, officialGame, loading, saving, error,
    retry: () => { if (loaded.current) persist(current.current); else void load(); }
  };
}
