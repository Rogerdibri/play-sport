import { sportsTheme } from '@playsport/shared';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PlatformModuleId, PlatformRoleId } from '@playsport/shared';
import ScoringPractice from './scoring-practice';

type Destination = { title: string; path: string };

export function officialAccountDestination(
  moduleId: PlatformModuleId,
  role: PlatformRoleId,
): Destination | null {
  if (moduleId === 'player-career') {
    return { title: 'Mi hoja deportiva', path: '/sports-sheet' };
  }
  if (
    moduleId === 'live-scoring' &&
    (role === 'organizer' || role === 'scorekeeper')
  ) {
    return {
      title: 'Mis partidos oficiales',
      path: `/demo/live-scoring?view=${role}`,
    };
  }
  if (moduleId === 'organizer-center' && role === 'organizer') {
    return { title: 'Centro del organizador', path: '/demo/organizer-center' };
  }
  if (role === 'manager') {
    if (moduleId === 'team-hq')
      return { title: 'Mi roster', path: '/demo/roster' };
    if (moduleId === 'manager-games' || moduleId === 'live-scoring') {
      return { title: 'Mis partidos y lineups', path: '/demo/manager-games' };
    }
  }
  return null;
}

export default function OfficialAccountLink({
  destination,
  onBusy,
}: {
  destination: Destination;
  onBusy?: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
}) {
  const [error, setError] = useState('');
  const [practice, setPractice] = useState(false);
  const open = async () => {
    try {
      const origin = (
        process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000'
      ).replace(/\/$/, '');
      await Linking.openURL(`${origin}${destination.path}`);
      setError('');
    } catch {
      setError(
        'No se pudo abrir la sección. Revisa la dirección web e inténtalo de nuevo.',
      );
    }
  };
  if (practice) return <ScoringPractice onBack={() => setPractice(false)} onBusy={onBusy} />;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{destination.title}</Text>
      {destination.path === '/account' ? <Text>Tu perfil, hoja deportiva, billetera y seguridad en un mismo lugar, con la misma cuenta para todos tus roles.</Text> : null}
      <Text>
        Inicia sesión con tu cuenta en la web para abrir esta sección con tu
        identidad y tus permisos.
      </Text>
      <Text>
        La web verifica tu identidad y tus asignaciones. Elegir un rol en el
        móvil no concede permisos ni sustituye esa sesión.
      </Text>
      <Text>
        La cartelera, las pizarras y los resultados públicos siguen disponibles
        en el móvil.
      </Text>
      {destination.path.startsWith('/demo/live-scoring') ? <Pressable accessibilityRole="button" style={styles.button}
        onPress={() => setPractice(true)}><Text>Practicar anotación en esta app</Text></Pressable> : null}
      <Pressable
        accessibilityRole="link"
        style={styles.button}
        onPress={() => void open()}
      >
        <Text>Abrir {destination.title} en la web</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 16, borderRadius: 14, backgroundColor: sportsTheme.surface },
  title: { fontSize: 22, fontWeight: '700' },
  button: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: sportsTheme.border,
    minHeight: 44,
  },
});
