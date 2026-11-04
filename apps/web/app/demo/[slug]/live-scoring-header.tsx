import type { ReactNode } from 'react';

export default function LiveScoringHeader({ children }: { children?: ReactNode }) {
  return <header className="moduleHeader liveScoringHeader">
    <p className="eyebrow">DEMO INTERACTIVA</p>
    <div className="liveScoringHeaderRow">
      <h1>PIZARRA EN VIVO</h1>
      {children ? <div className="liveScoringHeaderActions" role="group" aria-label="Alineaciones del partido">
        {children}
      </div> : null}
    </div>
  </header>;
}
