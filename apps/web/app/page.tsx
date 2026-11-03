import Link from 'next/link';

const modules = [
  {
    slug: 'events-map',
    title: 'Cartelera y Mapa',
    description: 'Descubre partidos cercanos por fecha, ciudad y disciplina en una sola vista.'
  },
  {
    slug: 'live-scoring',
    title: 'Anotacion en Vivo',
    description: 'Controla outs, conteo, bases y jugadas con actualizacion instantanea.'
  },
  {
    slug: 'standings',
    title: 'Posiciones y Honores',
    description: 'Tablas automaticas, lideres ofensivos/pitcheo y MVP por torneo.'
  },
  {
    slug: 'news',
    title: 'Tribuna y Prensa',
    description: 'Cronicas, reseñas de sedes y conversacion moderada por partido.'
  },
  {
    slug: 'scouting-watchlists',
    title: 'Scouting y Talento',
    description: 'Filtros avanzados para casas de talento y watchlists privadas.'
  },
  {
    slug: 'marketplace',
    title: 'Marketplace',
    description: 'Venta oficial, venta garaje C2C y comercios deportivos locales.'
  }
];

export default function HomePage() {
  return (
    <main className="landing">
      <section className="hero">
        <p className="eyebrow">VENEZUELA · COMUNIDAD · COMPETENCIA</p>
        <h1>PlaySport</h1>
        <p className="heroLead">
          Ecosistema deportivo integral para ligas, equipos, jugadores, fanaticos y scouts.
        </p>
        <div className="ctaRow">
          <Link className="cta primary" href="/demo/live-scoring">
            Probar marcador en vivo
          </Link>
          <Link className="cta secondary" href="/demo/events-map">
            Ver cartelera local
          </Link>
        </div>
      </section>

      <section className="moduleGrid" aria-label="Modulos principales de PlaySport">
        {modules.map((module) => (
          <article key={module.slug} className="moduleCard">
            <h2>{module.title}</h2>
            <p>{module.description}</p>
            <Link className="moduleLink" href={`/demo/${module.slug}`}>
              Abrir modulo
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
