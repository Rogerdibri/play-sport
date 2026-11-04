'use client';

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { privateInningSummary, type PrivateLog } from './private-scorecard';

const pitchLabels = { ball: 'Bola', strike: 'Strike', foul: 'Falta' } as const;

export default function PrivateInningCell({ entries, playerId, playerName, inning }: {
  entries: PrivateLog[];
  playerId: string;
  playerName: string;
  inning: number;
}) {
  const [held, setHeld] = useState(false);
  const detailId = useId();
  const summary = privateInningSummary(entries, playerId);
  const release = () => setHeld(false);

  useEffect(() => {
    if (!held) return;
    const stop = () => setHeld(false);
    globalThis.addEventListener('pointerup', stop);
    globalThis.addEventListener('pointercancel', stop);
    globalThis.addEventListener('blur', stop);
    globalThis.document.addEventListener('visibilitychange', stop);
    return () => {
      globalThis.removeEventListener('pointerup', stop);
      globalThis.removeEventListener('pointercancel', stop);
      globalThis.removeEventListener('blur', stop);
      globalThis.document.removeEventListener('visibilitychange', stop);
    };
  }, [held]);

  if (!entries.length) return null;
  return <>
    <button type="button" className="privateInningSummary"
      aria-label={`${playerName}, entrada ${inning}: ${summary.length ? summary.map((item) => item.label).join(' · ') : 'Sin resultado todavía'}. Mantén pulsado para ver el detalle.`}
      aria-describedby={held ? detailId : undefined}
      onPointerDown={(event) => {
        if (event.isPrimary && event.button === 0) setHeld(true);
      }}
      onPointerMove={(event) => {
        if (!held) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) release();
      }}
      onPointerUp={release} onPointerCancel={release} onPointerLeave={release} onBlur={release}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          setHeld(true);
        } else if (event.key === 'Escape') release();
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          release();
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >{summary.length ? summary.map((item) => item.code).join(' · ') : '...'}</button>
    {held ? createPortal(<div id={detailId} className="privateInningDetail" role="tooltip">
      <strong>{playerName} · Entrada {inning}</strong>
      <ol>{entries.map((entry, index) => <li key={index}>{[
        entry.pitch && entry.result ? pitchLabels[entry.pitch] : '',
        entry.text,
        entry.runs.includes(playerId) ? 'Carrera anotada' : '',
        entry.stolenBy === playerId && entry.runnerId !== playerId ? 'Base robada' : ''
      ].filter(Boolean).join(' · ')}</li>)}</ol>
    </div>, globalThis.document.body) : null}
  </>;
}
