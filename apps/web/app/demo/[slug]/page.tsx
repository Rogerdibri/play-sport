import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import LiveScoringManagerDemo from './live-scoring-manager-demo';
import TeamSheetInbox from './team-sheet-inbox';

type ModuleView = {
  title: string;
  summary: string;
  actions: string[];
};

const moduleViews: Record<string, ModuleView> = {
  'events-map': {
    title: 'Cartelera y Mapa Interactivo',
    summary: 'Visualiza juegos por fecha y ubicacion para llenar fines de semana y fechas bye.',
    actions: ['Cambiar ciudad', 'Filtrar por disciplina', 'Sugerir evento para validacion']
  },
  'live-scoring': {
    title: 'PIZARRA EN VIVO',
    summary: '',
    actions: ['Registrar turno al bate', 'Actualizar pizarra', 'Cerrar juego y publicar estadisticas']
  },
  standings: {
    title: 'Posiciones y Cuadros de Honor',
    summary: 'Clasificacion automatica y lideres por bateo/pitcheo al finalizar cada partido.',
    actions: ['Ver tabla general', 'Ver MVP del torneo', 'Compartir resultado']
  },
  news: {
    title: 'Tribuna, Prensa y Comunidad',
    summary: 'Cronicas, entrevistas y comentarios con moderacion en la ficha de cada juego.',
    actions: ['Leer cronica', 'Publicar comentario', 'Reportar contenido']
  },
  'scouting-watchlists': {
    title: 'Scouting y Watchlists',
    summary: 'Busqueda por edad, rendimiento y zona para seguimiento privado de atletas.',
    actions: ['Buscar jugador', 'Guardar en watchlist', 'Ver highlights en YouTube']
  },
  marketplace: {
    title: 'Marketplace Deportivo',
    summary: 'Comercio oficial, venta entre usuarios y patrocinio de tiendas locales.',
    actions: ['Publicar articulo', 'Negociar compra', 'Aplicar descuento de aliado']
  }
};

export default async function ModuleDemoPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const { view } = await searchParams;
  const moduleView = moduleViews[slug];
  const isLiveScoring = slug === 'live-scoring';
  if (isLiveScoring && view === 'private-example') redirect('/demo/live-scoring?view=scorekeeper');

  if (!moduleView) {
    notFound();
  }

  return (
    <main className="moduleView">
      {!isLiveScoring ? <header className="moduleHeader">
        <p className="eyebrow">DEMO INTERACTIVA</p>
        <h1>{moduleView.title}</h1>
        <p>{moduleView.summary}</p>
      </header> : null}

      {isLiveScoring ? (
        view === 'organizer' || view === 'scorekeeper' ?
          <TeamSheetInbox view={view} /> : <LiveScoringManagerDemo rival={view === 'rival'} />
      ) : (
        <section className="actionsPanel" aria-label="Acciones del modulo">
          {moduleView.actions.map((action) => (
            <button key={action} type="button" className="actionButton">
              {action}
            </button>
          ))}
        </section>
      )}

      <div className="backRow">
        <Link href="/" className="cta secondary">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
