'use client';

import { Fragment, useEffect, useId, useState, type Dispatch, type SetStateAction } from 'react';
import { availableLineupPositions, findDuplicateFieldPosition } from '@playsport/shared';
import { fieldPositionLabels, privatePositions } from './private-scorecard';

export type LineupEntryDraft = {
  identificationNumber: string;
  battingOrder: number | null;
  fieldPosition: string;
  lineupRole: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
  jerseyNumber: string;
};

export const lineupRoleOptions: Array<{ value: LineupEntryDraft['lineupRole']; label: string }> = [
  { value: 'PLAYER', label: 'Jugador regular' },
  { value: 'DP', label: 'Bateador asignado' },
  { value: 'FLEX', label: 'Jugador flexible · defensa sin turno' },
  { value: 'EH', label: 'Bateador extra' }
];

export const lineupJerseyNumbers = Array.from({ length: 100 }, (_, index) => String(index).padStart(2, '0'));
const maxBatters = 13;

const emptyLineupRow = (battingOrder: number | null): LineupEntryDraft => ({
  identificationNumber: '', battingOrder, fieldPosition: '', jerseyNumber: '',
  lineupRole: battingOrder === null ? 'FLEX' : 'PLAYER'
});
const hasLineupSelection = (entry: LineupEntryDraft): boolean => Boolean(
  entry.identificationNumber || entry.jerseyNumber || entry.fieldPosition || entry.lineupRole !== 'PLAYER'
);

export function resetLineupRows(): LineupEntryDraft[] {
  return Array.from({ length: maxBatters }, (_, index) => emptyLineupRow(index + 1));
}

export function changeLineupRow(
  entries: LineupEntryDraft[], battingOrder: number | null,
  changes: Partial<Omit<LineupEntryDraft, 'battingOrder'>>
): LineupEntryDraft[] {
  const previous = entries.find(entry => entry.battingOrder === battingOrder);
  const row = previous ?? emptyLineupRow(battingOrder);
  const changedPlayer = changes.identificationNumber !== undefined && changes.identificationNumber !== row.identificationNumber;
  const updated = { ...row, ...(changedPlayer ? { jerseyNumber: '', fieldPosition: '' } : {}), ...changes };
  return [...entries.filter(entry => entry.battingOrder !== battingOrder), updated]
    .sort((left, right) => (left.battingOrder ?? 14) - (right.battingOrder ?? 14));
}

export function lineupTableError(entries: LineupEntryDraft[], rosterIds: string[]): string | null {
  const used = entries.filter(hasLineupSelection);
  const ordered = [...used].sort((left, right) => (left.battingOrder ?? 14) - (right.battingOrder ?? 14));
  const batters = ordered.filter(entry => entry.battingOrder !== null);
  if (batters.length > maxBatters || ordered.length > 14 || batters.some(entry =>
    entry.battingOrder === null || !Number.isInteger(entry.battingOrder) || entry.battingOrder < 1 || entry.battingOrder > maxBatters)) {
    return 'Completa de 9 a 13 turnos al bate; puedes agregar un jugador flexible sin bateo.';
  }
  for (const entry of ordered) {
    const row = entry.battingOrder === null ? 'FLEX' : `turno ${entry.battingOrder}`;
    if (!entry.identificationNumber || !rosterIds.includes(entry.identificationNumber)) return `Selecciona un jugador del roster para el ${row}.`;
    if (!/^\d{1,2}$/.test(entry.jerseyNumber)) return `Selecciona una camiseta del 00 al 99 para el ${row}.`;
    if (!privatePositions.includes(entry.fieldPosition)) return `Selecciona la posición del ${row}.`;
    if (entry.lineupRole === 'FLEX' && (entry.battingOrder !== null || entry.fieldPosition === 'NA')) return 'El jugador flexible debe tener defensa y no ocupa turno al bate.';
    if (entry.lineupRole !== 'FLEX' && entry.battingOrder === null) return 'Cada bateador debe ocupar un turno del cuadro.';
  }
  if (batters.some((entry, index) => entry.battingOrder !== index + 1)) return 'Completa los turnos en orden, desde el 1 y sin dejar filas vacías entre bateadores.';
  if (batters.length < 9) return 'Completa al menos 9 titulares antes de enviar el lineup.';
  if (new Set(ordered.map(entry => entry.identificationNumber)).size !== ordered.length) return 'Un jugador no puede ocupar dos filas del lineup.';
  if (new Set(ordered.map(entry => entry.jerseyNumber.padStart(2, '0'))).size !== ordered.length) return 'No se puede repetir un número de camiseta en el lineup.';
  const duplicatePosition = findDuplicateFieldPosition(ordered);
  if (duplicatePosition) return `La posición ${fieldPositionLabels[duplicatePosition]} está repetida.`;
  const dp = ordered.filter(entry => entry.lineupRole === 'DP').length;
  const flex = ordered.filter(entry => entry.lineupRole === 'FLEX').length;
  if (dp !== flex || flex > 1) return 'El bateador asignado y el jugador flexible deben registrarse juntos, con uno de cada rol.';
  return null;
}

type Props = {
  entries: LineupEntryDraft[];
  players: Array<{ identificationNumber: string; displayName: string }>;
  disabled: boolean;
  onChange: Dispatch<SetStateAction<LineupEntryDraft[]>>;
};

export default function ManagerLineupTable({ entries, players, disabled, onChange }: Props) {
  const [editingSlot, setEditingSlot] = useState<number | null>();
  const [resetRequested, setResetRequested] = useState(false);
  const editorPrefix = useId();
  useEffect(() => {
    if (editingSlot === undefined || disabled) return;
    globalThis.document.getElementById(`${editorPrefix}-${editingSlot ?? 'flex'}`)?.querySelector('select')?.focus();
  }, [editingSlot, disabled, editorPrefix]);
  const hasFlex = entries.some(entry => entry.lineupRole === 'FLEX');
  const hasSelections = entries.some(hasLineupSelection);
  const readyRows = entries.filter(entry => entry.battingOrder !== null && entry.identificationNumber && entry.jerseyNumber && entry.fieldPosition).length;
  const slots: Array<number | null> = Array.from({ length: maxBatters }, (_, index) => index + 1);
  if (hasFlex) slots.push(null);
  return <>
    <div className="baseballLineupToolbar">
    <span className="baseballLineupCount"><strong>{readyRows}<span> / {maxBatters}</span></strong>titulares preparados · mínimo 9</span>
    <button type="button" className="managerButtonOutline" id={`reset-${editorPrefix}`}
      disabled={disabled || !hasSelections} onClick={() => setResetRequested(true)}>Reiniciar lineup</button>
    </div>
    <details className="baseballHelp"><summary>Cómo armar tu tarjeta</summary>
      <p>Tienes 13 filas disponibles. Completa al menos los primeros 9 titulares: jugador del roster, camiseta del 00 al 99 y posición. Los turnos 10 al 13 son opcionales; no dejes huecos ni filas a medio llenar.</p>
      <p>El FLEX es adicional y no ocupa turno al bate. Puedes editar cualquier fila antes de enviar. Al entregar quedan fijas la cantidad de turnos titulares y la cantidad de defensores.</p>
    </details>
    {resetRequested ? <div className="managerInlineList" role="group" aria-label="Confirmar reinicio del lineup">
      <p>¿Reiniciar el lineup desde cero? Se borrarán los jugadores, camisetas, posiciones, roles y FLEX. Quedarán las 13 filas disponibles, todas vacías.</p>
      <p>No se modifica el roster, el dirigente, los suplentes ni el personal presente. Tampoco se cambia ninguna alineación ya enviada.</p>
      <div className="managerButtonRow">
        <button type="button" className="managerButtonSolid" disabled={disabled} onClick={() => {
          onChange(resetLineupRows());
          setEditingSlot(undefined);
          setResetRequested(false);
          globalThis.document.getElementById(`button-${editorPrefix}-1`)?.focus();
        }}>Sí, reiniciar desde cero</button>
        <button type="button" className="managerButtonOutline" disabled={disabled} onClick={() => {
          setResetRequested(false);
          globalThis.document.getElementById(`reset-${editorPrefix}`)?.focus();
        }}>Cancelar</button>
      </div>
    </div> : null}
    <table className="managerLineupTable">
      <caption>Lineup del partido · orden de bateo</caption>
      <thead><tr><th scope="col">Turno</th><th scope="col">Jugador del roster</th><th scope="col">Camiseta</th><th scope="col">Posición</th><th scope="col">Rol</th><th scope="col">Acción</th></tr></thead>
      <tbody>{slots.map(slot => {
        const row = entries.find(entry => entry.battingOrder === slot);
        const label = slot === null ? 'FLEX' : `turno ${slot}`;
        const others = entries.filter(entry => entry.battingOrder !== slot);
        const playerId = row?.identificationNumber ?? '';
        const jersey = row?.jerseyNumber ? row.jerseyNumber.padStart(2, '0') : '';
        const isEditing = editingSlot === slot;
        const editorId = `${editorPrefix}-${slot ?? 'flex'}`;
        const playerName = playerId ? players.find(player => player.identificationNumber === playerId)?.displayName ?? 'Jugador no disponible en el roster' : 'Elegir jugador del roster';
        const positions = availableLineupPositions(others, playerId).filter(position => slot !== null || position !== 'NA');
        const change = (patch: Partial<Omit<LineupEntryDraft, 'battingOrder'>>) =>
          onChange(current => changeLineupRow(current, slot, patch));
        return <Fragment key={slot ?? 'flex'}>
          <tr className="managerLineupSummary"><td colSpan={6}>
            <button type="button" className="managerLineupRowButton" id={`button-${editorId}`}
              aria-label={`Editar ${label}`} aria-expanded={isEditing} aria-controls={editorId}
              disabled={disabled} onClick={() => setEditingSlot(isEditing ? undefined : slot)}>
              <strong className="baseballOrder">{slot === null ? 'FLEX' : String(slot).padStart(2, '0')}</strong>
              <span title={playerName}>{playerName}</span>
              <span className="baseballJersey"><span className="baseballSrOnly">Camiseta </span>{jersey || '—'}</span>
              <abbr title={fieldPositionLabels[row?.fieldPosition ?? ''] ?? 'Elegir posición'}>{row?.fieldPosition || 'POS'}</abbr>
              <span className="baseballLineupRole" title={lineupRoleOptions.find(option => option.value === (row?.lineupRole ?? 'PLAYER'))?.label}>{row?.lineupRole && row.lineupRole !== 'PLAYER' ? row.lineupRole : 'Regular'}</span>
              <span className="baseballRowAction">{isEditing ? 'Cerrar' : playerId ? 'Editar' : 'Elegir'}</span>
            </button>
          </td></tr>
          <tr id={editorId} className="managerLineupEditor" hidden={!isEditing}>
          <th scope="row">{slot === null ? 'FLEX · sin bateo' : `${slot}.º bate`}</th>
          <td><label><span>Jugador del roster</span><select aria-label={`Jugador del ${label}`} disabled={disabled} value={playerId}
            onChange={event => change({ identificationNumber: event.target.value })}>
            <option value="">Elegir jugador del roster</option>
            {players.filter(player => !others.some(entry => entry.identificationNumber === player.identificationNumber)).map(player =>
              <option key={player.identificationNumber} value={player.identificationNumber}>{player.displayName} · {player.identificationNumber}</option>)}
          </select></label></td>
          <td><label><span>Camiseta</span><select aria-label={`Camiseta del ${label}`} disabled={disabled || !playerId} value={jersey}
            onChange={event => change({ jerseyNumber: event.target.value })}>
            <option value="">Elegir número</option>
            {lineupJerseyNumbers.map(number => <option key={number} value={number}
              disabled={others.some(entry => entry.jerseyNumber && entry.jerseyNumber.padStart(2, '0') === number)}>{number}</option>)}
          </select></label></td>
          <td><label><span>Posición defensiva</span><select aria-label={`Posición del ${label}`} disabled={disabled || !playerId} value={row?.fieldPosition ?? ''}
            onChange={event => change({ fieldPosition: event.target.value })}>
            <option value="">Elegir posición</option>
            {positions.map(position => <option key={position} value={position}>{fieldPositionLabels[position]}</option>)}
          </select></label></td>
          <td>{slot === null ? 'Jugador flexible' : <label><span>Rol</span><select aria-label={`Rol del ${label}`} disabled={disabled || !playerId}
            value={row?.lineupRole ?? 'PLAYER'} onChange={event => {
              const role = lineupRoleOptions.find(option => option.value === event.target.value)?.value;
              if (role) change({ lineupRole: role });
            }}>
            {lineupRoleOptions.filter(option => option.value !== 'FLEX').map(option => <option key={option.value} value={option.value}
              disabled={option.value === 'DP' && others.some(entry => entry.lineupRole === 'DP')}>{option.label}</option>)}
          </select></label>}</td>
          <td><button type="button" className="chipSubtle" aria-label={slot === null ? 'Quitar FLEX' : `Vaciar turno ${slot}`}
            disabled={disabled || !row} onClick={() => {
              if (slot === null) {
                onChange(current => current.filter(entry => entry.battingOrder !== null));
                setEditingSlot(undefined);
              } else change({ identificationNumber: '', jerseyNumber: '', fieldPosition: '', lineupRole: 'PLAYER' });
            }}>{slot === null ? 'Quitar' : 'Vaciar'}</button>
            <button type="button" className="chipSubtle" aria-label={`Terminar edición del ${label}`}
              disabled={disabled || !playerId || !jersey || !row?.fieldPosition} onClick={() => {
                setEditingSlot(undefined);
                globalThis.document.getElementById(`button-${editorId}`)?.focus();
              }}>Listo</button>
          </td>
          </tr>
        </Fragment>;
      })}</tbody>
    </table>
    <div className="managerButtonRow">
      <button type="button" className="managerButtonOutline" disabled={disabled || hasFlex}
        onClick={() => onChange(current => changeLineupRow(current, null, {}))}>Añadir jugador flexible (sin bateo)</button>
    </div>
    <p className="baseballHint">Regular · DP: bateador asignado · EH: bateador extra · FLEX: defensa sin bateo. La regla del corredor temporal la configura el organizador.</p>
  </>;
}
