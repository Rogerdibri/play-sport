import { sportsTheme } from '@playsport/shared';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

export default function MatchChatLink({ gameId }: { gameId: string }) {
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const visit = async () => {
    try {
      const origin = process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000';
      await Linking.openURL(`${origin}/demo/events-map?official=${encodeURIComponent(gameId)}#chat-del-partido`);
      setError('');
    } catch { setError('No se pudo abrir el chat del partido en la web. La pizarra sigue disponible.'); }
  };
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)}>
      <Text style={styles.title}>Chat del partido · {open ? 'Ocultar' : 'Abrir'}</Text>
    </Pressable>
    {open ? <>
      <Text>El chat público usa tu sesión de cuenta en la web, no los permisos del rol móvil. Cierra 30 minutos después del final oficial.</Text>
      <Pressable accessibilityRole="link" style={styles.button} onPress={() => void visit()}><Text>Abrir el chat de este partido en la web</Text></Pressable>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 14, gap: 12, backgroundColor: sportsTheme.surface, borderRadius: 12, borderWidth: 1, borderColor: sportsTheme.border },
  title: { fontWeight: '700', color: sportsTheme.text },
  button: { padding: 12, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 8, minHeight: 44 }
});
