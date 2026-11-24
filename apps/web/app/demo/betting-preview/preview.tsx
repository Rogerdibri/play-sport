'use client';
import { InstitutionName } from '../../institutional-logos';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { PreviewGame } from './game-context';

type Side = 'home' | 'away';
type Offer = { id: number; game: string; side: Side; amount: number; remaining: number; yours: boolean; name: string };
type Agreement = { id: number; game: string; side: Side; amount: number; name: string };
type Market = { offers: Offer[]; agreements: Agreement[]; nextId: number; error: string; notice: string };
const demoGames: readonly PreviewGame[] = [
  { id: 'evening', home: 'Tigres del Valle', away: 'Leones del Norte', status: 'scheduled', label: 'Por comenzar · 7:30 p. m.', homeRuns: 0, awayRuns: 0, detail: 'Softbol · Estadio del Valle' },
  { id: 'live', home: 'Halcones de Caracas', away: 'Bravos del Este', status: 'live', label: 'En vivo · Alta del 6.º', homeRuns: 4, awayRuns: 3, detail: 'Béisbol · Parque del Este' },
  { id: 'finished', home: 'Caribes del Sur', away: 'Águilas del Lago', status: 'finished', label: 'Finalizado', homeRuns: 7, awayRuns: 5, detail: 'Softbol · Parque Central' }
];
const initialMarket = (selectedGame?: PreviewGame): Market => ({
  offers: selectedGame ? [
    { id: 1, game: selectedGame.id, side: 'home', amount: 60, remaining: 40, yours: false, name: 'Fanático Azul' }
  ] : [
    { id: 1, game: 'evening', side: 'home', amount: 60, remaining: 40, yours: false, name: 'Fanático Azul' },
    { id: 2, game: 'live', side: 'away', amount: 40, remaining: 40, yours: false, name: 'Fanática Naranja' }
  ],
  agreements: [], nextId: 3, error: '', notice: ''
});
const reservedCredits = (market: Market) => market.offers.filter(offer => offer.yours).reduce((sum, offer) => sum + offer.amount, 0) +
  market.agreements.reduce((sum, agreement) => sum + agreement.amount, 0);
const validCredits = (amount: number) => Number.isSafeInteger(amount) && amount > 0;

export default function BettingPreview({ selectedGame }: { selectedGame?: PreviewGame }) {
  const panel = useRef<globalThis.HTMLElement>(null);
  const games = selectedGame ? [selectedGame] : demoGames;
  const [market, setMarket] = useState(() => initialMarket(selectedGame));
  const [gameId, setGameId] = useState(selectedGame?.id ?? 'evening');
  const [side, setSide] = useState<Side>('home');
  const [offerAmount, setOfferAmount] = useState('30');
  const [acceptAmount, setAcceptAmount] = useState('10');
  const game = games.find(item => item.id === gameId) ?? games[0];
  const reserved = reservedCredits(market), available = 200 - reserved;
  const offers = market.offers.filter(offer => offer.game === game.id);
  const teamName = (choice: Side) => choice === 'home' ? game.home : game.away;
  const publish = () => setMarket(current => {
    const amount = Number(offerAmount);
    if (!validCredits(amount) || amount > 200 - reservedCredits(current)) {
      return { ...current, error: 'Indica créditos enteros positivos dentro de tu saldo disponible.', notice: '' };
    }
    return { ...current, nextId: current.nextId + 1, error: '', notice: `Oferta publicada: ${amount} CR reservados.`,
      offers: [...current.offers, { id: current.nextId, game: game.id, side, amount, remaining: amount, yours: true, name: 'Tú' }] };
  });
  const accept = (id: number) => setMarket(current => {
    const offer = current.offers.find(item => item.id === id && item.game === game.id && !item.yours);
    const amount = Number(acceptAmount);
    if (!offer || !validCredits(amount) || amount > offer.remaining || amount > 200 - reservedCredits(current)) {
      return { ...current, error: 'El aporte debe ser entero, positivo y no superar la oferta ni tu saldo disponible.', notice: '' };
    }
    return { ...current, nextId: current.nextId + 1, error: '', notice: `Aceptación confirmada por ${amount} CR. El resto de la oferta sigue abierto.`,
      offers: current.offers.map(item => item.id === id ? { ...item, remaining: item.remaining - amount } : item),
      agreements: [...current.agreements, { id: current.nextId, game: game.id, side: offer.side === 'home' ? 'away' : 'home', amount, name: offer.name }] };
  });

  return <main className="moduleView bettingPreview">
    <header className="hero">
      <h1>Tu equipo. Tu apuesta.</h1>
      <p className="heroLead">Así podría verse una apuesta directa entre aficionados, desde la cartelera de cada partido.</p>
    </header>
    <p className="bettingDisclaimer">No mueve dinero real ni conecta con tu cuenta. Los cambios se borran al recargar.</p>
    <p>Estos créditos pertenecen solo a esta maqueta, no son otra billetera ni el saldo de tu cuenta. Conectar apuestas a la <Link href="/wallet">billetera única</Link> queda para la siguiente etapa.</p>
    <section className="bettingWallet" aria-label="Créditos de esta maqueta">
      <div><span>Disponible para probar</span><strong>{available} CR</strong></div>
      <div><span>Reservado en la maqueta</span><strong>{reserved} CR</strong></div>
      <div><span>Valor monetario</span><strong>Ninguno</strong></div>
    </section>
    <div className="bettingFlow">
      <section className="bettingCalendar" aria-label="Cartelera">
        <div className="bettingSectionTitle"><h2>{selectedGame ? '1. Partido elegido en la cartelera' : '1. Elige un partido'}</h2>
          <Link href="/demo/events-map">Volver a la cartelera</Link></div>
        <div className="bettingGames" data-single={!!selectedGame}>
        {games.map(item => <article className="bettingGame" key={item.id} data-selected={game.id === item.id}>
          <p className="bettingGameStatus" data-status={item.status}>{item.label}</p>
          <div className="bettingScore"><span><InstitutionName example={!item.homeTeamId} id={item.homeTeamId}>{item.home}</InstitutionName><strong>{item.status === 'scheduled' ? '—' : item.homeRuns}</strong></span>
            <span><InstitutionName example={!item.awayTeamId} id={item.awayTeamId}>{item.away}</InstitutionName><strong>{item.status === 'scheduled' ? '—' : item.awayRuns}</strong></span></div>
          <p>{item.detail}</p>
          <button className="managerButtonSolid" type="button" disabled={item.status === 'finished'}
            aria-label={`${item.status === 'finished' ? 'Apuestas cerradas' : 'Ver apuestas'}: ${item.home} contra ${item.away}`}
            onClick={() => {
              setGameId(item.id); setSide('home'); setMarket(current => ({ ...current, error: '', notice: '' }));
              panel.current?.focus();
            }}>
            {item.status === 'finished' ? 'Apuestas cerradas · partido finalizado' : item.status === 'live' ? 'Ver apuestas · en vivo' : 'Ver apuestas'}
          </button>
        </article>)}
        </div>
      </section>
      <section className="bettingPanel managerCard" aria-label="Apuestas del partido" ref={panel} tabIndex={-1}>
        <p className="eyebrow">2. ELIGE UNA OFERTA · GANADOR FINAL</p>
        <h2><InstitutionName example={!game.homeTeamId} id={game.homeTeamId}>{game.home}</InstitutionName> vs. <InstitutionName example={!game.awayTeamId} id={game.awayTeamId}>{game.away}</InstitutionName></h2>
        <p>El otro aficionado elige un equipo y tú eliges al rival. Cada uno aporta la misma cantidad de créditos.</p>
        {market.error ? <p className="managerWarning" role="alert">{market.error}</p> : null}
        {market.notice ? <p className="managerStatus success" role="status">{market.notice}</p> : null}
        <h3>Ofertas abiertas</h3>
        {offers.map(offer => <article className="bettingOffer" key={offer.id}>
          <div className="bettingOfferChoice">
          <p className="bettingOfferAuthor">{offer.name}</p>
          <p className="bettingChoiceLabel">{offer.yours ? 'Tu oferta' : 'El otro aficionado elige'}</p>
          <h4>Gana <InstitutionName example={!game.homeTeamId} id={offer.side==='home'?game.homeTeamId:game.awayTeamId}>{teamName(offer.side)}</InstitutionName></h4>
          <p className="bettingOfferRemaining"><strong>{offer.remaining} CR disponibles</strong><span>Oferta inicial: {offer.amount} CR</span></p>
          <p>Puedes aceptar solo una parte; no necesitas cubrir toda la oferta.</p>
          </div>
          {offer.yours ? <p>Tu oferta espera a otro participante. No puedes aceptarla tú mismo.</p> : <div className="bettingAcceptance">
            <p className="bettingChoiceLabel">Tú eliges</p>
            <h4>Gana <InstitutionName example={!game.homeTeamId} id={offer.side==='home'?game.awayTeamId:game.homeTeamId}>{teamName(offer.side === 'home' ? 'away' : 'home')}</InstitutionName></h4>
            <label className="managerField"><span>Aporte para aceptar a {offer.name} (CR)</span>
              <input type="number" min={1} max={Math.min(offer.remaining, available)} step={1} value={acceptAmount}
                onChange={event => setAcceptAmount(event.target.value)} /></label>
            {validCredits(Number(acceptAmount)) && Number(acceptAmount) <= Math.min(offer.remaining, available) ?
              <dl className="bettingCalculation">
                <div><dt>Tu aporte</dt><dd>{Number(acceptAmount)} CR</dd></div>
                <div><dt>Aporte del rival</dt><dd>{Number(acceptAmount)} CR</dd></div>
                <div><dt>Total si ganas</dt><dd>{Number(acceptAmount) * 2} CR</dd></div>
              </dl> : <p>Introduce un aporte válido para ver el ejemplo.</p>}
            <button className="managerButtonSolid" type="button" disabled={offer.remaining === 0 || available === 0} onClick={() => accept(offer.id)}>
              Simular aceptación parcial
            </button>
            <p className="bettingOfferAuthor">El total incluye tu aporte. Solo se reservan créditos.</p>
          </div>}
        </article>)}
        <details className="bettingCreate">
          <summary>Publicar mi propia oferta</summary>
          <fieldset><legend>¿Quién crees que gana?</legend>
            <label><input type="radio" name="winning-team" checked={side === 'home'} onChange={() => setSide('home')} /> <InstitutionName example={!game.homeTeamId} id={game.homeTeamId}>{game.home}</InstitutionName></label>
            <label><input type="radio" name="winning-team" checked={side === 'away'} onChange={() => setSide('away')} /> <InstitutionName example={!game.awayTeamId} id={game.awayTeamId}>{game.away}</InstitutionName></label>
          </fieldset>
          <label className="managerField"><span>Créditos para mi oferta</span>
            <input type="number" min={1} max={available} step={1} value={offerAmount} onChange={event => setOfferAmount(event.target.value)} /></label>
          <p>Este aporte se reserva al publicar. Lo no aceptado se liberaría al cerrar la oferta; no se pierde por quedar sin rival.</p>
          <button type="button" className="managerButtonOutline" disabled={available === 0} onClick={publish}>Simular publicación</button>
        </details>
      </section>
    </div>
      <section className="bettingAgreements managerCard" aria-label="Mis acuerdos">
        <h2>3. Mis acuerdos</h2>
        {market.agreements.filter(item => item.game === game.id).length === 0 ? <p>Todavía no has aceptado una oferta en este partido.</p> :
          market.agreements.filter(item => item.game === game.id).map(item => <article className="bettingAgreement" key={item.id}>
            <h4>Tu elección: <InstitutionName example={!game.homeTeamId} id={item.side==='home'?game.homeTeamId:game.awayTeamId}>{teamName(item.side)}</InstitutionName></h4>
            <p>Con {item.name} · Cada parte: {item.amount} CR · Pendiente del ganador oficial.</p>
            <p><strong>Crédito total si ganas: {item.amount * 2} CR</strong> (incluye tu aporte). Ganancia neta: {item.amount} CR.</p>
            <p>Los créditos ya están reservados: no se restaría tu aporte una segunda vez.</p>
          </article>)}
      </section>
    <footer className="bettingFooter managerCard">
      <h2>Una muestra, no una función financiera habilitada</h2>
      <p>No hay depósitos, retiros ni liquidación de resultados. El acceso real requeriría verificación de identidad, controles de edad y elegibilidad,
        proveedores y autorización aplicable. Las reglas para suspensión, cancelación, protestas o ausencia de ganador oficial siguen pendientes.</p>
      <div className="ctaRow"><button className="managerButtonOutline" type="button" onClick={() => {
        setMarket(initialMarket(selectedGame)); setGameId(selectedGame?.id ?? 'evening'); setSide('home'); setOfferAmount('30'); setAcceptAmount('10');
      }}>Reiniciar</button><Link className="cta managerButtonOutline" href="/demo/events-map">Volver a la cartelera</Link></div>
    </footer>
  </main>;
}
