# live-scoring

Modulo de anotacion oficial colaborativa para PlaySport.

## Reglas implementadas

- El organizador define anotadores autorizados del torneo.
- Organizador/anotador y jugador/manager son grupos incompatibles por cédula en un mismo torneo. La regla es automática, no admite una excepción del organizador y conserva el historial aunque se retire un rol o una inscripción.
- Las cuentas se vinculan a una cédula inmutable antes de su primera asignación. Cuentas diferentes con la misma cédula no eluden la incompatibilidad. No se restringen otros torneos ni la mera existencia de una persona en el registro global.
- Las cuentas reales usan identidad verificada, propiedad del torneo y asignaciones por juego. Los aliases declarados del demo solo funcionan con la cuenta local autorizada, nunca como credenciales de producción.
- El módulo usa `PLAYSPORT_OFFICIAL_STATE_PATH` (por defecto `.local/official-scoring/state.sqlite`), WAL y sincronización FULL. Partidos, autorizaciones, lineups, personal, estadísticas, deshacer, archivos y actas se restauran tras reiniciar.
- El registro JSON anterior se importa una sola vez al mismo SQLite. Cambios del registro y del marcador se confirman juntos antes de responder o emitir SSE; un fallo revierte ambos. El JSON anterior se conserva, pero deja de ser la fuente activa.
- Una base corrupta o previamente inicializada que desaparezca detiene el arranque; no se reemplaza por juegos vacíos. Respalda consistentemente la base y su marcador `.initialized`. Se admite un escritor por base, con rechazo de revisiones de otra instancia.
- También se validan los cargos `MANAGER` y `DIRIGENTE` de `presentOfficials` y sus movimientos posteriores. Los conflictos devuelven 409 sin publicar cambios parciales; una cuenta nueva sin cédula devuelve 400.
- El organizador debe asignar explícitamente los anotadores de cada juego. La autorización del torneo, por sí sola, no permite anotar ningún partido.
- Solo `organizer` y `scorekeeper` autorizados pueden publicar anotaciones oficiales.
- `manager` entrega el lineup y consulta el registro oficial en vivo; no tiene anotación privada ni escritura oficial.
- El endpoint antiguo conserva sus claves históricas `identificationNumber`. Los nuevos menores usan un ID opaco permanente en el registro deportivo.
- Un menor sin cédula se registra por `/api/registration`, con código privado cédula-del-responsable más sufijo. Ese código no es su documento legal; nunca se usa la cédula del adulto como si fuera del menor.
- En toda la app/ecosistema no se permite repetir cédula.
- El manager incorpora directamente desde ROSTER dentro de los cupos/plazo del torneo. La sustitución administrativa de la plantilla sigue siendo del organizador y tampoco puede eludir esos límites.
- El mismo numero de cédula no puede estar en dos rosters distintos del mismo torneo.
- Un jugador si puede estar en equipos distintos cuando son torneos diferentes.
- Un manager puede dirigir varios equipos en torneos distintos, pero no dos equipos dentro del mismo torneo.
- El lineup de juego del manager debe ser subconjunto del roster oficial del equipo (por cédula).
- El lineup permite de 9 a 13 bateadores y un FLEX defensivo adicional; incluye las posiciones P, C, 1B, 2B, 3B, SS, LF, CF, RF, OF4, SF y DH.
- Una posición no puede repetirse en la alineación ni tras una sustitución. Los intercambios defensivos conservan esa unicidad. `NA` no ocupa una posición y puede aparecer en varios bateadores extras. El API rechaza el envío completo sin publicar cambios parciales si detecta posiciones repetidas.
- El orden de bateo queda fijo después de la entrega. El suplente confirmado hereda el turno del jugador saliente; un intercambio defensivo conserva el turno de cada jugador, el índice del bateador y el conteo. No se admiten campos `battingOrder` u `order` en una sustitución o cambio defensivo: se rechaza el movimiento completo, sin modificar la alineación. El lineup original y las estadísticas anteriores se conservan.
- La entrega fija la cantidad de turnos titulares y de defensores. `DH` y `NA` no cuentan como defensores; FLEX sí. Ni una sustitución ni un cambio defensivo pueden aumentar o reducir esas cantidades. Se valida contra el lineup inicial al solicitar, confirmar y registrar un cambio oficial directo; un rechazo no cambia versiones, solicitudes ni anotación. Los intercambios entre jugadores activos siguen disponibles. Antes del inicio se puede cancelar la entrega y rehacerla.
- `lineupRole` distingue jugador regular, DP (bateador asignado), FLEX (defensa sin turno) y EH (bateador extra, que puede tener una posición defensiva o `NA`). DP y FLEX se registran como pareja; FLEX no ocupa turno de bateo.
- Cada entrada del lineup puede incluir un numero de camiseta de 0 a 99, especifico para ese juego; el numero no se guarda en el perfil global del jugador.
- El organizador configura la regla del corredor temporal del torneo: solo un jugador fuera del lineup (`BENCH`) o cualquiera del roster (`ROSTER`). El evento `corredor_temporal` reemplaza en base al pitcher o receptor sin alterar su puesto de bateo.
- Los jugadores antiguos conservan las proyecciones free/paid existentes. Los nuevos menores exponen solo nombre e ID opaco, también en paid: su documento, código familiar, nacimiento y contacto son privados.
- Cada turno oficial al bate avanza automaticamente al siguiente bateador del lineup.
- La anotacion oficial soporta eventos jugada a jugada (pitch y jugada), y desde esos eventos se actualizan pizarra, bases y estadisticas por jugador.
- `scorecardCommand` acepta `strikeoutType: 'swinging' | 'looking'` en el tercer `pitch/strike` o en resultados `strikeout` y `droppedThirdStrike`. Se conserva en log y eventos oficiales sin cambiar el total de ponches, las rutas ni los registros antiguos sin tipo. Un tipo inválido, aplicado a otro resultado o a un strike anterior al tercero se rechaza sin publicar cambios. El tercer strike no retenido conserva la validación WP/PB y de bases; no implica out automático.
- La bitacora del juego conserva el inning de cada evento y expone cada turno al bate completado y cada error defensivo, para consultar la hoja de juego por jugador durante el partido.
- El desglose defensivo expone una fila por error, incluidos hits con error y varios errores del mismo jugador en una jugada, con `sequence`, `errorIndex`, posición y tipo. Los datos se leen de la planilla guardada sin alterar totales ni registros históricos; posición/tipo ausentes en eventos antiguos permanecen `null`.
- Las nuevas escrituras `playEvent` de error, avance por error y foul no atrapado requieren `fielderIdentificationNumber` (o el alias `fielderId`) de un defensor activo del equipo contrario, no un suplente ni DH/NA. Las rutas y demás campos se conservan; los errores históricos sin atribución siguen siendo legibles.
- La planilla proyectada conserva los errores antiguos conocidos en `scorecard.log[].legacyError`, sin inventar posición ni tipo. `scorecard.fieldingIncomplete` señala un archivo de eventos parcial: web y Expo muestran `—` en vez de certificar un cero. Las nuevas planillas muestran `E` por equipo y defensor, más el detalle defensivo separado de los turnos ofensivos.
- El promedio de bateo (AVG) de la hoja se calcula como hits divididos entre turnos oficiales (AB); se muestra como `—` si el jugador aún no tiene AB.
- El resultado oficial se sincroniza en tiempo real por stream SSE.
- Los comandos `play` de out por batazo admiten juntos `battedBallType` (`ground`, `line`, `fly`, `bunt`) y `fieldingSequence` (1 a 20 posiciones enteras, entre 1 y 10, en orden y con repeticiones). La posición 10 exige softbol con OF4/SF activo. Se rechazan tipos contradictorios, secuencias inválidas y toques ilegales, incluso dentro de una doble jugada, antes de publicar cambios. Los comandos antiguos sin estos campos mantienen su interpretación.
- El mismo par se admite en `fieldersChoice`, incluidas selección de dos outs y selección con error, y en resultados de contacto con corredores eliminados. No cambia destinos, RBI, errores, timing del tercer out ni el resultado del bateador. `runner/caught`, `runner/pickoff`, `runner/advanceOut` y `play/droppedThirdStrike` admiten solo `fieldingSequence`, sin inventar un tipo de batazo. Otros comandos no admiten una vía; los registros históricos sin ella siguen siendo válidos. Log, planilla, eventos, guardado entre clientes, restauración y deshacer conservan los metadatos.
- La vía no decide cuántos outs hubo: el resultado y los destinos explícitos identifican al bateador y corredores eliminados. Los metadatos se conservan en la planilla y en los eventos oficiales, y la descripción incluye la vía; guardado, restauración y deshacer mantienen ambos. Las métricas GO/LO/FO/TO/GIDP cuentan turnos, no defensores. Una clasificación histórica incompleta permanece desconocida. No se asignan asistencias ni outs defensivos individuales a partir de la secuencia solamente.

## Endpoints principales

### Bandeja de partidos del manager

`GET /api/official-scoring/games?userId=...&role=manager` devuelve solamente
encuentros donde participa un equipo cuyo roster del torneo pertenece a ese
manager. Cada juego indica `managerTeamId`, igual al `ownTeamId` de su entrega.
El lector compartido rechaza bandejas de manager sin ese equipo o con un equipo
ajeno al encuentro. Admite los distintos torneos del mismo manager y todos los
estados oficiales, sin agregar partidos de ejemplo ni otorgar derechos de anotación.
Los endpoints existentes de lineup y solicitudes mantienen los controles de
equipo, identidad, revisión y estado. El lector de entregas es compartido entre
web y móvil para mantener la misma validación de datos.

### Suspensión y reprogramación

- `POST /games/:gameId/suspension`: `{tournamentId, actorId, actorRole,
  expectedOfficialVersion, cause: "weather" | "force-majeure",
  scoreHandling: "keep" | "reset", reason}`. Organizador propietario o anotador
  asignado; solo pendientes/en curso, con equipos y ficha completos. Motivo
  obligatorio hasta 2000 caracteres. Archiva estado, lineup y anotación completos.
- `POST /games/:gameId/reschedule`: `{tournamentId, organizerId,
  expectedOfficialVersion, date, time}`. Solo organizador; requiere `suspended`.
  Cambia la ficha a la nueva fecha/hora y deja `scheduled`, sin iniciar anotación.
- `GET /games/:gameId/suspension-archive?tournamentId=...`: historial público
  de interrupciones. Con `&id=...` devuelve una copia de la anotación congelada.
  No existe una ruta de escritura/restauración del archivo.

Estas rutas usan el prefijo `/api/official-scoring`. `state.suspension` y los
catálogos/SSE muestran causa, motivo, decisión, autor/fecha, si había comenzado,
programación original y reprogramación. Reiniciar vacía todas las estructuras
de anotación y sus estadísticas, pero conserva personal aprobado y equipos.
Ambos modos cortan el historial de deshacer y liberan la ocupación del anotador.
Suspendido bloquea escrituras deportivas y no suma G/P. Los archivos tienen la
misma persistencia permanente que los juegos oficiales.

### Protesta y resolución de mesa técnica

- `POST /api/official-scoring/games/:gameId/protest`:
  `{tournamentId, actorId, actorRole: "scorekeeper", expectedOfficialVersion,
  teamId, reason}`. Solo el anotador explícitamente asignado puede pausar un juego
  `in_progress`. Motivo obligatorio, máximo 2000 caracteres; equipo del encuentro.
- `POST /api/official-scoring/games/:gameId/protest/decision`:
  `{tournamentId, organizerId, expectedOfficialVersion, winnerTeamId, reason,
  recordReference}`. Solo el organizador propietario registra una resolución
  pendiente. Fundamento obligatorio (máximo 4000), acta obligatoria (máximo 500).
  Se deriva el perdedor; no se reciben carreras inventadas ni cambios de jugadas.
- `GET /api/official-scoring/standings`: proyección pública `{games}` para calcular
  clasificaciones por `tournamentId`, sin asignaciones ni autorizaciones privadas.
  Los partidos `protested` no cuentan; un final con resolución adjudica G/P al
  ganador/perdedor del acta, manteniendo el marcador y las estadísticas originales.

El estado y los SSE contienen `state.protest`: reclamante, motivo, autor, fecha,
momento congelado y `resolution` nula o resolución con autor/fecha, ganador,
perdedor, fundamento y acta. La lista de asignados también incluye esa información.
El estado `protested` libera la ocupación de anotación. Todas las escrituras
deportivas del juego quedan bloqueadas, también después de la decisión final;
solo la ruta de decisión puede cerrar la protesta pendiente. Faltas de permisos
devuelven 403; conflictos de estado/versión y repetición devuelven 409; datos
incompletos devuelven 400. La resolución no es una reapertura administrativa.
El juego, su acta y la identidad de su autor persisten. Las cuentas reales deben
estar verificadas y autorizadas; validar el documento del acta sigue siendo una
responsabilidad administrativa.

### Registro familiar de demostración

Usar solo datos ficticios. El registro familiar persiste en
`PLAYSPORT_REGISTRATION_PATH` (por defecto `.local/registration.json`, relativo al
directorio de trabajo de la API), con permisos 0600, bloqueo exclusivo y reemplazo
atómico. No hay autenticación ni comprobación documental de producción.

- `POST /api/registration/access`: crea un acceso familiar vacío y devuelve `key`.
  El cliente conserva esta capacidad privada por cuenta local.
- Las siguientes rutas requieren `Authorization: Bearer <key>`. Conocer una
  cédula o `actorId` no autoriza la lectura. No se devuelve el hash de acceso.
- `GET /api/registration/family`: adulto y representados de ese acceso.
- `POST /api/registration/adult`: `identification`, `fullName`, `birthDate`
  (`AAAA-MM-DD`), `email`, `phone`, `location: {stateId, municipalityId}`; adulto >=18 años.
  Debe aportar correo o teléfono, al menos uno. Los registros antiguos sin
  `phone` siguen siendo legibles. La cédula queda fija. Los contactos se validan
  sintácticamente, no se verifican.
- `POST /api/registration/children`: `fullName`, `birthDate`, `location`,
  `identification` (cadena vacía si no tiene), `relationship`
  (`father|mother|guardian`) y `consent: true`. Requiere adulto completo, menor
  de 18 y cédula propia única si existe. El servidor asigna el sufijo; nunca
  acepta uno elegido por el cliente. Nombre+nacimiento coincidentes requieren
  revisión sin fusión automática ni divulgación de la familia existente.
- `POST /api/registration/children/:childId/document`: `{identification}`.
  Conserva ID, rosters e historial y añade el código anterior a los alias.
- `POST /api/registration/children/:childId/transfer`: `{identification}` del
  nuevo responsable ya registrado. Devuelve una invitación privada de siete días.
- `POST /api/registration/transfers/accept`:
  `{invitation, relationship, consent: true}` desde el acceso destinatario.
  Cambia la relación de representación, no el ID ni el número. Es de un solo uso;
  el representante anterior pierde acceso a la ficha.
- El roster y los comandos deportivos admiten el ID opaco o el código/documento
  vigente o anterior, y los convierten al ID antes de guardar. La API nunca
  publica el código familiar en la pizarra.
- El registro activo se importa al almacenamiento deportivo permanente al iniciar
  el módulo. La revisión de tutela, recuperación y coincidencias documentales
  conserva sus controles administrativos; no se infiere autorización de un rol visual.

### Roster del manager y preinscripciones

- `GET /api/registration/roster/teams?managerId=...`: equipos del manager,
  incluso sin juegos programados.
- `GET /api/registration/roster/members?managerId=...&tournamentId=...&teamId=...`:
  integrantes incorporados y cargos, estado de confirmación personal separado,
  cupos usados/máximos y cierre global en `admission`.
- `GET /api/registration/roster/person` con el mismo contexto e `identification`:
  busca cédula o ID en el registro persistente y en los registros deportivos
  históricos. No devuelve fecha de nacimiento, contacto ni códigos de menores.
- `POST /api/registration/roster/members`: contexto, `personId` y `role`.
  Reutiliza una persona, incorpora directamente y no modifica datos ni permisos.
- `POST /api/registration/roster/preinscriptions`: contexto, `role` y `person`
  (`identification`, `fullName`, `birthDate`, `email`, `phone`,
  `representativeIdentification`). Para menores la cédula propia puede estar
  vacía, el representante es obligatorio y el contacto es del representante.
  Se persiste en el mismo archivo familiar, con bloqueo y reemplazo atómico.
  Coincidencias no se duplican ni actualizan silenciosamente.
- `POST /api/registration/roster/invitation`: contexto y `personId`.
  Solo el manager que realizó esa preinscripción puede generar la invitación.
  Devuelve un código aleatorio de siete días; solo se guarda su hash.
- `POST /api/registration/preinscriptions/recover`: `{invitation}` y acceso
  familiar privado. Recupera los datos para revisión; para menores exige el
  representante indicado. No confirma el registro ni aprueba una inscripción.
  `adult`/`children` conservan el ID preinscrito al confirmar; una discrepancia
  de nombre/nacimiento exige revisión. La invitación deja de servir al confirmar.

Las rutas de roster comprueban que el manager declarado dirige ese equipo;
como el resto de la API deportiva demo, aún falta autenticación real. Sus
respuestas ordinarias nunca incluyen nacimiento/contacto, incluso si el torneo
es de pago. Los jugadores incorporados están disponibles para preparar el lineup;
no se modifica ningún lineup, posición ni resultado. La confirmación personal
permanece pendiente hasta guardar el registro adulto/familiar.

### Cupos y cierre del roster

- `GET /api/registration/roster/rules?organizerId=...`: torneos propios, incluso sin juegos.
- `GET /api/registration/roster/rules/:tournamentId?organizerId=...`: reglas, revisión,
  estado global, equipos y juegos con evidencia de inicio.
- `POST` a la misma ruta: `{organizerId, rules, revision, reopen}`. Solo el propietario;
  revisión obsoleta devuelve 409.
- `rules.caps`: cuatro enteros no negativos (`players`, `direction`, `coaches`, `support`).
  Incluyen preinscripciones; un cupo inferior a la ocupación actual devuelve 409.
- `rules.cutoff`: exactamente una modalidad: `{kind:"date", date:"AAAA-MM-DD"}`,
  `{kind:"round", round:1, moment:"start"|"finish", rounds:{gameId:1}}`, o
  `{kind:"games", games:1, count:"tournament"|"first-team"|"all-teams"}`.
- Fecha cierra después del último milisegundo del día venezolano (UTC−4).
  Ronda usa inicio real, no una suspensión antes del primer lanzamiento; finalizar
  exige todos los partidos hasta la ronda. Iniciar una ronda posterior también cierra.
  Falta de asignación bloquea nuevas incorporaciones, sin latch definitivo.
- Juegos cuentan solo estado `final`, excluyendo suspendidos/protestados.
  El cálculo escogido provoca siempre un cierre simultáneo para todos los equipos.
- `closedAt` se persiste atómicamente antes de confirmar la transición deportiva que
  alcanza el tope. Deshacer/reprogramar no reabre; `reopen:true` requiere reglas cuyo
  nuevo tope no haya sido alcanzado. Cambiar reglas sin reapertura conserva el cierre.
- Torneos históricos sin reglas mantienen el comportamiento sin cupos/plazo, indicado
  explícitamente. Las incorporaciones directas y sus reglas se guardan en el registro
  existente; la sustitución administrativa retira membresías omitidas sin resucitarlas.

### API deportiva existente

- `POST /api/official-scoring/tournaments/:tournamentId/authorization`
	- Configura autorizacion a nivel torneo y opcionalmente `subscriptionTier` (`free` o `paid`).
	- Al crear un torneo acepta `rosterRules` opcional, validado/persistido antes de crear la autorización. Para editarlo después usa el panel/rutas con revisión.
	- Para una cuenta nueva, requiere `organizerIdentificationNumber`. Para nuevos anotadores, requiere `scorekeeperIdentities: [{ actorId, identificationNumber }]`, correspondientes a `scorekeeperIds`.
	- Una cuenta previamente vinculada permite omitir su cédula; reenviarla con otro valor devuelve 409. Las identidades nuevas solo se guardan si toda la operación es válida.
	- Crear el torneo registra inmediatamente al organizador en el grupo oficial; cada autorización de anotador amplía su historial. Revocar autorizaciones no borra el historial.
- `POST /api/official-scoring/tournaments/:tournamentId/rules`
	- Solo el organizador registrado puede configurar `courtesyRunnerSource` (`BENCH` o `ROSTER`) enviando su `organizerId`.
	- Aplica a todos los juegos del torneo, incluidos los lineups existentes. Por defecto: `BENCH`.
	- En móvil se configura desde el panel oficial del perfil organizador.
- `POST /api/official-scoring/tournaments/:tournamentId/subscription`
	- Cambia el plan del torneo (`free`/`paid`) por el organizador.
- `POST /api/official-scoring/players`
	- Registra jugador global por única vez con cédula y nombre.
	- Compatibilidad para registros deportivos antiguos. Rechaza `isMinor: true`: los menores deben pasar por el registro familiar privado.
- `GET /api/official-scoring/players?visibility=free|paid&tournamentId=...`
	- Lista jugadores del registro global.
	- `visibility=paid` requiere contexto de torneo con plan `paid`.
- `POST /api/official-scoring/tournaments/:tournamentId/players`
	- Compatibilidad: registra jugador en el registro global validando organizador del torneo.
	- Comprueba incompatibilidad y, si el registro tiene éxito, conserva la participación como jugador en ese torneo.
- `GET /api/official-scoring/tournaments/:tournamentId/players?visibility=free|paid`
	- Lista jugadores del registro global bajo visibilidad del plan del torneo.
- `POST /api/official-scoring/tournaments/:tournamentId/teams/:teamId/roster`
	- Registra/actualiza roster por cédulas del registro global.
	- Requiere el `organizerId` del organizador del torneo; el manager no puede editarlo. No permite retirar a un jugador de una alineación activa entregada.
	- Exige `managerIdentificationNumber` cuando `managerId` todavía no tiene una cédula vinculada. Valida la identidad del manager y todas las cédulas del roster contra el historial oficial antes de guardar nada.
- `GET /api/official-scoring/tournaments/:tournamentId/teams/rosters?visibility=free|paid`
	- Lista rosters oficiales del torneo con datos segun plan/visibilidad.
- `GET /api/official-scoring/tournaments/:tournamentId/teams/:teamId/roster?visibility=free|paid`
	- Devuelve roster oficial de un equipo puntual para flujo de contexto manager.
- `POST /api/official-scoring/games/:gameId/authorization`
	- Configura autorizacion de anotadores para un juego puntual.
	- Requiere autorización vigente del torneo. Una lista vacía revoca la asignación sin borrar anotaciones; no existe herencia automática del torneo.
- `GET /api/official-scoring/games?userId=...&role=organizer|scorekeeper`
	- Lista solo juegos con equipos configurados. El organizador ve los de sus torneos; el anotador, solo los que tiene asignados explícitamente y con autorización vigente del torneo.
	- Devuelve estado, marcador, equipos, datos de fecha/hora/estadio y anotadores asignados/disponibles. No crea juegos por consultar.
- `POST /api/official-scoring/games/:gameId/details`
	- El organizador configura `details: { tournamentName, homeTeamName, awayTeamName, date, time, venue, stateId?, municipalityId? }` junto con `tournamentId` y `organizerId`. Se validan fecha gregoriana, hora de 24 horas y la pareja territorial cuando está registrada.
	- La cartelera integra los juegos con ubicación registrada en la misma lista y con los mismos filtros que los archivos de ejemplo. Los juegos sin ficha o ubicación territorial no reciben datos inventados ni se incluyen en una búsqueda geográfica.
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
	- Los roles visuales no son credenciales. La cuenta verificada, la propiedad y las asignaciones autorizan las escrituras; el estado confirmado persiste en SQLite.
- `POST /api/official-scoring/games/:gameId/teams/:teamId/representative`
	- El manager responsable envía `tournamentId`, `managerId` e `identificationNumber` (cédula o ID permanente) para designar al dirigente de ese partido.
	- Puede elegir cualquier integrante del roster de ese equipo: jugadores, dirección, coaches o apoyo. No incorpora a nadie ni cambia su cargo permanente.
	- Solo aplica al equipo y partido indicados. No modifica al manager permanente ni concede permisos de cuenta o anotación.
	- Rechaza equipos ajenos al juego, cédulas fuera de la plantilla y cambios en juegos finalizados.
	- Si el integrante sale de la plantilla o cambia el dirigente, se revoca la autorización de los juegos no finalizados.
- `GET /api/official-scoring/games/:gameId/teams/:teamId/representative?tournamentId=...`
	- Devuelve `representative` (o `null`) con nombre, cédula, dirigente que autorizó y fecha.
	- La proyección de alineaciones también incluye `fieldRepresentatives`, aunque todavía no se haya enviado una alineación.
	- `presentOfficials` admite todos los cargos no jugadores del roster, incluidos coaches y apoyo. El lector compartido valida esos mismos cargos en web/móvil.
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
	- `scorecardCommand: { kind: 'runner', action: 'obstruction', from, to, errors: [{ playerId, position, type: 'obstruction' }], errorOuts? }` registra la base concedida por obstrucción defensiva. Requiere un único defensor activo y un destino posterior libre (o home); no mueve otros corredores ni termina el turno. Publica `ERROR_ADVANCE` con descripción de obstrucción, un error atribuido de tipo `obstruction` y, si llega al plato, la carrera sin RBI. `errorOuts` admite 0 o 1; omitirlo conserva pendiente la reconstrucción. Guardado y deshacer usan la misma transacción y versión de las demás jugadas.
	- Nuevas jugadas `scorecardCommand: { kind: 'play', result: 'fieldersChoice', destinations, note? }` requieren corredores en base y destinos explícitos para todos los participantes. No se completan automáticamente como «todos quietos». Las opciones contextuales web/Expo solo ofrecen fuerzas existentes o eliminaciones por toque de corredores presentes; `note` conserva la opción elegida. `validThirdOutRuns: true` solo admite carreras indicadas antes de un tercer out no forzado, nunca con out forzado o del bateador antes de primera. Se conserva el replay de históricos sin destinos, las rutas y los permisos.
	- «Selección + error» reutiliza `fieldersChoice` con `errors: [{ playerId, position, type: 'fielding' | 'throwing' }]`, `errorSavedRunnerId`, `errorOuts?` y `rbis`. El corredor salvado debe estar en las bases originales y conservar un destino a salvo; los outs evitados no pueden ser cero. Los demás participantes pueden tener outs reales dentro del límite de la entrada. Se registra cada error, sin hit ni out ficticio, y se conserva la identidad salvada para clasificar su carrera como sucia aunque anote después. Si faltan otros datos de reconstrucción, no se inventan: quedan pendientes. No cambia el evento oficial ni los permisos; guardar, reiniciar y deshacer conservan la jugada completa.
	- «Jugada de selección · 2 outs» añade `selectionOuts: [{ runnerId, base }, { runnerId, base }]` al comando `fieldersChoice`, en el orden real de eliminación. Exige dos corredores distintos presentes, cero o un out previo, ambos destinos 0 y bateador a salvo; las bases de los intentos deben corresponder al avance o regreso posible en cada paso. Recalcula la fuerza tras el primer out, y `validThirdOutRuns` depende del último out, no de una fuerza que ya desapareció. Las dobles jugadas forzadas o de fuerza invertida no suman RBI. Publica el evento existente `DOUBLE_PLAY`, manteniendo el resultado de bateo FC y los destinos reales del preview; conserva secuencia, planilla «FC·DP», persistencia y deshacer. Los históricos sin `selectionOuts` conservan su replay.
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
2. Jugador se registra una sola vez; los menores pasan por el registro familiar con representante y reciben un ID permanente, con cédula propia opcional.
3. Organizador aprueba el roster con jugadores del registro global y vincula al manager a su cédula.
4. Organizador define equipos del juego (home/away).
5. Manager registra lineup oficial con los identificadores del roster aprobado, incluidos los IDs permanentes de menores.
6. Organizador autoriza anotadores del juego en curso.
7. Anotador u organizador publica cambios oficiales.
8. En cada `plateAppearance`, el backend avanza automaticamente al siguiente bateador.
9. Todos los clientes suscritos al stream del juego reciben el cambio inmediato.
# Amistosos privados

`GET/POST /api/friendly-games` y `POST /api/friendly-games/:id/updates` requieren
`Authorization: Bearer <clave privada local>`. La propiedad se obtiene del acceso
validado por `RegistrationService`, nunca de un `ownerId` enviado por el cliente.
No existe una consulta pública ni se integran estos juegos en endpoints oficiales.

Creación: `{ sport: "baseball" | "softball", names: { home, away },
lineups: { home: { name, position }[], away: { name, position }[] } }`.
Cada equipo requiere 9 a 12 participantes en orden al bate, sin posiciones
duplicadas salvo `NA` (sin asignar). Se aceptan nombres en formato `string` como
compatibilidad, asignándoles `NA`, con el mismo mínimo/máximo. Los amistosos ya
guardados con menos participantes siguen disponibles. No se piden documentos,
camisetas ni registros de jugadores. Actualización: `expectedRevision` y exactamente
una operación: `command`, `undo: true` o `errorOuts: 0..3 | null`.
Los partidos finalizados son de solo lectura.

El archivo privado `.local/friendly-games.json` (o `PLAYSPORT_FRIENDLY_PATH`)
persiste entre reinicios. Sigue el patrón del registro familiar: bloqueo exclusivo,
temporal con permisos 0600 y reemplazo atómico. Los datos inválidos no se reemplazan.
## Retirar una alineación antes del inicio

`POST /games/:gameId/team-sheets/:teamId/withdraw` recibe `tournamentId`,
`managerId`, `expectedRevision` y `expectedVersion` (la versión del snapshot
de entregas). Solo el manager del equipo participante puede retirar su propia
entrega si el partido sigue programado y nunca ha comenzado.

Elimina únicamente la entrega y lineup activos de ese equipo, cierra sus
solicitudes pendientes con una explicación y publica el nuevo snapshot para
todos los destinatarios. Mantiene roster, dirigente, rival e historial de
solicitudes. La versión evita que una confirmación antigua retire una entrega
nueva. `TeamSheet.canWithdraw` comunica la disponibilidad al cliente;
el servidor siempre vuelve a comprobarla al ejecutar la operación.
### Cronómetro del partido

`POST /official-scoring/games/:gameId/official-updates` admite `clockAction`
(`start`, `pause`, `resume`) junto a `expectedOfficialVersion`. Es una operación
exclusiva: no se mezcla con jugadas, correcciones ni cambios de duración.
Reutiliza la autorización de organizador/anotador y la persistencia transaccional.
`state.clock` y `playByPlay.scorecard.clock` contienen `startedAt`,
`runningSince` (nulo en pausa) y `elapsedMs` acumulados. Las horas las asigna
el servidor; el cliente no envía duraciones. La consulta incluye `serverTime`
cuando existe un reloj, y los eventos conservan su `timestamp` para sincronizar.
Pausar no entra en el historial de deshacer jugadas. Cierre, suspensión y
protesta detienen el reloj. Guardar un nuevo lanzamiento, resultado del bateo,
movimiento de corredor o error que prolonga el turno inicia o reanuda el reloj
en la misma escritura, después de validar la jugada. Incluye los eventos y
turnos del protocolo antiguo; no incluye corredores temporales, correcciones,
reglamento, deshacer ni consultas. Reprogramar no activa el tiempo por sí solo.
La pausa acumulada se excluye y no se cambia `runningSince` si ya corría.
No se modifica el tiempo al reproducir datos antiguos ni al fallar una escritura.
