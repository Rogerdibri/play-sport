import type { CalendarGame, CalendarVenue } from './events-calendar.js';

export type CalendarExampleGame = CalendarGame & { tournament: string };

export const calendarExampleVenues: readonly CalendarVenue[] = [
  { id: 'universitario', name: 'Estadio Universitario de Caracas', stateId: 'VE-A', municipalityId: 'VE-A:libertador',
    address: 'Ciudad Universitaria de Caracas, parroquia San Pedro, municipio Libertador, Distrito Capital, Venezuela.',
    latitude: 10.489481, longitude: -66.884006, source: 'https://es.wikipedia.org/wiki/Estadio_Universitario_(UCV)' },
  { id: 'perez-colmenares', name: 'Estadio José Pérez Colmenares', stateId: 'VE-D', municipalityId: 'VE-D:girardot',
    address: 'Avenida David Concepción, Maracay, municipio Girardot, Aragua, Venezuela.',
    latitude: 10.26047, longitude: -67.611626, source: 'https://es.wikipedia.org/wiki/Estadio_Jos%C3%A9_P%C3%A9rez_Colmenares' },
  { id: 'luis-aparicio', name: 'Estadio Luis Aparicio El Grande', stateId: 'VE-V', municipalityId: 'VE-V:maracaibo',
    address: 'Terrenos de la Universidad del Zulia, Maracaibo, municipio Maracaibo, Zulia, Venezuela.',
    latitude: 10.672944, longitude: -71.648125, source: 'https://es.wikipedia.org/wiki/Estadio_Luis_Aparicio_El_Grande' },
  { id: 'bernardo-perez', name: 'Estadio José Bernardo Pérez', stateId: 'VE-G', municipalityId: 'VE-G:valencia',
    address: 'Vía de Servicio Avenida Michelena, Valencia, municipio Valencia, Carabobo, Venezuela.',
    latitude: 10.175583, longitude: -67.979863, source: 'https://mapcarta.com/es/W510866094' }
];

export const calendarExampleGames: readonly CalendarExampleGame[] = [
  { id: 'ejemplo-caracas-1', date: '2026-11-04', time: '10:00', venueId: 'universitario',
    tournament: 'Copa Metropolitana 2026', awayTeam: 'Halcones Urbanos', homeTeam: 'Cóndores del Ávila', sport: 'baseball', status: 'finished', score: { away: 2, home: 5, innings: 9 } },
  { id: 'ejemplo-caracas-2', date: '2026-11-04', time: '16:00', venueId: 'universitario',
    tournament: 'Copa Metropolitana de Softbol 2026', awayTeam: 'Estrellas del Este', homeTeam: 'Diamantes de Caracas', sport: 'softball', status: 'finished', score: { away: 3, home: 1, innings: 7 } },
  { id: 'ejemplo-maracay-1', date: '2026-11-04', time: '18:00', venueId: 'perez-colmenares',
    tournament: 'Copa del Centro 2026', awayTeam: 'Guerreros del Centro', homeTeam: 'Toros de Maracay', sport: 'baseball', status: 'scheduled', score: null },
  { id: 'ejemplo-maracaibo-1', date: '2026-11-04', time: '20:00', venueId: 'luis-aparicio',
    tournament: 'Copa del Lago 2026', awayTeam: 'Relámpagos del Sur', homeTeam: 'Guardianes del Lago', sport: 'baseball', status: 'live', score: { away: 2, home: 3, innings: 6 } },
  { id: 'ejemplo-valencia-1', date: '2026-11-04', time: '09:00', venueId: 'bernardo-perez',
    tournament: 'Copa Carabobo 2026', awayTeam: 'Centauros del Norte', homeTeam: 'Naranjeros de Valencia', sport: 'baseball', status: 'finished', score: { away: 4, home: 7, innings: 9 } },
  { id: 'ejemplo-ayer', date: '2026-11-03', time: '18:00', venueId: 'universitario',
    tournament: 'Copa Metropolitana 2026', awayTeam: 'Halcones Urbanos', homeTeam: 'Cóndores del Ávila', sport: 'baseball', status: 'finished', score: { away: 2, home: 6, innings: 9 } },
  { id: 'ejemplo-historico-1952', date: '1952-02-29', time: '14:00', venueId: 'universitario',
    tournament: 'Copa de Caracas 1952', awayTeam: 'Pioneros del Valle', homeTeam: 'Diamantes de Caracas', sport: 'baseball', status: 'finished', score: { away: 1, home: 3, innings: 9 } },
  { id: 'ejemplo-historico-2000', date: '2000-02-29', time: '11:00', venueId: 'universitario',
    tournament: 'Copa de Caracas 2000', awayTeam: 'Cóndores del Ávila', homeTeam: 'Halcones Urbanos', sport: 'baseball', status: 'finished', score: { away: 4, home: 4, innings: 9 } },
  { id: 'ejemplo-historico-maracay', date: '1990-06-15', time: '17:00', venueId: 'perez-colmenares',
    tournament: 'Copa del Centro 1990', awayTeam: 'Guerreros del Centro', homeTeam: 'Toros de Maracay', sport: 'baseball', status: 'finished', score: { away: 5, home: 2, innings: 9 } },
  { id: 'ejemplo-historico-maracaibo', date: '1980-03-12', time: '17:00', venueId: 'luis-aparicio',
    tournament: 'Copa del Lago 1980', awayTeam: 'Relámpagos del Sur', homeTeam: 'Guardianes del Lago', sport: 'baseball', status: 'finished', score: { away: 3, home: 5, innings: 9 } },
  { id: 'ejemplo-historico-valencia', date: '2020-02-29', time: '15:00', venueId: 'bernardo-perez',
    tournament: 'Copa Carabobo 2020', awayTeam: 'Centauros del Norte', homeTeam: 'Naranjeros de Valencia', sport: 'baseball', status: 'finished', score: { away: 7, home: 10, innings: 9 } },
  { id: 'ejemplo-caracas-finalizado-5', date: '2026-11-05', time: '09:00', venueId: 'universitario',
    tournament: 'Copa Metropolitana 2026', awayTeam: 'Halcones Urbanos', homeTeam: 'Cóndores del Ávila', sport: 'baseball', status: 'finished', score: { away: 4, home: 7, innings: 9 } },
  { id: 'ejemplo-caracas-en-juego-5', date: '2026-11-05', time: '10:00', venueId: 'universitario',
    tournament: 'Copa Metropolitana 2026', awayTeam: 'Pioneros del Valle', homeTeam: 'Diamantes de Caracas', sport: 'baseball', status: 'finished', score: { away: 1, home: 3, innings: 9 } },
  { id: 'ejemplo-manana', date: '2026-11-05', time: '16:00', venueId: 'universitario',
    tournament: 'Copa Metropolitana de Softbol 2026', awayTeam: 'Estrellas del Este', homeTeam: 'Diamantes de Caracas', sport: 'softball', status: 'scheduled', score: null },
  { id: 'ejemplo-manana-maracay', date: '2026-11-05', time: '18:00', venueId: 'perez-colmenares',
    tournament: 'Copa del Centro 2026', awayTeam: 'Guerreros del Centro', homeTeam: 'Toros de Maracay', sport: 'baseball', status: 'scheduled', score: null },
  { id: 'ejemplo-cancelado', date: '2026-11-03', time: '14:00', venueId: 'perez-colmenares',
    tournament: 'Copa del Centro 2026', awayTeam: 'Guerreros del Centro', homeTeam: 'Toros de Maracay', sport: 'baseball', status: 'cancelled', score: null }
];
