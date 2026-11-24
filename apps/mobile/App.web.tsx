import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { webApplicationOrigin } from './application-origin';

export default function App() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      const target = webApplicationOrigin(process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN, globalThis.location.host, __DEV__);
      if (target === globalThis.location.origin) throw new Error('El puerto de Expo y el de la web deben ser diferentes.');
      setOrigin(target);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo abrir PlaySport.'); }
  }, []);
  useEffect(() => {
    const recover = async (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow ||
          !event.data || event.data.type !== 'playsport:legacy-accesses') return;
      try {
        const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('playsport:demo-registration:access:'));
        const entries = await AsyncStorage.multiGet(keys);
        const values = entries.map(([, value]) => value);
        if (!values.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)))
          throw new Error('Un acceso anterior de Expo web es inválido. No se modificó.');
        frame.current?.contentWindow?.postMessage({ type: 'playsport:legacy-accesses:response', keys: values }, origin);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'No se pudieron leer los accesos anteriores.');
        frame.current?.contentWindow?.postMessage({ type: 'playsport:legacy-accesses:response', keys: null }, origin);
      }
    };
    const receive = (event: MessageEvent) => { void recover(event); };
    globalThis.addEventListener('message', receive);
    return () => globalThis.removeEventListener('message', receive);
  }, [origin]);
  return <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#f6f7f9' }}>
    {error ? <p role="alert">{error} {origin ? <a href={origin}>Abrir PlaySport directamente</a> : null}</p> : null}
    {origin ? <iframe ref={frame} title="PlaySport" src={origin} name={`playsport:legacy-parent:${globalThis.location.origin}`}
      style={{ flex: 1, minHeight: 0, width: '100%', border: 0 }}
      onError={() => setError('No se pudo conectar con la web de PlaySport. Revisa la red y su dirección.')} /> :
      !error ? <p role="status">Abriendo la misma interfaz de PlaySport…</p> : null}
  </div>;
}
