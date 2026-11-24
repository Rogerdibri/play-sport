import { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { printAsync } from 'expo-print';
import { readGameReportPrintRequest } from '@playsport/shared';
import { webApplicationOrigin } from './application-origin';

export default function App() {
  const webview = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  let origin = '';
  let configurationError = '';
  try { origin = webApplicationOrigin(process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN, Constants.expoConfig?.hostUri, __DEV__); }
  catch (failure) { if (failure instanceof Error) configurationError = failure.message; else throw failure; }
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false;
      webview.current?.goBack();
      return true;
    });
    return () => handler.remove();
  }, []);
  const external = (url: string) => {
    if (!/^(https?:|mailto:|tel:)/i.test(url)) { setError('Este enlace no es compatible con PlaySport.'); return; }
    void Linking.openURL(url).catch(() => setError('No se pudo abrir el enlace. Vuelve a intentarlo.'));
  };
  const recover = async (event: WebViewMessageEvent) => {
    if (!origin) return;
    if (event.nativeEvent.data !== JSON.stringify({ type: 'playsport:legacy-accesses' })) {
      let requestId: number | null = null;
      const reply = (ok: boolean, message?: string) => webview.current?.injectJavaScript(
        `window.dispatchEvent(new CustomEvent('playsport:print-result',{detail:${JSON.stringify({ requestId, ok, message })}}));true;`);
      try {
        if (new URL(event.nativeEvent.url).origin !== origin) throw new Error('La solicitud no proviene de la web de PlaySport.');
        const request = readGameReportPrintRequest(JSON.parse(event.nativeEvent.data));
        requestId = request.requestId;
        setError('');
        await printAsync({ html: request.html, orientation: 'landscape' });
        reply(true);
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : 'No se pudo imprimir el resumen del partido.';
        setError(message);
        if (requestId !== null) reply(false, message);
      }
      return;
    }
    try {
      if (new URL(event.nativeEvent.url).origin !== origin) throw new Error('La solicitud no proviene de la web de PlaySport.');
      const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('playsport:demo-registration:access:'));
      const entries = await AsyncStorage.multiGet(keys);
      const values = entries.map(([, value]) => value);
      if (!values.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)))
        throw new Error('Un acceso anterior guardado en la app es inválido. No se modificó.');
      webview.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('playsport:legacy-accesses',{detail:${JSON.stringify({ keys: values })}}));true;`);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'No se pudieron leer los accesos anteriores de la app.';
      setError(message);
      webview.current?.injectJavaScript("window.dispatchEvent(new CustomEvent('playsport:legacy-accesses',{detail:null}));true;");
    }
  };
  return <SafeAreaView style={styles.screen}>
    {!origin ? <View style={styles.message}><Text accessibilityRole="alert">{configurationError}</Text></View> : <>
      {error ? <View style={styles.message}><Text accessibilityRole="alert">{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => { setError(''); setAttempt(value => value + 1); }}><Text>Reintentar</Text></Pressable>
      </View> : null}
      <WebView key={attempt} ref={webview} source={{ uri: origin }} style={styles.screen}
        sharedCookiesEnabled thirdPartyCookiesEnabled={false} setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures startInLoadingState
        onNavigationStateChange={state => { canGoBack.current = state.canGoBack; }}
        onMessage={event => void recover(event)}
        onShouldStartLoadWithRequest={request => {
          try {
            if (request.url === 'about:blank' || new URL(request.url).origin === origin) return true;
            external(request.url); return false;
          } catch { setError('El enlace no contiene una dirección válida.'); return false; }
        }}
        onError={() => setError('No hay conexión con PlaySport. Revisa la red y la dirección de la web; tus datos guardados no se han reemplazado.')}
        onHttpError={event => setError(`PlaySport respondió con un error ${event.nativeEvent.statusCode}. Vuelve a intentarlo.`)}
        renderLoading={() => <View style={styles.message}><Text accessibilityRole="progressbar">Abriendo PlaySport…</Text></View>}
      />
    </>}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f9' },
  message: { padding: 20, gap: 12 }
});
