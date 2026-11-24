import { sportsTheme } from '@playsport/shared';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

export type BottomDestination = 'home' | 'profile' | 'roles' | 'marketplace' | 'events';
const items: ReadonlyArray<{ id: BottomDestination; label: string }> = [
  { id: 'home', label: 'Inicio' }, { id: 'profile', label: 'Mi cuenta' },
  { id: 'roles', label: 'Elegir rol' }, { id: 'marketplace', label: 'Marketplace' },
  { id: 'events', label: 'Cartelera' },
];

function Icon({ id, color }: { id: BottomDestination; color: string }) {
  const line = { borderColor: color };
  return <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {id === 'home' ? <><View style={[styles.roof, line]} /><View style={[styles.house, line]} /></>
      : id === 'profile' ? <><View style={[styles.head, line]} /><View style={[styles.shoulders, line]} /></>
      : id === 'roles' ? <><View style={[styles.arrowRight, line]} /><View style={[styles.arrowLeft, line]} />
        <View style={[styles.upperLine, { backgroundColor: color }]} /><View style={[styles.lowerLine, { backgroundColor: color }]} /></>
      : id === 'marketplace' ? <><View style={[styles.shop, line]} /><View style={[styles.awning, line]} /><View style={[styles.door, line]} /></>
      : <><View style={[styles.calendar, line]} /><View style={[styles.calendarLine, { backgroundColor: color }]} />
        <View style={[styles.calendarDate, { backgroundColor: color }]} /></>}
  </View>;
}

export default function BottomNavigation({ active, disabled, onSelect }: {
  active: BottomDestination | null; disabled: boolean;
  onSelect: (_destination: BottomDestination) => void; // eslint-disable-line no-unused-vars
}) {
  return <SafeAreaView style={styles.safeArea}><View style={styles.bar} accessibilityLabel="Navegación inferior">
    {items.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label}
      accessibilityState={{ selected: active === item.id, disabled }} disabled={disabled}
      onPress={() => onSelect(item.id)}
      style={[styles.button, active === item.id ? styles.selected : null, disabled ? styles.disabled : null]}>
      <Icon id={item.id} color={active === item.id ? '#ffffff' : '#c9c9cf'} />
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
        style={[styles.label, active === item.id ? styles.selectedLabel : null]}>{item.label}</Text>
    </Pressable>)}
  </View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: sportsTheme.ink },
  bar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#343438', paddingHorizontal: 4, paddingVertical: 6 },
  button: { flex: 1, minHeight: 60, minWidth: 44, alignItems: 'center', justifyContent: 'center', gap: 5, borderTopWidth: 3, borderTopColor: 'transparent' },
  selected: { borderTopColor: sportsTheme.accent },
  disabled: { opacity: 0.5 },
  label: { color: '#c9c9cf', fontSize: 10, fontWeight: '600' },
  selectedLabel: { color: '#ffffff' },
  icon: { width: 24, height: 24 },
  roof: { position: 'absolute', width: 15, height: 15, borderTopWidth: 2, borderLeftWidth: 2, transform: [{ rotate: '45deg' }], top: 3, left: 5 },
  house: { position: 'absolute', width: 18, height: 14, borderWidth: 2, borderTopWidth: 0, bottom: 1, left: 3, borderRadius: 2 },
  head: { position: 'absolute', width: 10, height: 10, borderWidth: 2, borderRadius: 5, left: 7, top: 1 },
  shoulders: { position: 'absolute', width: 20, height: 10, borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 10, borderTopRightRadius: 10, bottom: 1, left: 2 },
  arrowRight: { position: 'absolute', width: 8, height: 8, borderTopWidth: 2, borderRightWidth: 2, right: 3, top: 3, transform: [{ rotate: '45deg' }] },
  arrowLeft: { position: 'absolute', width: 8, height: 8, borderBottomWidth: 2, borderLeftWidth: 2, left: 3, bottom: 3, transform: [{ rotate: '45deg' }] },
  upperLine: { position: 'absolute', width: 18, height: 2, top: 6, left: 3 },
  lowerLine: { position: 'absolute', width: 18, height: 2, bottom: 6, left: 3 },
  shop: { position: 'absolute', width: 18, height: 16, borderWidth: 2, bottom: 1, left: 3 },
  awning: { position: 'absolute', width: 22, height: 7, borderWidth: 2, borderRadius: 2, top: 1, left: 1 },
  door: { position: 'absolute', width: 6, height: 9, borderWidth: 2, bottom: 1, left: 9 },
  calendar: { position: 'absolute', width: 20, height: 20, borderWidth: 2, borderRadius: 2, top: 3, left: 2 },
  calendarLine: { position: 'absolute', width: 18, height: 2, top: 9, left: 3 },
  calendarDate: { position: 'absolute', width: 4, height: 4, top: 14, left: 7 },
});
