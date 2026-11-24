import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import LiveScoringManagerDemo from './live-scoring-manager-demo';
import { AccountOfficialInbox as TeamSheetInbox } from './team-sheet-inbox';
import { PublicLiveGames } from './player-game-browser';
import Cartelera from './events-map';
import Standings from './standings';
import FriendlyGames from './friendly-games';
import ManagerGameInbox from './manager-game-inbox';
import ManagerRoster from './manager-roster';
import OrganizerRosterRules from './organizer-roster-rules';
import TournamentWorkspace from './tournaments';
import Marketplace from './marketplace';
import { demoModules, legacyDemoSession, moduleStatusLabels } from '../../platform-navigation';
import { DemoProfileRoute } from '../../platform-session';

export default async function ModuleDemoPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string; game?: string; official?: string; entry?: string; tournament?: string }>;
}) {
  const { slug } = await params;
  if (slug === 'player-career') redirect('/sports-sheet');
  if (slug === 'news') redirect('/demo/events-map');
  if (slug === 'team-hq') redirect('/demo/roster');
  const { view, game, official, entry, tournament } = await searchParams;
  const module = demoModules.find((item) => item.slug === slug);
  if (!module) notFound();
  const isLiveScoring = slug === 'live-scoring';
  if (isLiveScoring && view === 'private-example') redirect('/demo/live-scoring?view=scorekeeper');
  return <DemoProfileRoute profile={isLiveScoring ? legacyDemoSession(view) : null}>
    <main className={`moduleView${isLiveScoring ? ' liveScoringPage' : ''}`}>
      {isLiveScoring ? (
        view === 'public' ? <section className="managerWorkspace">
          <PublicLiveGames gameId={game} />
        </section> : view === 'organizer' || view === 'scorekeeper' ?
          <TeamSheetInbox key={`${view}:${entry}`} view={view} liveEntry={entry === 'live'} /> : <LiveScoringManagerDemo rival={view === 'rival'} />
      ) : slug === 'tournaments' ? <TournamentWorkspace publicId={tournament} /> : slug === 'marketplace' ? <Marketplace /> : slug === 'organizer-center' ? <OrganizerRosterRules /> : slug === 'roster' ? <ManagerRoster /> : slug === 'manager-games' ? <ManagerGameInbox /> : slug === 'friendly-games' ? <FriendlyGames /> : slug === 'events-map' ? <Cartelera gameId={game} officialGameId={official} /> : slug === 'standings' ? <Standings /> : <>
        <header className="moduleHeader">
          <p className="eyebrow">MÓDULO DE LA PLATAFORMA</p>
          <h1>{module.title}</h1>
          <p>{module.summary}</p>
        </header>
        <section className="managerCard managerStepCard">
          <h2>{moduleStatusLabels[module.status]}</h2>
          <p>Esta pantalla conserva el alcance del módulo. No hay operaciones activas para las funciones pendientes; no se muestran botones que simulen guardar o publicar.</p>
          {module.actions.length ? <><h3>Funciones pendientes</h3><ul>{module.actions.map((action) => <li key={action}>{action}</li>)}</ul></> : null}
        </section>
      </>}
      <div className="backRow"><Link href="/" className="cta secondary">Volver a mi inicio</Link></div>
    </main>
  </DemoProfileRoute>;
}
