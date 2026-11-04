# live-scoring

Modulo de anotacion oficial colaborativa para PlaySport.

## Reglas implementadas

- El organizador define anotadores autorizados del torneo.
- El organizador puede limitar aun mas los anotadores para un juego especifico.
- Solo `organizer` y `scorekeeper` autorizados pueden publicar anotaciones oficiales.
- `manager` entrega el lineup y consulta el registro oficial en vivo; no tiene anotación privada ni escritura oficial.
- Todo jugador se registra una sola vez a nivel global con cédula (`identificationNumber`) y nombre.
- Si el jugador es menor de edad, puede usar cédula de padre/representante.
- En toda la app/ecosistema no se permite repetir cédula.
- El roster oficial de cada equipo usa cédulas del registro global de jugadores y solo lo aprueba/modifica el organizador, enviando su `organizerId`.
- El mismo numero de cédula no puede estar en dos rosters distintos del mismo torneo.
- Un jugador si puede estar en equipos distintos cuando son torneos diferentes.
- Un manager puede dirigir varios equipos en torneos distintos, pero no dos equipos dentro del mismo torneo.
- El lineup de juego del manager debe ser subconjunto del roster oficial del equipo (por cédula).
- El lineup permite de 9 a 13 bateadores y un FLEX defensivo adicional; incluye las posiciones P, C, 1B, 2B, 3B, SS, LF, CF, RF, OF4, SF y DH.
- Una posición no puede repetirse en la alineación ni tras una sustitución. Los intercambios defensivos conservan esa unicidad. `NA` no ocupa una posición y puede aparecer en varios bateadores extras. El API rechaza el envío completo sin publicar cambios parciales si detecta posiciones repetidas.
- `lineupRole` distingue jugador regular, DP (bateador asignado), FLEX (defensa sin turno) y EH (bateador extra, que puede tener una posición defensiva o `NA`). DP y FLEX se registran como pareja; FLEX no ocupa turno de bateo.
- Cada entrada del lineup puede incluir un numero de camiseta de 0 a 99, especifico para ese juego; el numero no se guarda en el perfil global del jugador.
- El organizador configura la regla del corredor temporal del torneo: solo un jugador fuera del lineup (`BENCH`) o cualquiera del roster (`ROSTER`). El evento `corredor_temporal` reemplaza en base al pitcher o receptor sin alterar su puesto de bateo.
- Version gratuita: solo se exponen nombre y cédula.
- Version paga: se pueden exponer datos adicionales de perfil del jugador.
- Cada turno oficial al bate avanza automaticamente al siguiente bateador del lineup.
- La anotacion oficial soporta eventos jugada a jugada (pitch y jugada), y desde esos eventos se actualizan pizarra, bases y estadisticas por jugador.
- La bitacora del juego conserva el inning de cada evento y expone cada turno al bate completado y cada error defensivo, para consultar la hoja de juego por jugador durante el partido.
- El promedio de bateo (AVG) de la hoja se calcula como hits divididos entre turnos oficiales (AB); se muestra como `—` si el jugador aún no tiene AB.
- El resultado oficial se sincroniza en tiempo real por stream SSE.

## Endpoints principales

- `POST /api/official-scoring/tournaments/:tournamentId/authorization`
	- Configura autorizacion a nivel torneo y opcionalmente `subscriptionTier` (`free` o `paid`).
- `POST /api/official-scoring/tournaments/:tournamentId/rules`
	- Solo el organizador registrado puede configurar `courtesyRunnerSource` (`BENCH` o `ROSTER`) enviando su `organizerId`.
	- Aplica a todos los juegos del torneo, incluidos los lineups existentes. Por defecto: `BENCH`.
	- En móvil se configura desde el panel oficial del perfil organizador.
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
	- Requiere el `organizerId` del organizador del torneo; el manager no puede editarlo. No permite retirar a un jugador de una alineación activa entregada.
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
	- Permite enviar `lineupEntries` con orden de bateo, rol, posición defensiva y número de camiseta del partido. No permite configurar `courtesyRunnerSource`: devuelve 403 si el manager intenta enviarla.
	- Incluye `presentSubstituteIdentificationNumbers` (solo inscritos fuera de la alineación) y `presentOfficials` con `role` (`DIRIGENTE`, `MANAGER`, `DELEGADO`), `identificationNumber` y `displayName`. Coach de primera y tercera no se aceptan. Omitir estas listas declara cero presentes adicionales, no toda la plantilla.
	- Crea una entrega para organizador, anotadores autorizados y dirigente contrario. Repetir exactamente la entrega inicial es idempotente y no reinicia bateadores; modificarla devuelve 409 y exige una solicitud de movimiento.
- `GET /api/official-scoring/games/:gameId/team-sheets?tournamentId=...&userId=...&role=...`
	- Solo dirigentes participantes y oficiales autorizados. Devuelve entregas, suplentes y directivos presentes, destinatarios y solicitudes con su estado. No incluye jugadas privadas ni perfiles pagos.
- `GET /api/official-scoring/games/:gameId/team-sheets/stream?tournamentId=...&userId=...&role=...`
	- SSE restringido a esos mismos receptores. Entrega un snapshot inicial y una versión creciente por cada envío, solicitud o decisión; vuelve a validar acceso al emitir.
- `POST /api/official-scoring/games/:gameId/team-sheets/:teamId/requests`
	- Compatibilidad para solicitudes anteriores. El flujo actual no exige que el manager use este endpoint.
	- El dirigente envía `tournamentId`, `managerId`, `expectedRevision` y `action`.
	- Acciones: `arrival` (cédula), `substitution` (saliente, entrante, posición y camiseta), `defense` (cédula y posición), `courtesy` (base, saliente y entrante), `staff-arrival` (directivo) y `staff-departure` (cédula y cargo). Los campos exactos están en el contrato compartido `PersonnelAction`.
	- Solo comunica una solicitud pendiente. Una llegada tardía requiere inscripción previa y se incorpora como suplente; no permite anexar turnos al bate.
- `POST /api/official-scoring/games/:gameId/personnel-requests/:requestId/decision`
	- Anotador u organizador autorizado: `tournamentId`, `actorId`, `actorRole`, `expectedRevision`, `decision` (`approve`/`reject`) y `note` (obligatoria al rechazar).
	- Revalida el movimiento con el roster y la regla actuales; una revisión desactualizada devuelve 409. Confirmar conserva el puesto de bateo y actualiza la alineación sin reiniciar cuenta, bases, marcador ni estadísticas. Los cambios defensivos intercambian posiciones ocupadas. Los casos reglamentarios especiales y reingresos deben verificarse al confirmar.
	- No se permite modificar personal en juegos finalizados. Los directivos declarados no adquieren permisos de cuenta. El esquema actual recibe identidades por parámetros y debe integrarse con autenticación real antes de producción.
- `POST /api/official-scoring/games/:gameId/team-sheets/:teamId/official-changes`
	- El anotador u organizador registra directamente un `PersonnelAction` comunicado en el campo, sin una solicitud digital previa.
	- Requiere `tournamentId`, `actorId`, `actorRole`, `expectedRevision` y `expectedOfficialVersion`. Revalida roster, presencia, posiciones y bases reales; un conflicto devuelve 409 sin aplicar el movimiento.
	- Publica la alineación vigente por ambos streams y conserva la entrega inicial y la autoría del oficial.
- `POST /api/official-scoring/games/:gameId/official-updates`
	- La herramienta compacta envía `scorecardCommand` y `expectedOfficialVersion`. Reutiliza el motor compartido de picheos, resultados y movimientos con avances mínimos; ambos lineups deben haberse recibido.
	- Operaciones separadas: `undoLast: true`, `regulationInnings: 7|9`, `lastErrorOuts: 0|1|2|3|null`. El detalle del último error actualiza la misma jugada sin duplicar turno, carreras ni estadísticas.
	- Deshacer restaura bases, cuenta, estadísticas y responsabilidad de carreras y publica una versión nueva. No cruza un movimiento de personal confirmado. `finish` requiere confirmación del oficial y puede deshacerse.
	- El snapshot incluye `playByPlay.scorecard` (estado y registro completo para las planillas), `canUndo` y `lastScorecardCommand`; no depende del recorte de eventos recientes.
	- Los identificadores y roles son todavía credenciales de demostración, no autenticación de producción. El API conserva estos datos en memoria.
- `POST /api/official-scoring/games/:gameId/teams/:teamId/representative`
	- El dirigente del equipo envía `tournamentId`, `managerId` e `identificationNumber` para autorizar a un integrante de su plantilla como representante físico en el campo.
	- Solo aplica al equipo y partido indicados. No modifica al dirigente ni concede permisos de cuenta o anotación.
	- Rechaza equipos ajenos al juego, cédulas fuera de la plantilla y cambios en juegos finalizados.
	- Si el integrante sale de la plantilla o cambia el dirigente, se revoca la autorización de los juegos no finalizados.
- `GET /api/official-scoring/games/:gameId/teams/:teamId/representative?tournamentId=...`
	- Devuelve `representative` (o `null`) con nombre, cédula, dirigente que autorizó y fecha.
	- La proyección de alineaciones también incluye `fieldRepresentatives`, aunque todavía no se haya enviado una alineación.
- `GET /api/official-scoring/games/:gameId/lineups?tournamentId=...&visibility=free|paid`
	- Devuelve estado de lineups y bateadores actuales/siguientes con proyeccion de jugadores.
- `GET /api/official-scoring/games/:gameId/permissions?tournamentId=...&userId=...&role=...`
	- Retorna permisos efectivos por perfil.
- `POST /api/official-scoring/games/:gameId/official-updates`
	- Publica anotacion/modificacion oficial del juego.
	- Soporta `plateAppearance` para turno oficial al bate con avance automatico de orden.
	- Soporta `playEvent` para registro detallado jugada a jugada (strike, bola, hit, doble, triple, home_run, out, error, robo, corredor temporal, etc).
	- Resuelve el lanzador desde P en la defensa vigente. Una cédula de lanzador explícita que no coincide se rechaza; confirma primero el cambio de personal.
	- `playEvent.errorOuts` (0–3, sin superar los outs restantes) registra oportunidades perdidas por `ERROR`. `ERROR_ADVANCE` permite avanzar un corredor identificado, con `errorOuts` 0 o 1; `RUNNER_ADVANCE` declara un avance sin error. `DROPPED_FOUL` registra una oportunidad de out perdida sin terminar el turno ni cambiar la cuenta. `PASSED_BALL` y `WILD_PITCH` conservan causas distintas.
	- Los clientes antiguos pueden omitir `errorOuts`; no se inventa el dato: la reconstrucción afectada queda pendiente. Los errores que evitaron varios outs requieren revisión cuando faltan los eliminados hipotéticos.
	- Acepta `runReview: { eventId, runnerId, team, pitcher, note }` por separado de `playEvent`/`plateAppearance`. `team` y `pitcher` son `earned` o `unearned`, `note` es obligatoria y `runnerId` puede ser `null` para un ajuste anónimo. La revisión conserva la autorización oficial y se incluye en el evento de auditoría/SSE, sin sumar carreras ni avanzar bateadores.
	- `expectedOfficialVersion` opcional protege contra anotaciones sobre una pizarra desactualizada (409). Las actualizaciones se preparan sobre una copia y solo se publican si la validación completa es exitosa.
	- Tambien acepta terminos en espanol simple para ligas comunitarias: `bola`, `sencillo`, `jonron`, `out_rolling`, `robo_base`, `corredor_temporal`, `error`, `doble_play`, `pickoff`, `balk`.
- `GET /api/official-scoring/games/:gameId/state?tournamentId=...`
	- Estado oficial actual del juego, proyeccion de lineup y snapshot de play-by-play.
- `GET /api/official-scoring/games/:gameId/play-by-play?tournamentId=...&visibility=free|paid`
	- Devuelve bases actuales, bitacora de eventos, turnos al bate completados con inning, errores defensivos con inning y estadisticas acumuladas por bateador, pitcher y fildeo.
	- `runAccounting.runs` conserva corredor, lanzador responsable, clasificación del equipo y del pitcher (`earned`, `unearned`, `pending`) y revisión justificada. `totals` separa CL/CS/pendientes; `scoreMatches: false` advierte que el marcador tiene ajustes no reconstruidos. El registro de carreras no se recorta con los 500 eventos recientes.
	- `pitcherStats` agrega `earnedRuns`, `unearnedRuns`, `pendingRuns`. `runsAllowed` se carga al responsable del corredor heredado, no automáticamente al relevista. Una carrera puede ser sucia para el equipo y limpia para el relevista; oportunidades de out previas a su entrada no se le cargan. Las sustituciones ofensivas confirmadas conservan esta responsabilidad al reemplazar al corredor en base.
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
