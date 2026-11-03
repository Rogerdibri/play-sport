# live-scoring

Modulo de anotacion oficial colaborativa para PlaySport.

## Reglas implementadas

- El organizador define anotadores autorizados del torneo.
- El organizador puede limitar aun mas los anotadores para un juego especifico.
- Solo `organizer` y `scorekeeper` autorizados pueden publicar anotaciones oficiales.
- `manager` no publica resultados oficiales (solo seguimiento privado en frontend).
- Todo jugador se registra una sola vez a nivel global con cédula (`identificationNumber`) y nombre.
- Si el jugador es menor de edad, puede usar cédula de padre/representante.
- En toda la app/ecosistema no se permite repetir cédula.
- El roster oficial de cada equipo usa cédulas del registro global de jugadores.
- El mismo numero de cédula no puede estar en dos rosters distintos del mismo torneo.
- Un jugador si puede estar en equipos distintos cuando son torneos diferentes.
- Un manager puede dirigir varios equipos en torneos distintos, pero no dos equipos dentro del mismo torneo.
- El lineup de juego del manager debe ser subconjunto del roster oficial del equipo (por cédula).
- El lineup soporta `lineupEntries` con `battingOrder` y `fieldPosition` (P, C, 1B, 2B, 3B, SS, LF, CF, RF, DH).
- Version gratuita: solo se exponen nombre y cédula.
- Version paga: se pueden exponer datos adicionales de perfil del jugador.
- Cada turno oficial al bate avanza automaticamente al siguiente bateador del lineup.
- La anotacion oficial soporta eventos jugada a jugada (pitch y jugada), y desde esos eventos se actualizan pizarra, bases y estadisticas por jugador.
- El resultado oficial se sincroniza en tiempo real por stream SSE.

## Endpoints principales

- `POST /api/official-scoring/tournaments/:tournamentId/authorization`
	- Configura autorizacion a nivel torneo y opcionalmente `subscriptionTier` (`free` o `paid`).
- `POST /api/official-scoring/tournaments/:tournamentId/subscription`
	- Cambia el plan del torneo (`free`/`paid`) por el organizador.
- `POST /api/official-scoring/players`
	- Registra jugador global por única vez con cédula y nombre.
	- Soporta menor de edad con `representativeIdentificationNumber`.
- `GET /api/official-scoring/players?visibility=free|paid&tournamentId=...`
	- Lista jugadores del registro global.
	- `visibility=paid` requiere contexto de torneo con plan `paid`.
- `POST /api/official-scoring/tournaments/:tournamentId/players`
	- Compatibilidad: registra jugador en el registro global validando organizador del torneo.
- `GET /api/official-scoring/tournaments/:tournamentId/players?visibility=free|paid`
	- Lista jugadores del registro global bajo visibilidad del plan del torneo.
- `POST /api/official-scoring/tournaments/:tournamentId/teams/:teamId/roster`
	- Registra/actualiza roster por cédulas del registro global.
	- Lo puede editar el manager del equipo (o el organizador como override).
- `GET /api/official-scoring/tournaments/:tournamentId/teams/rosters?visibility=free|paid`
	- Lista rosters oficiales del torneo con datos segun plan/visibilidad.
- `GET /api/official-scoring/tournaments/:tournamentId/teams/:teamId/roster?visibility=free|paid`
	- Devuelve roster oficial de un equipo puntual para flujo de contexto manager.
- `POST /api/official-scoring/games/:gameId/authorization`
	- Configura autorizacion de anotadores para un juego puntual.
- `POST /api/official-scoring/games/:gameId/teams`
	- Define home/away del juego, validando que ambos equipos tengan roster oficial.
- `POST /api/official-scoring/games/:gameId/lineups`
	- Registra lineup por cédulas (validado contra roster oficial).
	- Permite enviar `lineupEntries` para posicion de bateo y posicion de juego.
- `GET /api/official-scoring/games/:gameId/lineups?tournamentId=...&visibility=free|paid`
	- Devuelve estado de lineups y bateadores actuales/siguientes con proyeccion de jugadores.
- `GET /api/official-scoring/games/:gameId/permissions?tournamentId=...&userId=...&role=...`
	- Retorna permisos efectivos por perfil.
- `POST /api/official-scoring/games/:gameId/official-updates`
	- Publica anotacion/modificacion oficial del juego.
	- Soporta `plateAppearance` para turno oficial al bate con avance automatico de orden.
	- Soporta `playEvent` para registro detallado jugada a jugada (strike, bola, hit, doble, triple, home_run, out, error, robo, etc).
	- Tambien acepta terminos en espanol simple para ligas comunitarias: `bola`, `sencillo`, `jonron`, `out_rolling`, `robo_base`, `error`, `doble_play`, `pickoff`, `balk`.
- `GET /api/official-scoring/games/:gameId/state?tournamentId=...`
	- Estado oficial actual del juego, proyeccion de lineup y snapshot de play-by-play.
- `GET /api/official-scoring/games/:gameId/play-by-play?tournamentId=...&visibility=free|paid`
	- Devuelve bases actuales, bitacora de eventos y estadisticas acumuladas por bateador, pitcher y fildeo.
- `GET /api/official-scoring/games/:gameId/stream?tournamentId=...`
	- Stream SSE para sincronizacion inmediata entre perfiles (snapshot + actualizaciones con play-by-play).

## Ejemplo minimo de flujo

1. Organizador autoriza anotadores del torneo.
2. Jugador se registra una sola vez en el registro global con cédula (y representante si es menor).
3. Manager configura roster por cédula para su equipo usando el registro global.
4. Organizador define equipos del juego (home/away).
5. Manager registra lineup oficial del juego por cédula (solo del roster del equipo).
6. Organizador autoriza anotadores del juego en curso.
7. Anotador u organizador publica cambios oficiales.
8. En cada `plateAppearance`, el backend avanza automaticamente al siguiente bateador.
9. Todos los clientes suscritos al stream del juego reciben el cambio inmediato.
