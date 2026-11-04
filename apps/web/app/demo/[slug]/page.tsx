import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import LiveScoringManagerDemo from './live-scoring-manager-demo';
import TeamSheetInbox from './team-sheet-inbox';
import OfficialRunScoring from './official-run-scoring';
import { demoModules, legacyDemoSession, moduleStatusLabels } from '../../platform-navigation';
import { DemoProfileRoute } from '../../platform-session';

export default async function ModuleDemoPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const { view } = await searchParams;
  const module = demoModules.find((item) => item.slug === slug);
  if (!module) notFound();
  const isLiveScoring = slug === 'live-scoring';
  if (isLiveScoring && view === 'private-example') redirect('/demo/live-scoring?view=scorekeeper');
  return <DemoProfileRoute profile={isLiveScoring ? legacyDemoSession(view) : null}>
    <main className="moduleView">
      {isLiveScoring ? (
        view === 'public' ? <section className="managerWorkspace">
          <OfficialRunScoring publicView apiBase={process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? 'http://localhost:4000/api/official-scoring'} />
        </section> : view === 'organizer' || view === 'scorekeeper' ?
          <TeamSheetInbox view={view} /> : <LiveScoringManagerDemo rival={view === 'rival'} />
      ) : <>
        <header className="moduleHeader">
          <p className="eyebrow">MÓDULO DE LA PLATAFORMA</p>
          <h1>{module.title}</h1>
          <p>{module.summary}</p>
        </header>
        <section className="managerCard managerStepCard">
          <h2>{moduleStatusLabels[module.status]}</h2>
          {module.id === 'team-hq' ? <p>La preparación del lineup ya está integrada en el partido asignado. Ábrela desde el inicio con el perfil Manager y el equipo que corresponda.</p> :
            <p>Esta pantalla conserva el alcance del módulo. No hay operaciones activas para las funciones pendientes; no se muestran botones que simulen guardar o publicar.</p>}
          {module.actions.length ? <><h3>Funciones pendientes</h3><ul>{module.actions.map((action) => <li key={action}>{action}</li>)}</ul></> : null}
          {module.id === 'organizer-center' ? <Link className="moduleLink" href="/demo/live-scoring?view=organizer">Abrir la herramienta oficial ya disponible</Link> : null}
        </section>
      </>}
      <div className="backRow"><Link href="/" className="cta secondary">Volver a mi inicio</Link></div>
    </main>
  </DemoProfileRoute>;
}
