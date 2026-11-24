import { sportsTheme } from '@playsport/shared';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

export default function MarketplaceLink() {
  const [error, setError] = useState('');
  const visit = async (wallet = false) => {
    try {
      await Linking.openURL(`${process.env.EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000'}${wallet ? '/wallet' : '/demo/marketplace'}`);
      setError('');
    } catch { setError('No se pudo abrir la sección en la web. Vuelve a intentarlo.'); }
  };
  return <View style={styles.card}><Text style={styles.title}>Compra, venta y subastas</Text>
    <Text>Marketplace deportivo: artículos y precios en USD. No hay cobros, tarjetas ni transferencias reales.</Text>
    <Text>Consulta preguntas públicas sin comprar. Al confirmar una compra o ganar una subasta se crea el chat privado del pedido para coordinar pago, envío o retiro. El rol móvil no sustituye el inicio de sesión.</Text>
    <Text>Guarda favoritos por cuenta y filtra por deporte o por nuevo/usado. Béisbol y softbol se exploran juntos.</Text>
    <Text>El pago usa la billetera única de tu cuenta: saldo retenido hasta confirmar recepción.</Text>
    <Pressable accessibilityRole="link" onPress={() => void visit()} style={styles.button}><Text>Abrir Marketplace en la web</Text></Pressable>
    <Pressable accessibilityRole="link" onPress={() => void visit(true)} style={styles.button}><Text>Abrir mi billetera única en la web</Text></Pressable>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}</View>;
}
const styles = StyleSheet.create({
  card: { gap: 16, padding: 18, borderRadius: 14, backgroundColor: sportsTheme.surface },
  title: { fontSize: 22, fontWeight: '700', color: sportsTheme.text },
  button: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: sportsTheme.border, minHeight: 44 }
});
