'use client';

import { useEffect, useState } from 'react';
import { formatGameClock, gameClockElapsed, type GameClock, type GameClockAction } from '@playsport/shared';

export default function GameClockDisplay({ clock, finished, disabled, onAction, offsetMs = 0, privateClock = false }: {
  clock?: GameClock; finished: boolean; disabled: boolean; offsetMs?: number; privateClock?: boolean;
  onAction?: (_action: GameClockAction) => void; // eslint-disable-line no-unused-vars
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now() + offsetMs);
    update();
    const timer = clock?.runningSince ? setInterval(update, 1000) : undefined;
    globalThis.document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); globalThis.document.removeEventListener('visibilitychange', update); };
  }, [clock, offsetMs]);
  const action = !clock ? 'start' : clock.runningSince ? 'pause' : 'resume';
  return <div className="gameClock" aria-label={privateClock ? 'Tiempo del seguimiento privado' : 'Tiempo de juego'}>
    <span className="gameClockLabel">{privateClock ? 'Tiempo privado' : 'Tiempo de juego'}</span>
    <span className="gameClockValue" role="timer" aria-live="off">
      {clock || !finished ? formatGameClock(gameClockElapsed(clock, now ?? Date.parse(clock?.runningSince ?? clock?.startedAt ?? '1970-01-01T00:00:00.000Z'))) : '—'}
    </span>
    {!finished && onAction ? <button type="button" className="gameClockButton" disabled={disabled}
      onClick={() => onAction(action)}>{action === 'start' ? 'INICIAR TIEMPO' : action === 'pause' ? 'Pausar tiempo' : 'Reanudar tiempo'}</button> :
      <span className="gameClockStatus">{!clock ? 'Sin iniciar' : finished ? 'Finalizado' : clock.runningSince ? 'En curso' : 'Pausado'}</span>}
  </div>;
}
