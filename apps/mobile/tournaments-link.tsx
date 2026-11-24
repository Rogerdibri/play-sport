import { sportsTheme } from '@playsport/shared';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
export default function TournamentsLink() {
  const [error, setError] = useState('');
  const open = async () => {
    try {
      await Linking.openURL(
        `${process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000'}/demo/tournaments`
      );
      setError('');
    } catch {
      setError('No se pudo abrir Crear torneo. Revisa la dirección web e inténtalo de nuevo.');
    }
  };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Crear y administrar torneos</Text>
      <Text>
        Configura tu liga, fases, equipos, rosters, sedes, programación semanal, sanciones y comunicados desde el módulo
        compartido en la web.
      </Text>
      <Text>
        Inicia sesión con tu cuenta y elige Organizador en la web. El rol móvil no concede permisos ni sustituye esa
        sesión.
      </Text>
      <Pressable accessibilityRole="link" style={styles.button} onPress={() => void open()}>
        <Text>Abrir Crear torneo en la web</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 18, gap: 16, borderRadius: 14, backgroundColor: sportsTheme.surface },
  title: { fontSize: 22, fontWeight: '700' },
  button: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: sportsTheme.border, minHeight: 44 }
});
