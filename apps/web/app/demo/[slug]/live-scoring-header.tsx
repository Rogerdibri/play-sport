import type { ReactNode } from 'react';

export default function LiveScoringHeader({ children, tools }: { children?: ReactNode; tools?: ReactNode }) {
  return <header className="moduleHeader liveScoringHeader">
    <div className="liveScoringHeaderRow">
      <h1>PIZARRA EN VIVO</h1>
      {children ? <div className="liveScoringHeaderActions" role="group" aria-label="Alineaciones del partido">
        {children}
      </div> : null}
    </div>
    {tools ? <div className="liveScoringTools" role="group" aria-label="Controles de la pizarra">{tools}</div> : null}
  </header>;
}
