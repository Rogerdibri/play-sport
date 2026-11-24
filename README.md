# PlaySport

## Administración local y accesos del piloto

`/admin` es el panel privado inicial: usuarios paginados y búsqueda, activación,
ampliación y revocación de pruebas por cuenta/plan, vencimientos y auditoría
paginada. `/account/access` consulta únicamente los accesos de la cuenta
autenticada. `/admin/example` muestra cuatro cuentas ficticias de solo lectura,
sin crear cuentas ni modificar partidas existentes.

La administración se autoriza en el servidor con `PLAYSPORT_ADMIN_ACCOUNT_ID`,
el UUID de una cuenta existente. En desarrollo se conserva además el acceso de
la cuenta maestra configurada privadamente; esa excepción no funciona en
producción. No existe un endpoint para autoconcederse administración. La
revisión documental sigue requiriendo su permiso separado
`PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID`; el panel reutiliza el revisor existente.

### Tres niveles de Jugador, sin precios

Jugador básico conserva perfil, equipos, cartelera y resultados básicos, sin
estadísticas personales. **Nivel 2 · Mis números** habilita la actuación por
partido: solo muestra las cifras del juego abierto, sin acumulados, filtros
personalizados ni trayectoria detallada. El histórico sigue registrándose,
incluso antes de activar un plan.
**Nivel 3 · Análisis completo** añade filtros por juego, torneo, temporada,
liga, equipo y fechas, acumulados históricos y personalizados y trayectoria de Jugador.
Los acumulados conservan separados el origen oficial/amistoso/privado, deporte,
modalidad, categoría y base del PCL; no se mezclan sus promedios.

Amistosos y planillas privadas permiten al creador vincular participantes por
cédula mediante «Vincular participantes con su cuenta», incluso después del
cierre, sin alterar jugadas. La vinculación no crea cuentas ni verifica
identidades: la cuenta verificada del participante recupera solo su línea
estadística, nunca la planilla completa ni datos de otras personas. Los
suplentes sin participación no generan registros. Los juegos antiguos sin
vínculo no se atribuyen por nombre ni se modifican automáticamente.
Un vínculo vacío desactiva también la identificación heredada del ID local.
Las participaciones se recalculan desde las versiones persistidas; no hay
doble acumulación por recarga o corrección. Las copias privadas con el alcance
de un partido oficial/amistoso ya identificado no duplican su registro.
También se deduplican copias privadas con el mismo alcance de torneo y juego.
Si difieren entre creadores, se muestra el motivo de exclusión sin elegir
revisiones incomparables ni sumar cifras dudosas. Las identidades ambiguas
requieren corregir los vínculos. Las planillas archivadas permiten vincular
participantes desde «Mis datos guardados» sin reabrir ni modificar la anotación.
Los finales no oficiales computables se identifican como `recorded`, no como
resultados oficiales. Una fecha ausente permanece ausente, sin inventarla.
La trayectoria detallada mantiene su respaldo oficial; esta integración
amplía las estadísticas personales, no crea intervenciones de trayectoria
para amistosos o planillas privadas.
El parámetro histórico `source=official` significa datos reales de la cuenta;
el campo `kind` distingue los tres orígenes dentro de esa respuesta.

`player-numbers` identifica la prueba del nivel 2. La clave existente `player`
identifica el nivel 3 para conservar el alcance de pruebas anteriores, sus
revisiones, vencimientos y auditoría, sin reescribir registros. Si ambas pruebas
están vigentes prevalece el nivel 3; al vencer o revocarse, se conserva el nivel 2
si todavía está vigente. El básico no requiere una prueba. No hay precios,
cobros, renovación automática ni editor del catálogo.

La API recalcula el acceso por solicitud: `statistics` devuelve
`analysisAllowed` y solo admite filtros de Jugador con la capacidad
`player-statistics-analysis`. El nivel 2 no puede solicitar parámetros de
análisis, ni siquiera vacíos. Los filtros del nivel 3 se validan y procesan en
servidor; la web conserva el catálogo completo para elegirlos. Las capacidades
de trayectoria de otros roles no desbloquean la trayectoria de Jugador:
sus registros se incluyen únicamente con análisis personal completo.
Una suscripción no cambia identidad, permisos deportivos ni titularidad.

`/admin` y `/account/access` muestran los niveles y permiten consultar o
administrar sus pruebas. `/sports-sheet/statistics/example` compara los tres
niveles con registros ficticios reutilizables y planillas de respaldo, sin
cuentas, escrituras ni activación de accesos reales.

### Vigencias de Jugador, Manager y Anotador

La cuenta y la participación básica de Jugador permanecen gratuitas, sin
vencimiento. Manager y Anotador tienen seis meses gratuitos de operación,
contados desde la activación explícita de cada rol en `/account/access`, no
desde el registro, la navegación o el primer partido. Se exige identidad
verificada. La activación se persiste por cuenta y rol: repetirla, cambiar
de sesión o reiniciar el servidor nunca reinicia los seis meses. No se
modifican fechas ni partidos de cuentas existentes de manera retroactiva.

`POST /api/accounts/activate-role` recibe únicamente
`{expectedAccountId,role}`, con `role:"manager"` o `"scorekeeper"`, sesión,
origen permitido y sin query. La cuenta siempre se resuelve desde la sesión.
`GET /api/accounts/access` incluye las vigencias y la hora del servidor.
Los catálogos de cupos mantienen su selección y añaden la vigencia operativa.
Hay avisos dentro de la aplicación cuando quedan treinta días o menos;
no son correos, mensajes ni notificaciones push.

Después de la gratuidad puede mantenerse el nivel 1 operativo, sin comprar
funciones premium ni aumentar cupos. El catálogo contempla vigencias mensual,
trimestral, semestral y anual para Jugador de niveles 2/3 y Manager/Anotador de
niveles 1/2/3. Los permisos de cada rol permanecen independientes.
**Precios, checkout, cobros y renovación automática siguen deshabilitados.**
Actualmente solo el administrador puede conceder pruebas temporales.
Los planes `manager-basic` y `scorekeeper-basic` mantienen operación básica
sin habilitar estadísticas detalladas. Organizador continúa separado: su
monetización se define por torneo, no mediante estas periodicidades.

Las pruebas administrativas admiten `months:1|3|6|12` en vez de `expiresAt`,
nunca ambos. El servidor calcula meses calendario en UTC y ajusta al último
día de los meses cortos; renovar una prueba vigente añade tiempo desde su
vencimiento. Se mantienen revisión, idempotencia y auditoría existentes.
La revocación explícita no se confunde con un vencimiento natural.

Al vencer se bloquean nuevas operaciones oficiales, no la cuenta ni los
resultados o consultas básicas autorizadas. Un partido que ya estaba en curso
antes del vencimiento puede terminarse, incluso cuando vencen funciones premium
y se reducen los cupos; no permite iniciar otro partido ni acceder a otros
torneos. El instante de inicio se conserva junto al partido y no se borra con
correcciones. Para juegos anteriores se utiliza la evidencia de un estado
en curso ya guardado. Las suplencias autorizadas para un partido exacto siguen
siendo gratuitas, aunque el acceso propio del suplente no esté activado o haya
vencido; no habilitan estadísticas premium.
La edición de inscripción, roster general y logos de Manager requiere vigencia
operativa; la continuidad de un partido no habilita estas operaciones generales.
Un acceso puntual a otro partido tampoco renueva una vigencia vencida.

`/account/access/example` muestra vigencias permanentes, vencidas y próximas
a vencer con fechas de ejemplo, solo lectura y sin modificar cuentas reales.

### Organizador: una oportunidad gratuita y capacidad por torneo

Organizador no tiene niveles, membresía mensual ni límite global de torneos.
Cada cuenta verificada dispone de **una sola oportunidad gratuita**, para un
torneo de **2 a 5 equipos y hasta 13 partidos ordinarios**, con formato flexible,
más **hasta 3 desempates adicionales de clasificación incluidos**.
Puede reservar un torneo guardado y cambiar o liberar esa reserva antes del
primer partido. Guardar, publicar, abrir la planilla y preparar alineaciones
no consumen el beneficio.

El primer inicio oficial o jugada consume la oportunidad permanentemente.
La reserva y el partido se guardan en la misma transacción del motor:
un fallo de persistencia restaura ambos. Correcciones, cancelaciones,
eliminación de cruces y retiros no devuelven juegos utilizados ni la gratuidad.
Reiniciar el servidor o cambiar de dispositivo tampoco la reinicia.

La estimación suma el volumen máximo por fases: todos contra todos por grupos
y vueltas; eliminatorias por ronda y máximo de cada serie; suizo por rondas;
doble eliminación incluyendo el posible reinicio de la final. Formatos
personalizados, repechajes y eliminatorias manuales requieren `maxGames`.
Los cupos de equipos y los participantes históricos también cuentan.
No hay cargos separados por grupos, fases o jugadores, y el tamaño del torneo
no cambia el nivel, los cupos ni el precio del Anotador.

- `GET /api/tournaments/capacity`: reserva y uso propios, con sesión y sin query.
- `POST /api/tournaments/free-reservation`: recibe únicamente
  `{expectedAccountId,expectedRevision,requestId,tournamentId}`; `null` libera
  antes de jugar. Exige sesión, origen permitido, titularidad y revisión.
- `/demo/tournaments`: estimación, reserva y actualización de capacidad.
- `/account/organizer-capacity/example`: tres formatos reutilizables de solo
  lectura, con estados disponible/reservado/consumido.

Los torneos anteriores conservan su acceso sin migraciones retroactivas.
Los nuevos torneos sin capacidad pueden planificarse, pero no iniciar partidos;
el catálogo informa este motivo sin pedir al Anotador renovar o pagar un extra.
La preparación de alineaciones de Manager no se bloquea por esta reserva.
**Precios, compras y cobros reales siguen pendientes**. Guardar una selección
no habilita partidos; una prueba personal del rol tampoco contrata un torneo.

### Organizador: paquetes, personalizado y ampliaciones

La contratación es por torneo, vigente hasta cerrarlo, sin mensualidades ni
traslado a otra temporada o edición. Puede elegirse un torneo pago primero,
conservando la oportunidad gratuita para otro. El gratuito iniciado no se
convierte en pago.

| Paquete | Equipos | Partidos ordinarios |
| --- | ---: | ---: |
| Pequeño | 8 | 40 |
| Mediano | 16 | 150 |
| Grande | 32 | 550 |

El personalizado declara equipos y partidos. La fórmula comercial es
**activación única + capacidad de partidos**: equipos, grupos, vueltas y fases
recalculan el volumen, sin cargos independientes. Una ampliación autoriza
únicamente los partidos adicionales y no repite la activación. Aumentar equipos
dentro del volumen autorizado no vuelve a contratar partidos.

Sin checkout, únicamente un administrador puede autorizar o revocar
**capacidad de prueba por torneo**, con motivo y revisión. Esto no registra
una compra ni un pago. Una ampliación pendiente conserva el crédito anterior;
reseleccionar un paquete no evade una revocación.

- `POST /api/tournaments/plan-selection`: selección propia con cuenta, torneo,
  revisión, nonce y paquete o personalizado; `null` retira una selección no iniciada.
- `GET /api/tournaments/admin-capacity?tournamentId=...`: consulta administrativa.
- `POST /api/tournaments/plan-authorization`: administrador autenticado, revisión,
  nonce, motivo y acción `authorize-test` o `revoke-test`.
- `/admin/organizer-capacity`: habilitación administrativa de prueba.
- `/account/organizer-capacity/example`: comparador de paquetes y ejemplo de
  13 ordinarios + 3 desempates, sin escribir sobre datos existentes.

Los tres desempates incluidos también aplican al gratuito, fuera de sus trece
partidos ordinarios. Deben declararse en una fase con finalidad de desempate,
justificación y equipos de una fase de origen. Solo pueden iniciarse cuando
esa fase y todos sus partidos estén finalizados. La igualdad de clasificación
según reglamentos particulares la justifica el organizador: no hay todavía
verificación matemática automática del empate. No son innings adicionales.

### Fuerza mayor: anular un intento y repetir sin otro cupo

`POST /api/tournaments/restart-game` exige al organizador propietario, motivo,
nonce y revisión oficial actual. Solo admite partidos en curso o suspendidos,
nunca finalizados o bajo protesta. El reemplazo conserva el mismo partido del
calendario y cupo; no devuelve la oportunidad gratuita ni añade otro consumo.

El estado operativo descarta marcador, jugadas, estadísticas, historial de
anotación, archivos de suspensión y alineaciones del intento anulado.
Requiere nuevas alineaciones. Conserva autorizaciones y una constancia
administrativa con motivo, fecha e identificadores distintos de intento y
reemplazo, sin archivo deportivo. Las revisiones oficial y de personal crecen
para que otros clientes no restauren datos anteriores. Antes de recibir nuevas
alineaciones puede reprogramarse fecha, hora o sede, manteniendo los equipos
y la identidad del partido.

Esto es distinto de suspender un juego, que mantiene su archivo deportivo.
No promete eliminar copias ya descargadas ni borrado forense de respaldos.

### Tres niveles de Manager, sin precios

- Básico: seis meses gratuitos desde la activación, una inscripción activa, administración del equipo y pizarra básica,
  sin promedios ni cifras individuales detalladas.
- Nivel 2: hasta tres inscripciones activas; cifras del equipo y de cada jugador
  del partido abierto, sin filtros ni acumulados.
- Nivel 3: inscripciones activas ilimitadas; filtros y análisis de equipos.
  Las estadísticas de cada jugador se consultan solo por partido, nunca acumuladas,
  tanto en torneos activos como cerrados.

Un mismo club inscrito en dos torneos consume dos cupos. Torneos finalizados o
cancelados y equipos retirados no consumen cupos. Al bajar a básico con varias
inscripciones se conserva todo y se elige una para administrar; las otras quedan
para consulta. Los cupos no eliminan la regla de un solo equipo por Manager
dentro del mismo torneo ni conceden asignaciones deportivas.

`/account/manager-teams` guarda la selección en la cuenta con revisión transaccional:
un cambio desde otra sesión produce un conflicto, no un reemplazo silencioso.
Roster, inscripción, alineación, cambios de personal y logos respetan los cupos
en servidor. La selección en edición no se descarta por un refresco automático.

`GET /api/sports-sheet/manager-teams` consulta cupos; `POST` guarda
`expectedAccountId`, `expectedRevision` y claves de inscripción seleccionadas.
`statistics?mode=team` incluye líneas individuales por partido con identificadores
opacos, sin cédulas. Filtros requieren `manager-statistics-analysis`.
El límite del nivel 3 se representa como `null`, no como un número artificialmente
alto; las selecciones pueden incluir más de tres inscripciones y se conservan
al cambiar de nivel. La selección sigue limitada a inscripciones propias vigentes.
La ruta anterior `GET /api/sports-sheet/manager-player-totals` devuelve HTTP 403
`MANAGER_PLAYER_TOTALS_UNAVAILABLE` para cualquier cuenta autenticada, incluso
la cuenta de pruebas; no calcula ni entrega acumulados individuales.
Los acumulados del nivel 3 son colectivos del equipo, nunca por jugador.
Los partidos provisionales o sin respaldo no se suman en el análisis colectivo y las correcciones
sustituyen versiones anteriores. `/sports-sheet/statistics/manager-example`
compara los niveles con planillas reutilizables de solo lectura, sin cambiar cuentas.

### Tres niveles de Anotador, sin precios

- Nivel 1: seis meses gratuitos desde la activación y un torneo activo; pizarra básica de 9 innings en béisbol y 7 en softbol
  (los extra innings siguen mostrándose). Sin averages ni tablas numéricas detalladas.
  Ganador, perdedor, salvador, mejor bate y MVP muestran solo sus nombres.
- Nivel 2: hasta tres torneos, incluso de una misma liga. Box score completo del
  partido elegido, sin acumulados individuales.
- Nivel 3: torneos ilimitados; box score y acumulados individuales exclusivamente
  del torneo seleccionado. Nunca historial de por vida ni mezclas entre torneos
  o ligas; deporte, modalidad, categoría y base de PCL también se mantienen separados.

Todos los niveles exigen identidad verificada y asignación del organizador.
El catálogo no concede acceso a perfiles ajenos: solo se proyectan nombre y líneas
de juego de participantes del ámbito autorizado, con identificadores opacos.
Un plan de Jugador o Manager no desbloquea las cifras del Anotador básico.
Los cupos se guardan por cuenta con revisión transaccional; cambiar de dispositivo
no cambia la selección, y las revisiones antiguas producen conflicto.
Al bajar de nivel se conservan todos los registros y se ajusta la selección.
Torneos cerrados previamente seleccionados conservan consulta y no consumen
cupos activos; no habilitan nuevas anotaciones.

`/account/scorekeeper-tournaments` permite elegir cupos y solicitar acceso a un
partido asignado fuera de ellos. Niveles 1 y 2 conservan sus cupos al obtener un
extra; este acceso nunca abre todo el torneo ni sus acumulados. **Los precios,
checkout y cobros reales siguen deshabilitados**: una solicitud queda pendiente
y no autoriza a anotar. El administrador puede autorizar o revocar una prueba
puntual, con motivo y revisión; solicitudes y decisiones quedan en una auditoría
persistente. Una autorización no sustituye la asignación deportiva del organizador.
La futura confirmación de pago deberá conceder este mismo derecho acotado, no un
plan ni un cupo permanente.

Rutas autenticadas, sin parámetros de identidad:

- `GET/POST /api/sports-sheet/scorekeeper-tournaments`: cupos propios y selección
  `{expectedAccountId,expectedRevision,selected}` de IDs de torneos.
- `GET /api/sports-sheet/scorekeeper-games`: catálogo de partidos de sus torneos,
  sin perfiles individuales; no concede permiso de escritura.
- `POST /api/sports-sheet/scorekeeper-extra`:
  `{expectedAccountId,expectedRevision,tournamentId,gameId}`, solo partido asignado.
- `GET /api/sports-sheet/scorekeeper-statistics?tournamentId=…&gameId=…`: nivel 2
  o 3, únicamente un partido habilitado.
- La misma ruta sin `gameId` exige nivel 3 y un torneo completo habilitado; no
  admite rangos, otros torneos ni IDs de jugador.
- `GET/POST /api/accounts/scorekeeper-extras`: cola y revisión solo administrativas.
  La decisión lleva `{expectedAdminId,accountId,tournamentId,gameId,expectedRevision,
  action:"grant"|"revoke",reason}`.

`/sports-sheet/scorekeeper` integra las consultas y
`/sports-sheet/scorekeeper/example` compara niveles con planillas de solo lectura
separadas de cuentas y juegos reales. Las correcciones reemplazan la versión
previa; los partidos provisionales o sin respaldo no entran en acumulados oficiales.
La anotación oficial y las lecturas con rol `scorekeeper` verifican cupos o extra
en servidor; el resumen final con ese rol no reutiliza permisos de otros planes.
Los streams contextuales vuelven a verificar sesión y ámbito antes de cada emisión.
Las vistas públicas del calendario y marcador mantienen su consulta pública.

#### Suplencia gratuita de Anotador

El organizador puede abrir un partido desde sus asignaciones y desplegar
**Suplencia gratuita de Anotador · Este partido**. Autoriza por cédula a una cuenta
existente con identidad verificada, indicando un motivo. La cédula se utiliza
privadamente para resolver la cuenta; no se publica en el catálogo, en la auditoría
ni en los marcadores. No se crean cuentas automáticamente ni se comparten sesiones.

La suplencia no cobra, no crea un extra de pago, no consume cupos y no transfiere
el plan del titular. Puede autorizarse un suplente en varios partidos, uno por uno.
Solo los partidos expresamente autorizados aparecen en sus asignaciones y en
**Mis suplencias gratuitas**. Un suplente básico anota con su pizarra básica;
si tiene nivel 2 o 3 consulta únicamente el box score del encuentro autorizado.
Una suplencia por sí sola nunca habilita el acumulado ni los demás partidos del
torneo, incluso con nivel 3. Sus torneos propios conservan sus permisos habituales.
La incompatibilidad entre participante y oficial y la regla de un único partido
en curso por anotador siguen vigentes.

El titular conserva su inscripción: con nivel 2 consulta cada partido, incluido
el anotado por el suplente; con nivel 3 los finalizados y respaldados alimentan los
acumulados de ese torneo mediante el mismo motor, sin duplicar registros.
Se admiten nuevas suplencias solo en partidos pendientes o en curso de torneos
activos. Se pueden revocar también después del cierre, sin borrar resultados.
La revocación elimina el permiso de suplencia; si la persona tiene además una
asignación titular independiente, esta conserva sus reglas y cupos.

`GET /api/sports-sheet/scorekeeper-substitutions?tournamentId=…&gameId=…`
requiere al organizador autorizado y devuelve revisión, suplentes y auditoría.
`POST` a la misma ruta, sin query, requiere origen permitido y
`{expectedAccountId,tournamentId,gameId,expectedRevision,action,reason}`:
para `action:"grant"` añade `identification`; para `action:"revoke"` añade
`substituteActorId`, nunca ambos. Una revisión antigua produce HTTP 409.
No se aceptan precios, planes ni permisos suministrados por el cliente.

Las concesiones y revocaciones se guardan transaccionalmente junto al partido.
Desde su primera suplencia también se mantiene un registro de autoría por versión
de anotación: cuenta deportiva, rol, acción y fecha. Corregir o deshacer una acción
no elimina este registro. No se inventa una auditoría de acciones anteriores.
Los controles oficiales, el catálogo, las estadísticas y el resumen contextual
verifican el partido exacto; los streams lo revalidan antes de emitir información.
El comparador de Anotador incluye una suplencia de solo lectura y datos aislados.

El catálogo inicial es fijo: Jugador, Manager y Anotador habilitan consultas según estos niveles;
Organizador conserva trayectoria y detalle del resumen final. Las pruebas no verifican identidades,
no asignan roles, equipos o juegos y no habilitan
dinero, pagos ni apuestas. Editar el catálogo, los planes pagos,
la suspensión global de cuentas y la supervisión global de torneos quedan para
entregas posteriores.

`GET /api/accounts/administration?q=&page=0&auditPage=0` devuelve hasta 25
usuarios y 25 eventos, solo para el administrador. `POST` en la misma ruta
requiere origen permitido, cuenta administradora esperada, UUID de solicitud,
cuenta destinataria, plan, revisión, acción y motivo. Activar requiere un
vencimiento ISO UTC futuro; revocar no recibe vencimiento. Los reintentos
recuperan la misma respuesta, y un conflicto de revisión no sobrescribe cambios.
La prueba, la confirmación y la auditoría se guardan en una sola transacción de
la base de cuentas existente. No se almacenan contraseñas ni documentos en la
auditoría.

`GET /api/accounts/access` no acepta identidad ni permisos por query. Las
capacidades vigentes se calculan con la hora del servidor en cada autenticación:
en el instante del vencimiento ya no autorizan nuevas lecturas detalladas.
Revocar o vencer no elimina los datos deportivos; las estadísticas propias
siguen dependiendo de identidad verificada y participación respaldada.
Los reportes oficiales vuelven a su proyección básica; amistosos y planillas
privadas siguen exigiendo titularidad. Las pantallas se actualizan al consultar,
volver al foco o, en accesos propios y estadísticas, cada 30 segundos.
La app WebView usa la misma API y política; no hay un segundo sistema de planes.

Este panel no implica un despliegue público: todavía se debe elegir alojamiento,
configurar HTTPS, respaldar base y clave de identidad y comprobar restauración.
No se contrató hosting ni se habilitaron cobros reales.

PlaySport conecta atletas, equipos, ligas y comunidades deportivas en una sola plataforma.

## Jugadas avanzadas del anotador

### Resumen final y revisión del cierre

Al finalizar, el anotador u organizador autorizado revisa el resultado,
confirma ganador/perdedor/salvador y selecciona mejor bate y MVP según el
reglamento de su liga. No existe una fórmula universal para MVP: el resumen
identifica estas decisiones como confirmadas, no como premios automáticos.
Un empate no adjudica W/L/SV. Si no se registraron pitchers, debe justificarse
su ausencia; no se inventan nombres para permitir cerrar un amistoso.

El reporte reúne pizarra por entradas, C/H/E, corredores dejados en base,
bateo/corrido individual y colectivo, pitcheo, defensa y jonrones con entrada,
pitcher e impulsadas. Las sustituciones conservan la participación, camiseta
y orden histórico, sin contar a la banca que no participó. Para dobles y
triples jugadas se marca el paso del recorrido en que ocurrió cada out; una
atrapada sencilla acredita únicamente el out a quien atrapó la pelota.
Créditos incompletos, fuentes antiguas sin respaldo y denominadores cero se
muestran como `ND` (No disponible), no como ceros inventados.

Los lanzamientos/strikes totales, WP/BK y PB o créditos faltantes pueden
completarse con números respaldados antes de confirmar el cierre. LR/SR
siguen significando lanzamientos/strikes **registrados**, no una estimación del
total. Los datos confirmados no pueden contradecir las jugadas ya anotadas;
la responsabilidad de BB y carreras heredadas se conserva entre pitchers.

Fórmulas: AVG = H/VB; OBP = (H+BB+GP)/(VB+BB+GP+SF);
SLG = (1B+2×2B+3×3B+4×HR)/VB; OPS = OBP+SLG;
PCL = CL×base/IP; WHIP = (H+BB)/IP; FLD = (PO+A)/(PO+A+E).
IP se calcula como outs/3, aunque se muestra como entradas.outs:
`5.1` significa cinco entradas y un out. Base de PCL: béisbol 9,
softbol 7, o regla del torneo `Base del PCL` = 7/9. Las carreras pendientes
de clasificación impiden calcular el PCL correspondiente. No se suman
promedios individuales para producir el promedio del equipo.

Referencias: glosario oficial MLB de [AVG](https://www.mlb.com/glossary/standard-stats/batting-average),
[OBP](https://www.mlb.com/glossary/standard-stats/on-base-percentage),
[SLG](https://www.mlb.com/glossary/standard-stats/slugging-percentage),
[ERA](https://www.mlb.com/glossary/standard-stats/earned-run-average),
[WHIP](https://www.mlb.com/glossary/standard-stats/walks-and-hits-per-inning-pitched),
[FPCT](https://www.mlb.com/glossary/standard-stats/fielding-percentage),
[asistencias](https://www.mlb.com/glossary/standard-stats/assist) y
[salvamentos](https://www.mlb.com/glossary/standard-stats/save).
La selección confirmada no sustituye las reglas particulares de elegibilidad
de abridores/relevistas de cada liga o modalidad de softbol. WAR, OPS+, wOBA,
FIP ajustado y Statcast requieren constantes, referencias o mediciones que
esta planilla no captura; no se presentan como calculados.

Acceso: el resumen básico permite consultar marcador y nombres de los
reconocimientos; las tablas detalladas requieren un acceso de prueba vigente
con detalle del resumen o la excepción local de la cuenta maestra. Los cobros
de membresías siguen pendientes. La práctica tiene sus propias cifras.
Registrar datos y confirmar el cierre no exige ver las estadísticas pagas.
La revisión se guarda con el cierre; deshacerlo retira sus decisiones y
permite corregir y volver a cerrar sin duplicar acumulados.

Endpoints GET: `/api/official-scoring/games/:id/final-report?tournamentId=...`,
`/api/accounts/scorecards/report?scope=...` y
`/api/friendly-games/:id/final-report`. El servidor decide el nivel de detalle;
las planillas completas de privados y amistosos pertenecen exclusivamente a
su creador; el participante vinculado solo puede recuperar sus propias cifras
mediante estadísticas personales. Todas las
respuestas usan `private, no-store` y rechazan parámetros de permisos o plan.
El proxy web de planillas privadas conserva la cookie de cuenta.

En el reporte web, «Imprimir / guardar PDF» imprime únicamente sus secciones,
sin navegación ni controles, con tablas divididas y formato A4 horizontal.
En la WebView nativa, el mismo botón envía el HTML del reporte al diálogo
local de impresión de Expo Print, validando el origen y sin abrir otra cuenta
en un navegador externo. La opción de guardar como PDF depende del diálogo
de impresión del sistema. No se transmite el reporte a un servicio externo.
Las compilaciones nativas anteriores deben reconstruirse para incluir Expo Print.
El ejercicio reutilizable «Resumen final · nueve entradas para revisar» en
`/demo/scoring-practice` prepara un 3–2 para comprobar revisión, reporte,
recarga e impresión sin modificar partidos existentes.

`IN PLAY` muestra las jugadas nuevas junto a las anteriores, en el mismo
grupo «Batazos y embasados» y con los mismos botones verdes, sin apartados
adicionales ni menús plegados, tanto en web como en Expo. Incluye base
intencional, jonrón dentro del campo, doble por regla, toque de bola,
sacrificios con error, tercer strike caído e interferencia/obstrucción del
receptor. Golpeado significa bateador golpeado por lanzamiento, no corredor
golpeado por un batazo.

«Toque de bola» reutiliza el resultado de toque existente y coloca al bateador
en primera con un botón directo, sin formulario de destinos ni un botón
duplicado. Conserva el tratamiento actual de las bases y sus avances forzados;
este cambio no añade nuevas decisiones sobre los corredores existentes.

Strike, Bola y Foul permanecen visibles y disponibles al abrir IN PLAY u OUT;
seleccionar esos modos no registra una jugada ni bloquea los lanzamientos.
Se bloquean mientras se guarda, se confirma una jugada pendiente o no hay
permiso para anotar. Un lanzamiento guardado vuelve a la fase de lanzamientos.

La base por bolas normal se registra con «Bola»: la cuarta bola termina el turno
y aplica los avances forzados. No existe un atajo «Base por bolas» entre los
botones verdes de web o app, ni en el selector móvil antiguo, para evitar
otorgarla por error con una cuenta incompleta. «Base intencional» se conserva
como resultado distinto. Los registros antiguos con base por bolas directa
siguen siendo legibles; guardar, recargar y deshacer conservan su resultado.
El ejercicio «Cuenta 2 bolas y 2 strikes» permite comprobar que la siguiente
bola lleva la cuenta a 3-2 y solo la posterior otorga la base.

Al tocar un corredor, «Out por regla» abre causas específicas: interferencia
del corredor, base omitida, falta de retoque tras un elevado, golpeado por un
batazo, interferencia ofensiva, salida del sendero para evitar el toque y otro
motivo descrito. La salida antes de lo permitido solo aparece para softbol.
Las apelaciones requieren identificar la base; todas las causas requieren
confirmar que el árbitro declaró out a ese corredor. No se presume el out
por recibir una pelota tirada ni por alejarse de la línea entre bases.
Se registra únicamente esa eliminación, sin completar el turno del bateador,
mover otros corredores ni anular retroactivamente jugadas o carreras.
Esas decisiones deben anotarse o corregirse por separado según el fallo arbitral.
Web, app, amistosos y anotación oficial guardan la causa y la base apelada;
la planilla marca «OR» y su detalle. Se puede cancelar, recargar y deshacer.
Los outs genéricos antiguos siguen siendo legibles sin inventarles una causa.
El ejercicio «Outs por regla · corredores en base» prepara tres corredores
y cuenta 2-2 en una práctica separada de los partidos existentes.

Al pulsar Strike con dos strikes, web y Expo piden «Abanicando (K)» o
«Cantado (ꓘ)» antes de guardar el tercer lanzamiento y el out. Cancelar no
modifica la cuenta. Las opciones aparecen justo debajo de Bola e IN PLAY,
dentro de lanzamientos, no al final de las columnas de jugadas.
No se ofrece un botón Ponche adicional en Outs y sacrificios: se registra
desde el tercer Strike. El tipo se
conserva en la planilla, historial y eventos oficiales; ambos siguen sumando
un solo ponche al bateador y al lanzador. Los ponches antiguos sin tipo
siguen siendo genéricos, sin asignarles retroactivamente «abanicando».
Si el tercer strike no fue retenido, se abre «Tercer strike caído» en el mismo
lugar, debajo de Bola e IN PLAY, y se confirman tipo, WP/PB y destinos,
sin suponer un out. El foul con dos strikes
en lento conserva su ponche reglamentario sin clasificarlo como cantado.
El ejercicio «Ponches · abanicando, cantado y tercer strike caído» muestra
los tres casos y deja otro turno con dos strikes para practicar, separado
de partidos existentes y con guardado/deshacer local.

Los errores nuevos identifican posición, defensor activo y fildeo o tiro;
se admiten varios errores y hits con avances por error sin convertirlos en
jonrones. Se confirman destinos e impulsadas; SH+E/SF+E no crean un out
automático. La concesión por interferencia se registra solo si se aplica:
si el manager conserva el batazo, se anota ese resultado.

El tercer strike caído exige dos strikes y primera libre o dos outs. Registra
ponche aunque el bateador alcance primera. WP y PB se distinguen sin cargar
errores al receptor; PB conserva el out virtual para reconstruir carreras.
Los avances dudosos siguen pendientes de revisión, nunca se adivinan limpias.

El reglamento se elige antes de la primera anotación, se guarda y puede
deshacerse. Los partidos oficiales reconocen Béisbol y las modalidades de
torneo Lento/Rápido/Modificado; los amistosos nuevos usan inicialmente béisbol
o sóftbol rápido, con las modalidades de sóftbol seleccionables antes de anotar.
No se permite cambiar el deporte declarado. En lento se bloquean toques
legales, concesión por golpeado, tercer strike caído y avances sobre
lanzamientos por robo/WP/PB/balk; foul con dos strikes termina en ponche.
Las condiciones particulares de cada competición requieren su reglamento:
esto no implementa automáticamente excepciones locales o reglas coed.

Los registros antiguos sin atribución siguen siendo legibles; no se asigna
retroactivamente un defensor. Las nuevas escrituras de planilla validan la
atribución en web, app y API. El protocolo antiguo `playEvent` conserva su
ruta y campos, pero exige un defensor activo para registrar errores nuevos.
El desglose oficial incluye cada error, también en hits con error y cuando
un mismo defensor comete varios en una jugada, sin duplicar los totales.
Los detalles conservan posición y tipo cuando fueron registrados; los datos
históricos que faltan permanecen sin atribución, nunca se inventan.

La pizarra por entradas muestra `E` por equipo. Cada planilla incluye `E`
por jugador y un bloque visible de errores defensivos por entrada, con
responsable, posición y fildeo/tiro. La actuación ofensiva marca `1B+E`,
`2B+E`, `3B+E` o avance por error sin cargar el error al bateador/corredor.
Los errores sin atribuir y los historiales incompletos muestran sus límites
explícitamente: un total individual desconocido es `—`, no cero.
Web y Expo incluyen el ejercicio reutilizable «Errores por defensor», separado
de partidos existentes, con varios errores y errores de ambos equipos.

La práctica reutilizable está en `/demo/scoring-practice`, enlazada desde la
planilla: corredor en tercera, bases llenas y partido nuevo para elegir
modalidad. Cada ejercicio usa su propia clave local, sin escribir partidos,
cuentas ni estadísticas oficiales.

### Una sola interfaz en web, móvil y app

La referencia de PlaySport es la web principal, adaptada a escritorio y móvil.
La app instalada carga esa misma interfaz en una WebView; Expo web integra la web
principal en vez del antiguo panel nativo. Su marco conserva el acceso a los
datos locales del antiguo puerto de Expo para recuperarlos solo bajo solicitud.
No mantiene otra cartelera, cifras
fijas de actividad ni estadísticas de perfil de ejemplo como si fueran reales.
Se inicia sesión en cada cliente con la misma cuenta; las cookies privadas no
se copian a JavaScript ni se comparten manualmente entre dispositivos.
La API, los permisos, los planes y las reglas deportivas son los mismos.
La app admite navegación atrás y recuperación explícita de los accesos antiguos
de AsyncStorage, sin borrarlos ni incorporar partidos automáticamente.

Para un teléfono configura `EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN=http://IP_DEL_SERVIDOR:3000`
antes de iniciar Metro y autoriza esa dirección en la API con
`PLAYSPORT_ADDITIONAL_WEB_ORIGINS=http://IP_DEL_SERVIDOR:3000`.
La API admite únicamente los orígenes web explícitos de esa lista y
`PLAYSPORT_WEB_ORIGIN`; no se abre CORS a cualquier sitio ni al puerto de Expo.
Estas variables de la API deben exportarse en su proceso de arranque.
Expo Go sin origen explícito usa el host de desarrollo y el puerto 3000.
`localhost` en un teléfono apunta al teléfono, no al ordenador.
Los builds publicados requieren configurar expresamente un origen HTTPS.
El móvil ya no necesita llamar directamente al puerto 4000.

Referencias reglamentarias: [WBSC, sóftbol lento](https://www.wbsc.org/en/organisation/softball/slow-pitch-softball),
[MLB, sacrificio de toque](https://www.mlb.com/glossary/standard-stats/sacrifice-bunt)
y [MLB, interferencia del receptor](https://www.mlb.com/glossary/rules/catcher-interference).

## Identidad visual

Web y app usan blanco para lectura, cabeceras negro/carbono y rojo para acciones
y acentos. La paleta nativa se define en `packages/shared/src/visual-theme.ts`;
las variables `--sport-*` de `apps/web/app/globals.css` mantienen los mismos
valores y una prueba comprueba su equivalencia. Los nombres CSS anteriores se
conservan como alias para no reconstruir componentes ni alterar sus recorridos.
Los colores de equipos, el diamante y las señales de éxito, advertencia y error
conservan su significado. Esta renovación no activa publicidad ni modifica
permisos, datos deportivos, planes o movimientos de dinero.

### Piloto de inicio deportivo web

Después de elegir cualquiera de los seis roles, el inicio conserva sus herramientas
y añade destacados, marcadores, filtros locales, oferta deportiva, noticia y un
franja de marcas debajo de la navegación global, sin recuadro.
`apps/web/app/sports-home-examples.ts` contiene los ejemplos
aislados de la jornada de referencia del 13 de noviembre de 2026.
Cada tarjeta abre su propia consulta de lectura en `/highlights/[slug]`; la pizarra
reutiliza el motor compartido y muestra únicamente conteo, nueve innings y carreras.
No se modifican partidos existentes, afiliaciones, favoritos, estadísticas de pago,
catálogo, stock, cuentas o dinero. Las selecciones ilustran la futura personalización,
pero no afirman que sean equipos del usuario. La franja usa los logos originales
de BERA, DIKU, BERACARS, RICCIEGROUP, INDUSTRIAS HEDA y XPRESS MOTORS, autorizados para esta prueba, sin afirmar contratos,
campañas ni seguimiento publicitario. Los archivos locales en
`apps/web/public/sponsors` conservan colores y proporciones; sus fuentes originales
figuran en `apps/web/app/sponsor-examples.ts`. No se incluyen otras marcas sin
autorización. La navegación permanece en una sola fila y se desliza horizontalmente
en pantallas pequeñas, sin quitar acciones ni modificar rutas o permisos.
Los seis logos permanecen en una sola fila también en móvil, con deslizamiento
horizontal para conservar su tamaño y legibilidad.
HEDA procede del perfil oficial enlazado por el usuario y RICCIE del perfil público
de la marca; se elimina únicamente el fondo blanco de HEDA y se recorta circularmente
el fondo de RICCIE sin cortar el logotipo ni cambiar sus colores.
XPRESS MOTORS procede del perfil enlazado por el usuario; se elimina únicamente
el fondo blanco y el margen exterior, conservando el dibujo y los colores originales.
El piloto se limita a la web; no se añade este contenido al inicio nativo todavía.

## Módulos

Auth, usuarios, organizadores, ligas, torneos, equipos, plantillas, jugadores, partidos, marcador en vivo, posiciones, honores, mapa de eventos, sedes y reseñas, noticias, moderación, scouting, medios, marketplace, patrocinadores y notificaciones.

## Requisitos

- Node.js 22.13+ (la base local de cuentas usa `node:sqlite`; probado con Node.js 26)
- npm 10+
- Docker (opcional, para PostgreSQL)

## Cuentas y acceso seguro local

Abre `/account` o «Mi cuenta · Acceso seguro» en la barra superior para crear
una cuenta, iniciar/cerrar sesión y cambiar la contraseña. Esta cuenta es
independiente de los perfiles ficticios: no hereda permisos deportivos,
no fusiona rosters y no modifica los partidos del demo.

La primera etapa usa SQLite persistente en
`apps/api/.local/accounts/accounts.sqlite` al ejecutar la API desde su workspace.
El archivo se puede configurar con `PLAYSPORT_ACCOUNTS_PATH`; `.local/` está
excluido de Git. Las contraseñas se guardan con scrypt, salt aleatorio y
comparación constante; se requieren de 15 a 128 caracteres al crearlas.
Los tokens de sesión se guardan únicamente como hashes. El navegador recibe
una cookie HttpOnly/SameSite=Strict, nunca un token en localStorage.
Las sesiones caducan tras 30 minutos sin consultar la API o a las 24 horas;
cambiar la contraseña revoca las sesiones previas y crea una nueva.
Los intentos de registro y acceso están limitados en la base persistente.

La web comunica `/api/accounts/*` con la API mediante un proxy del mismo
origen. `PLAYSPORT_ACCOUNTS_API_BASE` configura su destino (por defecto,
`http://localhost:4000/api/accounts`). `PLAYSPORT_WEB_ORIGIN` configura el
origen autorizado para solicitudes de escritura (por defecto,
`http://localhost:3000`). Para desplegar, se requiere HTTPS: con
`NODE_ENV=production` la cookie usa Secure y el prefijo `__Host-`.
El límite por conexión se aplica a la dirección de la conexión de la API;
un despliegue detrás de proxies necesita una política explícita de rate limiting
y de proxies de confianza, no confiar en cabeceras de IP enviadas por usuarios.

**No es autenticación de producción del ecosistema completo.** El demo
conserva sus endpoints y roles de prueba, separados del acceso a la cuenta.
La integración de roles deportivos reales, PostgreSQL, correo, recuperación
de contraseña y segundo factor es posterior.
El correo permanece no verificado y el dinero y las apuestas reales siguen desactivados.
Una sesión válida no equivale a identidad verificada ni a autorización
para usar dinero real. Usa datos ficticios durante las pruebas locales.

Los endpoints de cuentas son `POST /api/accounts/register`, `login`, `logout`,
`password` y `GET /api/accounts/me`. Las escrituras requieren el origen
autorizado. No hay endpoints para asignarse roles, autoverificar identidad,
fondear dinero real o restablecer la contraseña sin confirmar titularidad.
El transporte actual de cookies se ofrece en web; la integración móvil con
almacenamiento seguro y su transporte de sesión queda para una etapa posterior.

### Identidad personal global y privada

La cédula normalizada es la referencia personal única de todo el ecosistema;
no cambia por rol, torneo o equipo. Los UUID de cuenta se conservan como claves
técnicas para no romper billeteras, compras ni sesiones existentes. Una cuenta
básica permite entrar para completar la verificación; no constituye un perfil
personal verificado ni habilita inscripciones ajenas.

En `/account` se solicitan nombres, fecha de nacimiento, imagen legible de la
cédula y fotografía personal, con consentimiento explícito. En esta etapa local
deben usarse **exclusivamente datos e imágenes ficticios**. La subida deja la
identidad pendiente; nunca la aprueba automáticamente. Una restricción única
en SQLite impide reservar o verificar simultáneamente la misma cédula en dos
cuentas. Las solicitudes rechazadas liberan la reserva; una posible reserva
fraudulenta requiere revisión privada, no otro perfil duplicado.

La revisión es administrativa, no un permiso del organizador. Se configura
`PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID` en el servidor; en desarrollo local,
también puede revisar la cuenta de pruebas configurada privadamente. Nadie puede
aprobarse a sí mismo. El revisor comprueba datos y correspondencia documental/facial,
confirma expresamente el cotejo y registra decisión, motivo, revisión y fecha.
No se implementa reconocimiento biométrico automático ni se envían documentos
a terceros. La verificación manual tampoco activa dinero real.

Las evidencias se cifran con AES-256-GCM y asociación a la cuenta. La clave
privada `identity.key`, junto a la base de cuentas y con permisos 0600, debe
respaldarse por separado y protegerse con controles del servidor; cifrar no
sustituye esa protección. Los archivos no entran en Git ni almacenamiento web.
Solo el revisor autorizado puede consultar evidencias pendientes; se eliminan
al aprobar o rechazar. Se conserva el vínculo personal y la auditoría sin fotos.
La fotografía pública de cuenta sigue siendo independiente.

Endpoints privados: `POST /api/accounts/identity`, `GET identity-requests`,
`GET identity-evidence` y `POST identity-review`. La identidad confirmada viaja
solo con la cuenta propietaria; el directorio deportivo autorizado la resuelve
por cédula y reutiliza registros previos, sin publicar documentación ni crear
otra persona por cada rol. Los roles y endpoints históricos del demo siguen
siendo ficticios: esto no los convierte en un sistema completo de permisos de
producción. El transporte móvil autenticado continúa pendiente.

`/profile` usa la misma cuenta en todos los roles: si falta verificarla, abre
el flujo documental; después mantiene cédula, nombre y nacimiento fijados a
la identidad aprobada. Contactos, ubicación y datos complementarios se guardan
privadamente en `account_profiles`, no en perfiles distintos por alias.
`GET/POST /api/accounts/profile` exige titularidad y revisión optimista.
Los perfiles ficticios anteriores se conservan separados para probar el demo.

### Foto de la cuenta

La web permite guardar una foto desde «Mi cuenta» o «Mi perfil». Pertenece al
UUID autenticado, no al perfil deportivo: se muestra en el selector/inicio de
roles, la barra superior y la billetera del mismo titular. No cambia al pasar
entre roles y no verifica identidad. Sin foto se muestran las iniciales.
Los cambios de vista previa no se publican hasta pulsar «Guardar foto».

Se aceptan JPG, PNG o WebP de hasta 5 MB; el navegador prepara un JPEG de hasta
320 píxeles y 90.000 caracteres, sin los metadatos originales. La API privada
`POST /api/accounts/photo` valida sesión, origen, cuenta esperada, formato y
revisión optimista. Las claves de solicitud permiten reintentos sin duplicar
cambios, incluso después de reiniciar. Se permiten 30 actualizaciones por minuto.
La imagen actual se guarda en SQLite con la cuenta; no se guardan versiones
anteriores de la imagen en el historial de comandos. La API de cuentas sigue
en esquema 1: las tablas adicionales no reescriben cuentas ni sesiones.

La foto se sincroniza en la navegación y entre pestañas sin cambiar permisos,
perfiles, partidos o billeteras. Las fotos locales anteriores de los perfiles
demo no se asignan automáticamente a una persona: el usuario puede importar
explícitamente la del perfil seleccionado y guardar la foto de su cuenta.
No se publican estas imágenes en comentarios, anuncios ni perfiles ajenos.
La integración de foto de cuenta en móvil queda para una etapa posterior.

### Hoja deportiva por cuenta

Disponible desde «Mi hoja deportiva» y desde el módulo «Hoja deportiva» de todos los roles. El enlace anterior `/demo/player-career` dirige a `/sports-sheet`.

La disciplina predeterminada de la hoja y de estadísticas es **Béisbol / Softbol**.
Dentro de ella se distingue cada deporte: la ficha permite indicar béisbol,
softbol o ambos, y las estadísticas conservan sus grupos por deporte,
modalidad, categoría y base del PCL, sin sumar grupos incompatibles.
En esta etapa no se ofrecen otros deportes en el editor; cualquier selección
anterior se informa y conserva sin cambios. La pantalla inicial para elegir
otras disciplinas queda pendiente de su incorporación al ecosistema.

- Primera etapa: nombre deportivo, deportes, ciudad opcional, fichas de los roles disponibles, posiciones, dorsal, lateralidad y disponibilidad. Las fichas son declarativas: no otorgan permisos ni acreditan certificaciones.
- Una hoja persistida por cuenta, independiente del rol activo y del dispositivo. Guardado explícito con control de revisión, aislamiento de cuenta y recuperación idempotente de una respuesta de guardado incierta.
- Privada por defecto. Publicar exige marcar la opción y guardar; foto, ciudad, equipos y disponibilidad tienen controles independientes. La vista previa utiliza la misma proyección que el enlace público.
- La foto procede de la cuenta. Las pertenencias de jugador y manager proceden de su identidad verificada y de registros deportivos; no pueden añadirse desde la ficha. Las asignaciones no publicadas nunca se comparten.
- El enlace público usa una referencia aleatoria, no la cédula ni el ID de cuenta. No incluye correo, fecha de nacimiento, documentos, dirección exacta, saldo o conversaciones. Despublicar y guardar invalida la consulta; las vistas abiertas se actualizan por foco y cada 30 segundos, sin caché.
- Ejemplo reutilizable y de solo lectura en `/sports-sheet/example`, separado de perfiles y partidos reales; acceso visible desde la hoja de la cuenta local de pruebas.
- Las estadísticas y la trayectoria están disponibles en los apartados privados descritos abajo. Los logros se reservan para la siguiente etapa; los reconocimientos deberán proceder exclusivamente de resultados y estadísticas oficiales del ecosistema, nunca de carga manual.

API: `GET/POST /api/sports-sheet/me` (cuenta autenticada, POST con origen permitido) y `GET /api/sports-sheet/public/:ref` (solo proyección publicada). Persistencia en la base de cuentas existente, tabla `account_sports_sheets`.

### Estadísticas privadas de béisbol y softbol

Acceso desde «Mis estadísticas» en `/sports-sheet/statistics`. Incluye bateo/corrido de bases, pitcheo, defensa básica y registro por juego con versión, detalle y enlace a la planilla publicada. Los ejemplos tienen planillas reproducibles de solo lectura, separadas de cuentas y juegos reales.

Los registros oficiales se consultan automáticamente al entrar, sin selector
de fuente ni elección previa de deporte. Los filtros empiezan plegados y el
primer grupo disponible muestra su acumulado directamente. «Ver ejemplos»
es una acción opcional de la cuenta maestra; «Volver a mis estadísticas»
recupera la fuente oficial. No se muestran ejemplos automáticamente cuando
la cuenta no tiene actuaciones respaldadas.

- `GET /api/sports-sheet/statistics?mode=player|team&source=official|example`: autenticación obligatoria; requiere prueba vigente de Jugador (personal) o Manager (equipo), o la excepción local de la cuenta maestra. Sin capacidad vigente devuelve HTTP 403 `STATISTICS_PLAN_REQUIRED`, sin cifras. Solo la cuenta maestra consulta ejemplos internos. Un torneo pago no activa un plan personal; no se aceptan parámetros de identidad, permisos o plan.
- Los registros propios se vinculan a la identidad verificada y a las alineaciones/jugadas históricas, no a favoritos o fichas declaradas. El modo equipo consulta juegos cuyas alineaciones registran a esa identidad como manager. Las estadísticas no se incorporan al enlace público de la ficha.
- Acumulados recalculados desde la última versión persistida, sin otra base de estadísticas: solo juegos finalizados con jugadas y carreras que respaldan el marcador. Los juegos en curso son provisionales; suspendidos, protestados, resultados técnicos y anotaciones incompletas quedan fuera. Un cierre deshecho o una corrección reemplaza la versión anterior y nunca duplica un juego.
- Grupos separados por deporte, modalidad, categoría y base del PCL; filtros por temporada, liga, par exacto torneo/equipo, juego y fechas inclusivas. No se infiere el deporte por la duración. Falta de deporte/modalidad impide incluir un juego en el acumulado.
- AVG, OBP, SLG, OPS, WHIP y PCL se calculan con totales ponderados, no promediando promedios. IP conserva outs enteros: `5.1` representa cinco entradas y un out. Base predeterminada del PCL: béisbol 9, softbol 7; un torneo puede indicar `Base del PCL` = `7` o `9` en sus reglas personalizadas. El PCL colectivo usa carreras limpias del equipo. Carreras pendientes impiden calcular el PCL.
- «No disponible» no significa cero: decisiones de pitchers, juegos completos, blanqueos, PO/asistencias, participaciones defensivas, entradas por posición y métricas del receptor no se inventan. Los errores sin defensor no se reparten; un archivo de eventos truncado no permite certificar atrapados robando o errores individuales. Los pickoffs no cuentan como atrapado robando.
- LR/SR son conteos de lanzamientos y strikes/fouls registrados con los controles de conteo, no una estimación del total real. No se muestran cifras de pitcheo individuales si faltan responsables en el registro. Actualización por foco y cada 30 segundos, respuestas `private, no-store`.

### Trayectoria deportiva automática

«Mi trayectoria» en `/sports-sheet/career` reúne participaciones privadas por temporada, deporte, modalidad, categoría, liga, torneo, equipo y rol, con filtros combinables y fechas inclusivas. No hay editor de historial ni un almacenamiento paralelo: la lectura se recalcula desde los juegos oficiales persistidos y conserva la última versión de cada juego.

- `GET /api/sports-sheet/career?source=official|example`: cuenta autenticada, identidad verificada para datos propios, caché `private, no-store`. Requiere trayectoria habilitada por prueba vigente o la excepción local de la cuenta maestra; sin capacidad devuelve 403 `CAREER_PLAN_REQUIRED`, sin historial. Solo la cuenta maestra consulta ejemplos internos. Se rechazan IDs ajenos, permisos, modos, parámetros adicionales o repetidos y escrituras.
- Jugador: alineación inicial/actual, cambios aprobados y jugadores de las jugadas. Un sustituido conserva su participación; asistencia al banco o inscripción no la acreditan. Manager: identidad del responsable registrado en la alineación histórica, incluidos alias de actor vinculados a la misma identidad. Nunca se utiliza la ficha declarada, el rol elegido o el roster actual para crear antecedentes.
- Anotador y organizador: solo intervenciones firmadas en los estados efectivos y archivos de suspensión conservados en el juego. Tener permiso, organizar un torneo actualmente o estar asignado no acredita haber intervenido en un partido. Los roles de fanático y scout todavía no tienen una fuente de participación acreditable.
- Juegos programados o sin acciones registradas quedan fuera. Finalizados, en curso, suspendidos, bajo protesta y resultados técnicos se distinguen; solo finalizados sin resultado técnico cuentan como finalizados. Los conteos de juego son únicos aunque una persona tenga dos roles. Correcciones y cierres deshechos reemplazan la versión anterior.
- Los intervalos muestran primera/última **fecha de partido registrada**, nunca fechas de contratación, bajas, transferencias o antigüedad. Datos ausentes se indican explícitamente; no se infiere temporada desde el calendario. La clasificación deportiva procede del documento actual persistido del torneo, no de una reconstrucción de cambios de nombre o de reglamento.
- La trayectoria no contiene cifras de bateo/pitcheo, cédulas, IDs de actor o datos de cuenta; no se publica con la ficha básica. Los detalles muestran el respaldo y la versión, con acceso a planilla únicamente si está publicada. Refresco por foco y cada 30 segundos, con errores explícitos que retiran el historial anterior.
- Ejemplo separado con temporadas 2025/2026, dos equipos, béisbol/softbol, roles de jugador/manager y un juego en curso; planillas reproducibles de solo lectura. No escribe cuentas, rosters o juegos existentes ni adjudica logros.

## Pizarra en vivo de jugador y manager

La pizarra de estos roles requiere una cuenta autenticada y abre directamente las tablas de anotación y el resumen,
en solo lectura. Incluye únicamente juegos con estado `in_progress` y una
pertenencia del rol al equipo local o visitante en ese mismo torneo; los filtros
de cartelera, la zona y los favoritos nunca amplían ese alcance. Si hay varios,
se puede elegir entre ellos sin cambiar el equipo de trabajo. Un enlace directo
también debe cumplir ambas condiciones. Sin juegos elegibles se muestra un aviso;
no se sustituyen por partidos programados, finalizados o de otros equipos.
Los cambios de estado recibidos en vivo retiran el juego de esta vista.
La pizarra resumen agrupa bolas, strikes y outs en un bloque compacto entre
el título y el diamante de bases, en la misma fila en escritorio y móvil.
Debajo del marcador aparecen los controles de corredores en base; las tarjetas
«Al bate», «Sigue» y «Luego» ocupan su lugar anterior en el panel de jugadas.
Esta distribución es compartida por las pizarras oficiales, privadas, de
amistosos y de consulta, sin cambiar sus acciones ni permisos.
El cronómetro junto al conteo arranca al guardar el primer lanzamiento o jugada
y se reanuda si estaba pausado, conservando el tiempo acumulado y sin sumar la
pausa anterior. Se mantiene «INICIAR TIEMPO» para iniciarlo manualmente.
En partidos oficiales solo lo controla el organizador o anotador asignado;
los demás roles consultan el mismo tiempo, guardado en el servidor y difundido
en vivo. Permite pausar y reanudar sin reiniciar; el cierre, la protesta y la
suspensión detienen el conteo. Reprogramar no reanuda el reloj por sí solo;
el siguiente lanzamiento o jugada válida lo reanuda.
Una suspensión que reinicia el juego completo archiva el tiempo anterior y
requiere un nuevo inicio manual o mediante una nueva jugada. Deshacer jugadas
no altera el cronómetro. Abrir opciones, cancelar, revisar anotaciones o
modificar alineaciones/reglamento no lo activa; los guardados fallidos tampoco.
Los amistosos conservan su propio reloj, controlado por su creador; un
seguimiento privado conserva un reloj local identificado como «Tiempo privado».
La práctica de Expo conserva su reloj local de la misma manera. Recargar o
reproducir el historial no inicia ni reanuda el reloj. Los partidos antiguos
no reciben una hora de inicio inventada: si se sigue anotando uno sin reloj,
el tiempo se mide desde esa nueva anotación, no desde las jugadas anteriores.

## Navegación móvil

La web en pantallas de hasta 700 px y la app muestran siempre una barra inferior
con Inicio, Mi cuenta, Elegir rol, Marketplace y Cartelera, incluida la bienvenida.
Inicio y Elegir rol conservan el regreso a la bienvenida sin cerrar la cuenta.
La barra respeta las áreas seguras del teléfono, reserva espacio para no tapar
contenido y bloquea los cambios de pantalla mientras se guardan datos o hay un
error pendiente de borrador. El escritorio mantiene su navegación superior.
En la web móvil se oculta el menú superior para no duplicar la barra inferior;
se conservan el botón Volver atrás, la identidad y los logos. Mis favoritos
permanece accesible dentro de Mi cuenta en móvil.
La app conserva sus grupos de módulos como pestañas dentro del inicio y sus
enlaces autenticados a la web; Mi cuenta dirige siempre al centro web seguro y
Cartelera permite consultar los partidos públicos sin adoptar una identidad.

## Mi cuenta unificada

### Acceso local de pruebas desde el teléfono

Con web y API locales activos, `npm run demo:mobile` publica la web en una
dirección privada de la red, puerto 3100. Imprime un enlace de cuenta maestra
válido durante 30 minutos y para un solo uso. Compártelo únicamente con quien
deba probar la cuenta: abre una sesión real de la cuenta ficticia ya configurada
en los archivos privados locales, sin mostrar ni cambiar su contraseña.
Después del primer acceso se puede volver al enlace base desde ese navegador.
No se comparten automáticamente las sesiones de Chrome con el teléfono.

El acceso temporal valida el host y el origen de las operaciones antes de
dirigirlas a la web local, sin ampliar los orígenes permitidos en la API ni los
permisos de la cuenta. Solo admite una IP privada, no funciona en producción
y se detiene con Ctrl+C. `PLAYSPORT_MOBILE_DEMO_IP` y
`PLAYSPORT_MOBILE_DEMO_PORT` permiten elegir interfaz y puerto.
Para abrir directamente el anotador, usa
`PLAYSPORT_MOBILE_DEMO_ROLE=scorekeeper npm run demo:mobile`. El enlace inicia
la cuenta maestra, selecciona ese rol y retoma su partido en curso; no reinicia
el marcador ni elimina anotaciones. Si no hay un partido vigente y habilitado,
se mantiene la selección normal de partidos asignados.
Ambos dispositivos deben estar en la misma red de confianza: se utiliza HTTP
local, no un acceso público. No publiques el enlace ni el puerto en Internet.
Las consultas deportivas de la web usan rutas del mismo origen por defecto,
también para rosters, partidos y registro familiar. Next dirige esas rutas a
`PLAYSPORT_SPORTING_API_BASE` (por defecto `http://localhost:4000/api`) en el
servidor: el teléfono no intenta conectarse a su propio `localhost`. Las cookies,
las autorizaciones familiares y las comprobaciones de permisos se conservan.

La cuenta maestra abre estadísticas y trayectoria con sus ejemplos de solo
lectura por defecto; conserva la opción de consultar registros oficiales.
Las cuentas normales mantienen la fuente oficial. Este acceso no crea datos,
no verifica identidades, no habilita dinero real ni convierte funciones
pendientes en funciones implementadas.

`npm run demo:master` prepara, solo para la cuenta maestra ficticia, una hoja
privada con seis fichas si aún está completamente vacía y una recarga de
100 USD_DEMO si la billetera no tiene saldo ni historial. La recarga sigue el
flujo real de solicitud con comprobante sintético y autorrevisión explícita de
pruebas, únicamente si esa cuenta ya tiene permiso de revisión. No añade
permisos, no sustituye datos guardados y no repone un saldo que ya se gastó.
Puede retomar su propia solicitud pendiente sin duplicar la recarga. No envía
dinero, no publica la hoja ni realiza compras, pujas o anotaciones.
También prepara dos amistosos privados con alineaciones completas, de béisbol y
softbol, pertenecientes a la cuenta maestra autenticada y disponibles con ella
en todos sus roles y dispositivos. No cambia la titularidad de los amistosos
anteriores ni sustituye sus accesos. Los antiguos accesos de ejemplos se pueden
revisar e incorporar expresamente desde Mi cuenta → Mis datos guardados.

Mi cuenta es el único acceso global al espacio personal en escritorio, web
móvil y app. Su centro reúne Mi perfil, Mi hoja deportiva, Mi billetera y
Seguridad. Las rutas anteriores se conservan; dentro de cada sección hay un
regreso al centro. La hoja deportiva deja de repetirse entre los módulos de cada
rol y el encabezado ya no muestra accesos separados a perfil, hoja y billetera.

El centro requiere una cuenta autenticada, no un rol seleccionado. El perfil
personal tampoco admite el antiguo acceso local por alias de rol sin sesión.
La cartelera y la exploración del marketplace siguen siendo públicas; las
operaciones conservan sus comprobaciones actuales de cuenta y permisos.
La app abre el centro web autenticado, sin crear una segunda identidad ni
presentar un perfil local como si fuera una cuenta real.

La sección Seguridad conserva el acceso con contraseña, el cierre de sesión
y el cambio de contraseña existentes. Passkeys, biometría, segundo factor y
recuperación por correo aún no están habilitados; esta reorganización no cambia
la política de sesiones ni activa operaciones con dinero real.

## Anotación guiada por etapas

Los controles comienzan con Strike, Foul, Bola, IN PLAY y Deshacer. IN PLAY se
distingue en verde de los botones de lanzamiento y
habilita los batazos y OUT abre los outs y sacrificios; ninguno de esos dos
botones registra una jugada. En escritorio los grupos inactivos permanecen
deshabilitados y en móvil se ocultan para mostrar solo la etapa activa.
Volver conserva el conteo y las bases. Una jugada guardada devuelve los controles
a lanzamientos; si falla, conserva la etapa para reintentar. Deshacer mantiene
su disponibilidad independiente, incluso cuando no se permiten nuevas jugadas.
Las jugadas sin batazo siguen en una sección plegable y en los controles de bases.
Los dobles y triples plays requieren elegir explícitamente los corredores
eliminados y confirmar, sin suponer quién fue out. El out forzado permite elegir
entre el bateador y los corredores realmente forzados; si sale un corredor,
el bateador llega por selección y no se registra como eliminado.

La app conserva su acceso a la anotación web autenticada y recibe el mismo
diseño compacto en el navegador móvil; no se habilita el formulario nativo
antiguo ni se cambian sesiones, permisos, planes, cronómetro o motor deportivo.

### Favoritos por cuenta

«Mis favoritos» permite buscar equipos, jugadores y ligas públicos y marcarlos
con una pelota de béisbol propia: contorno al desmarcar, relleno y costuras rojas
al marcar. El botón indica su estado con `aria-pressed` y funciona con teclado.
Los favoritos se guardan en la base de cuentas y se comparten entre roles,
pestañas y dispositivos autenticados. No dependen de la identidad verificada.

Los selectores de equipos, ligas y torneos priorizan favoritos sin cambiar la
selección activa. Cartelera y pizarra priorizan sus partidos y ofrecen «Solo mis
favoritos», siempre respetando fecha, ubicación y alcance elegidos. Un jugador
favorito relaciona los partidos de sus equipos y torneos publicados; no presume
que estará en el lineup de cada partido. En posiciones se priorizan torneos,
pero nunca se reordenan equipos ni se excluyen rivales de una clasificación.

Solo se ofrecen nombres y pertenencias ya públicos. Las referencias de jugadores
son opacas y persistentes; no contienen cédulas, datos de contacto ni estadísticas
reservadas. Marcar favoritos no concede permisos, cambia inscripciones o activa
notificaciones. Los equipos, ligas y jugadores de ejemplo se ofrecen únicamente a la cuenta local
de pruebas. Las escrituras verifican cuenta, origen, catálogo y una clave
idempotente; un envío incierto se reintenta con la misma solicitud o se consulta
su estado guardado, sin mostrar un éxito no confirmado.

### Logos de equipos, torneos y ligas

No hay accesos separados de «Logos» en los menús. En las pantallas web, el manager
u organizador autorizado mantiene presionado durante 600 ms el logo o su espacio
y confirma «¿Deseas cambiar el logo?» antes de abrir el editor en la misma pantalla.
Un toque corto no abre el editor; soltar antes de tiempo, mover el puntero o
cancelar el gesto impide abrirlo. Con teclado se usa Enter o Espacio sobre el logo;
si está dentro de un enlace o selector, Mayús+F10 sobre ese control.
Los permisos se consultan por cuenta, rol e identidad exacta, no solo por rol.
En Mis inscripciones no se permite editarlo
si la inscripción está enviada a revisión o retirada; la API conserva los mismos bloqueos.
El organizador puede mantener presionado
el de su torneo o liga. Las nuevas inscripciones conservan la propiedad
del manager: el organizador no puede sustituir su logo. La identidad visual es compartida,
no una imagen personal ni una copia por rol. Se usa el ID estable del equipo o
torneo o liga, nunca se fusionan identidades solo porque sus nombres coincidan.
Al guardar una ficha con nombre de liga nueva se crea una identidad propia.
Otros torneos pueden seleccionar esa liga existente y compartir su logo sin
compartir el del torneo. Los registros anteriores se conservan; una liga indicada
solo por nombre obtiene su identidad al guardar de nuevo la ficha.

Los logos aparecen junto a los nombres en el inicio y selector de equipos,
roster, tarjetas de alineación, entregas, partidos asignados, pizarra y planillas,
cartelera oficial, clasificación, resultados, protestas y maqueta de apuestas
vinculada a un partido oficial. Las opciones nativas de los selectores conservan
texto; el logo acompaña la identidad seleccionada en la vista.

En la web de demostración, los equipos sin logo guardado muestran emblemas
vectoriales ficticios con colores, formas e iniciales consistentes. También
aparecen en los ejemplos históricos, clasificación, apuestas y amistosos
privados. No son marcas reales ni imágenes guardadas: no modifican los
partidos ni la base de datos. El editor permite
reemplazarlos al guardar un logo propio, que siempre tiene prioridad. Si se
quita explícitamente un logo guardado, se respeta esa eliminación y no reaparece
el emblema de ejemplo. Los ejemplos sin vínculo institucional no adoptan por
nombre el logo subido de otro equipo. No se modifica la aplicación móvil.

### Estado oficial permanente y permisos por cuenta

La API guarda el agregado deportivo completo en
`.local/official-scoring/state.sqlite`, relativo al directorio de ejecución
(`PLAYSPORT_OFFICIAL_STATE_PATH`). Incluye partidos, lineups, personal,
estadísticas, historial de deshacer, asignaciones, identidades, suspensiones y
actas. El registro familiar y las reglas de roster se importan una sola vez
desde el JSON anterior y pasan a la misma base; el JSON se conserva sin borrar,
pero deja de ser la fuente activa. No hay que volver a sembrar tras reiniciar.

SQLite usa WAL y sincronización FULL. Cada operación confirma conjuntamente
estado y registro antes de responder o emitir eventos en vivo. Un error revierte
ambos; una base dañada o previamente inicializada que desaparezca impide arrancar
en vez de presentar juegos vacíos. El formato interno versionado conserva
Map/Set y comprueba integridad. La base, su marcador `.initialized` y sus copias
son privados; para respaldar WAL usa un respaldo consistente de SQLite o detén
la API, no copies solamente el archivo principal mientras está escribiendo.
Se admite un proceso escritor por base: una instancia con una revisión vieja
rechaza la escritura, no sobrescribe otra instancia.

Una cuenta con identidad verificada puede crear y administrar sus propios
torneos. Asigna anotadores mediante sus cédulas verificadas en el calendario;
el servidor las vincula a la identidad global y exige asignación en ese juego.
Cada manager conserva exclusivamente sus inscripciones. Se validan cookie,
origen y pertenencia en el servidor; cambiar el rol visual no concede permisos.
Los aliases demo solo admiten operaciones con la cuenta local de pruebas y no
funcionan como credenciales de producción. La verificación documental conserva
su revisión administrativa existente; no se activan membresías ni cobros.

Como el transporte autenticado nativo todavía está pendiente, las acciones
oficiales del móvil (roster, lineup, gestión y anotación) abren sus módulos web
con la sesión de la cuenta, igual que Crear torneo. No intentan operar con un
alias demo sin autenticar. Configura `EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN` para
dispositivos físicos. La cartelera, las pizarras y los resultados públicos
conservan su consulta nativa.

### Inicio enfocado del jugador

El recuadro de inicio permite elegir uno de los equipos donde la identidad
verificada figura como jugador en un roster aprobado. Elegirlo abre por defecto
su torneo completo en cartelera, pizarra y posiciones. Los tres módulos comparten
filtros de equipo, torneo, liga, municipio, estado y todos los torneos; la elección
se conserva por cuenta en esta pestaña, sin modificar inscripciones ni el perfil.
La zona inicial proviene del perfil guardado. Sin roster se ofrece explorar esa
zona, no se asigna un equipo ficticio a una cuenta real.
La consulta territorial de partidos utiliza la sede; posiciones selecciona los
torneos de esa zona pero calcula siempre todos sus resultados, no una tabla parcial.
La cartelera del jugador permite todas las fechas o un día concreto y no mezcla
juegos de ejemplo ajenos a su selección. Los demás roles conservan sus vistas.
Junto al selector de fecha, las carteleras ofrecen «Ayer», «Hoy» y «Mañana»,
calculados respecto al día actual de Venezuela, no a la fecha consultada.
El atajo seleccionado queda resaltado; conserva los demás filtros y la fecha
elegida se recupera al volver o recargar. El calendario manual sigue disponible.

El demo incorpora un recorrido visible y permanente de jugador con tres equipos:
**Cóndores del Ávila** (Liga Metropolitana, resultados finalizados),
**Guardianes del Lago** (Liga del Lago, pizarra en curso) y **Toros de Maracay**
(Liga del Centro, partidos programados). Se eligen desde el selector de equipo
en el inicio del jugador y en sus tres módulos.
Reutiliza los juegos ficticios archivados de noviembre de 2026 y sus detalles,
con identificadores separados y acceso de solo lectura; no siembra ni modifica
partidos oficiales, cuentas ni rosters. Las cuentas reales no reciben estos
equipos como inscripciones. La cartelera general ofrece también «Ver partidos
del 5 de noviembre», sin cambiar la ubicación del perfil.

La cartelera usa una composición propia de una columna para encabezados y filtros,
y una cuadrícula interior de tarjetas (dos columnas en escritorio, una en móvil).
No reutiliza las doce columnas del panel de gestión. Antes de mostrar cambios,
se comprueban visualmente anchuras reales y alineación de estas secciones en
escritorio y móvil, además de ausencia de desbordamiento.

### Inicio enfocado del manager

Los seis roles reúnen sus módulos en una sola fila adaptable de botones
compactos dentro del recuadro principal, sin tarjetas de navegación ni accesos
duplicados. Se conservan las rutas, los permisos y las indicaciones de funciones
parciales o pendientes. Las inscripciones y la selección operativa del manager
se despliegan dentro del mismo recuadro; sus formularios no cambian.

El encabezado de cada rol muestra solamente el nombre guardado de la persona
y el rol activo. Se prioriza el nombre de la identidad de la cuenta; sin cuenta
se usa el perfil local guardado del rol, nunca el equipo ni un identificador
técnico. Si falta el nombre, se muestra «Mi perfil» sin inventar una identidad.
Web y móvil no repiten avisos de «ficticio», «demo» o «demostración» en sus
pantallas. Esto no migra datos, no otorga permisos ni habilita dinero real:
se conservan los controles de acceso, solo lectura y confirmación de operaciones.

En las consultas del jugador y manager, «Estado / entidad federal» siempre
significa ubicación geográfica (Trujillo, Mérida, Barinas, Apure, etc.). Está
visible sin desplegar los filtros y permite consultar todo un estado o uno de
sus municipios. La situación del juego (pendiente, en curso, finalizado) sigue
disponible como filtro opcional separado, sin confundirse con la ubicación.
La opción «Todos los estados» abre una consulta general sin limitarla por
entidad, municipio, equipo, liga o torneo; conserva los demás filtros opcionales
de la cartelera y no modifica el perfil ni el equipo de trabajo. También está
disponible en la cartelera general de los otros roles, donde mantiene la fecha
e incluye partidos con sede territorial pendiente sin inventar su ubicación.

El manager comparte el selector de equipo y los filtros de cartelera, pizarra
pública y posiciones del jugador, pero sus equipos reales se obtienen de
`GET /api/registration/roster/manager-teams`: requiere sesión, toma la identidad
verificada de la cuenta y no acepta parámetros de identidad. Incluye sus
inscripciones pendientes y excluye equipos retirados o inscripciones ajenas;
no depende de que el manager figure como jugador ni de un roster aprobado.

La selección de consulta se guarda por cuenta y rol, separada del jugador.
Inicialmente sigue el equipo de trabajo disponible. Cambiar una consulta no
cambia el equipo operativo ni concede permisos: el selector original de trabajo,
el roster, las inscripciones y los lineups siguen accesibles desde el inicio.
Al elegir expresamente otro equipo de trabajo, las consultas se reorientan a
ese torneo. La tarjeta «Pizarra en vivo» abre la consulta; los enlaces operativos
de partidos y panel del equipo conservan sus rutas.

En demo se pueden consultar los mismos tres equipos ficticios de distintas
ligas, además del equipo de trabajo del demo. Son ejemplos de solo lectura y
nunca se convierten en equipos autorizados para preparar roster o lineup.

### Crear y administrar torneos

El organizador dispone del módulo **Crear torneo**, en `/demo/tournaments`.
La selección de torneos, las acciones de guardado y la navegación del editor
están separadas. El menú es lateral en escritorio y una cuadrícula uniforme en
pantallas pequeñas, con botones de acción alineados de al menos 44 px de alto.
Los borradores privados se guardan en la API con solo el nombre de la liga o
torneo; no se exige segunda fase, calendario completo ni cobro. La ficha admite
temporada, deporte/modalidad/categoría/rama, referencia territorial del catálogo,
contacto público opcional, enlaces de ubicación, redes y sedes independientes.
El importe de inscripción permite borrar y escribir el monto sin reinsertar
un cero inicial. Vacío equivale a inscripción gratuita; los importes se siguen
guardando en centésimas de crédito y no generan cobros automáticos.
En sóftbol, Modalidad ofrece **Lento**, **Rápido** y **Modificado**, sin selección
automática. Béisbol mantiene su campo independiente. Cambiar de deporte limpia
la modalidad para no trasladar una opción incompatible. Los valores antiguos
se conservan al consultar y guardar; una modalidad antigua de sóftbol se muestra
como guardada y puede reemplazarse explícitamente desde el selector.

El módulo permite:

- Agregar fases progresivamente, con grupos, participantes ordenados, vueltas,
  series, cantidad de clasificados y reglamento propio. Un selector superior
  de cantidad de grupos comienza en 1 y permite elegir hasta 8. Todos comparten
  las reglas de la fase y el reglamento del torneo. Al reducir grupos se pide
  confirmación: los equipos siguen en la fase y los de grupos retirados quedan
  pendientes de reasignación. Cada grupo, incluido el único, tiene un cupo
  explícito y clasificados opcionales propios; los grupos pueden tener tamaños
  distintos. Se muestra cuántos equipos hay asignados y cuántos faltan, se
  impide superar el cupo o clasificar más equipos que el cupo, y no se generan
  cruces hasta completar todos los cupos y asignaciones. Los documentos antiguos
  sin estos campos siguen abriendo sin cambios, pero deben definir los cupos
  antes de generar cruces nuevos. No se reparten automáticamente los
  clasificados totales de una fase antigua entre sus grupos.
  Un grupo reúne a todos. Se generan vueltas de
  todos contra todos y una ronda de eliminación por siembra o sorteo. Para
  suizo, doble eliminación, repechajes, pases libres y otras variantes se
  agregan cruces personalizados por ronda, incluso con plazas pendientes.
  Los clasificados se confirman expresamente: no se inventan ganadores ni
  desempates. En series se generan solo los juegos garantizados; los decisivos
  se agregan cuando correspondan.
  «Serie al mejor de» solo aparece en eliminación directa, doble eliminación
  y repechaje. En todos contra todos, el calendario depende exclusivamente de
  grupos y vueltas, incluso si un documento antiguo conserva otro valor de
  serie. No se modifican los partidos ya guardados.
- Crear inscripciones independientes por torneo indicando únicamente la cédula
  del manager, sin reutilizar equipos por nombre, logo o coincidencia de roster.
  La asignación aparece en **Mis inscripciones de equipos** al entrar en Manager
  con la cuenta cuya identidad esté verificada. Si no está verificada o no existe,
  permanece pendiente; escribir una cédula o elegir un alias no permite reclamarla.
  El manager prepara nombre, contacto, observaciones, logo, jugadores y personal
  técnico, y envía la inscripción a revisión. El organizador revisa
  personas reales del registro del ecosistema y aprueba una firma de esa versión;
  también puede solicitar correcciones. El envío bloquea cambios del manager
  hasta la devolución; una incorporación posterior requiere nueva revisión antes del lineup o inicio.
  La incorporación individual sigue siendo del manager y el lineup continúa
  separado del roster. El equipo y torneo de trabajo se eligen en el inicio del
  manager, no mediante nuevos selectores dentro del roster o la alineación.
  Las inscripciones pueden prepararse antes de publicar; siguen siendo privadas.
  Las asignaciones antiguas del demo se conservan sin migrar nombres ni partidos.
- Registrar bloqueos administrativos con motivo privado y alcance, retiros que
  conservan historial y sanciones de equipos/jugadores por torneo o fase, fechas
  o partidos pendientes. El organizador registra el cumplimiento; no se descuentan
  juegos suspendidos ni se adjudican derrotas o cobros automáticamente.
- Programar semanalmente fechas, horas de Venezuela, sedes, duración y anotadores.
  Se detectan superposiciones por equipo, cancha y anotador, incluidos intervalos
  que cruzan medianoche. En el cruce con partidos oficiales anteriores que no
  registran duración se reserva una ventana estimada de dos horas.
- Publicar ficha, reglamento y comunicados visibles desde todos los roles. La
  lista del inicio y la ficha pública se actualizan por foco y cada 30 segundos;
  no se simulan correos ni notificaciones externas. Motivos de impago, sanciones,
  identificaciones del manager y roster privado no se publican.

`/api/tournaments` usa la sesión de cuenta, origen permitido, propietario,
revisión optimista, comandos idempotentes recuperables y auditoría por versión.
La administración pertenece a la cuenta organizadora verificada; el alias
`org-demo` se conserva únicamente para la cuenta local de pruebas. No constituye
un sistema de membresías. La API guarda planes,
identidades vinculadas y versiones en `.local/tournaments/tournaments.sqlite`
(`PLAYSPORT_TOURNAMENTS_PATH`). El cuerpo del proxy y el parser JSON de la API
están limitados a 1 MiB, para admitir planes que superen el límite predeterminado
de 100 KiB de Nest.

Publicar conecta equipos con manager y cruces resueltos a los partidos oficiales.
Sin fecha, hora y ubicación válida todavía no aparecen en la cartelera territorial.
Los cruces de otros deportes pueden planificarse, pero no se activan en el motor
de anotación de béisbol/sóftbol. Los planes se reconstruyen al iniciar la API;
el marcador oficial se restaura desde su base permanente. No se reescriben
encuentros con alineaciones o anotación; su
reprogramación y decisiones técnicas usan las herramientas oficiales existentes.

El recorrido web enlaza inscripción del manager, aprobación del roster, entrega
de ambos lineups y anotación del oficial asignado. Las escrituras oficiales
(anotación, asignación de anotador, ubicación, suspensión y protesta) envían la
sesión de cuenta también cuando la API está en otro origen autorizado.
Al cerrar un juego se ofrece **Consultar y compartir resultado oficial**.
El detalle de cartelera y la ficha pública del torneo permiten copiar su enlace
exacto o compartirlo por WhatsApp, sin identificaciones privadas ni permisos de
edición. El enlace consulta el estado oficial vigente; no inventa un resultado
ni una publicación externa. Si el portapapeles falla, se informa y queda el
enlace seleccionable para copiarlo manualmente. Para compartir fuera del equipo
local se necesita un origen web accesible al destinatario, no `localhost`.

La prueba integrada de `apps/api/test/tournaments.test.cjs` usa cuentas y archivos
temporales aislados: dos managers verificados, nueve jugadores por roster,
aprobaciones, calendario publicado, dos lineups, anotación, cierre y consulta
pública. No modifica los juegos del servidor de desarrollo. Esto no elimina
la necesidad de respaldos operativos, revisión de identidades y despliegue
seguro. También se prueba el recorrido con cuentas verificadas distintas y
reinicios, sin permisos derivados de los aliases demo.

El importe de inscripción es informativo y ficticio: no crea una segunda
billetera ni ejecuta pagos. El módulo móvil abre esta administración en la web
con `EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN`; no presenta un editor nativo incompleto.

### Formatos y almacenamiento de logos

La selección permite JPG, PNG y WebP hasta 5 MB, preparados en el navegador a
320 píxeles y 90.000 caracteres como máximo. PNG y WebP conservan transparencia;
JPEG conserva su fondo. La preparación elimina los metadatos originales. La
vista previa y quitar logo no se publican hasta guardar. Los cambios se
sincronizan en la misma pestaña, por notificación entre pestañas, al volver a
enfocar y mediante consulta periódica cada 30 segundos.

La API `institutional-logos` publica metadatos e imágenes sin datos de auditoría
o credenciales. La edición requiere sesión autenticada, origen correcto,
cuenta esperada, revisión optimista y solicitud idempotente. En esta demo solo
la cuenta privada de pruebas puede usar sus perfiles autorizados `mgr-A`,
`mgr-B` y `org-demo`, limitados además a las asignaciones deportivas existentes.
Seleccionar un rol no otorga permisos de producción; la vinculación de
administradores reales a sus instituciones sigue pendiente.

Los logos y el registro privado de quién cambió qué se guardan en
`.local/identity/logos.sqlite` (o `PLAYSPORT_LOGOS_PATH`) con esquema independiente
1. La auditoría conserva IDs, rol, revisión, fecha y hash de solicitud, no
versiones anteriores de la imagen. Se permiten 30 cambios por cuenta/minuto.
La base no reescribe partidos, registros personales, fotos de cuenta, comercio
ni billeteras. Los logos privados de ligas solo los consulta su cuenta propietaria;
se hacen públicos cuando la liga participa en un torneo publicado. Su identidad
se conserva en `tournament_leagues`, dentro de la base de torneos.

## Billetera única de pruebas

`/wallet` muestra la billetera persistente de la **cuenta autenticada**, no del
perfil deportivo. Se abre desde la navegación, «Mi cuenta», los perfiles y el
marketplace; móvil abre la misma página web y requiere su sesión web.
Existe un saldo común en USD ficticios: disponible, retenido y total. No hay
billeteras ni fondos separados por servicio. Apuestas e inscripciones de torneos
todavía no están conectadas; la maqueta de apuestas mantiene solo sus créditos
locales, claramente separados del saldo real de esta cuenta de pruebas.

La pantalla ofrece **transferencia bancaria, Pago Móvil, Zelle y Binance Pay**
con destinos deliberadamente no operativos. Recoge titular/remitente ficticio,
fecha, referencia y los campos correspondientes al método: banco y últimos
cuatro dígitos de cuenta/documento; banco, teléfono/documento; correo Zelle;
o Pay ID Binance. Transferencia y Pago Móvil muestran una conversión de ejemplo
de **100 Bs ficticios por USD ficticio**, no una tasa oficial. Binance usa
USDT ficticios a 1:1, sin redes blockchain.

Se adjunta un comprobante JPG, PNG, WebP o PDF de hasta 2 MB, o se genera una
imagen de ejemplo a partir de los datos del formulario. No deben usarse
documentos financieros reales. **Enviar una solicitud no acredita saldo.**
La moderación local existente puede descargar el soporte privado y aprobar
o rechazar con motivo; aprobar acredita una sola vez en una transacción con
la decisión, y rechazar no genera fondos. Normalmente revisa otra cuenta;
la autorrevisión exige consentimiento explícito y solo funciona en la demo
local con permiso de moderación. No existe verificación bancaria por API ni
se presentan estos comprobantes como pagos verificados. Una integración real
requiere proveedor autorizado, conciliación y controles independientes.

`GET /api/wallet?before=ID&beforeRecharge=ID&beforeReview=ID` pagina movimientos,
solicitudes propias y pendientes de revisión de 50 en 50. `POST
/api/wallet/recharges` recibe multipart con `input` (JSON de
`kind: "request-recharge"`) y `proof`. `POST /api/wallet` acepta
`kind: "review-recharge"`. `GET /api/wallet/recharges/ID/proof` permite descargar
el archivo únicamente al solicitante o a moderación local, sin caché y siempre
como adjunto. Las recargas directas antiguas solo permiten reintentar claves
ya registradas; no crean nuevos fondos sin revisión.

Las operaciones son exclusivamente ficticias, autenticadas por cookie y con
origen validado. Se permiten hasta 10 solicitudes pendientes, 60 envíos por
minuto y 40 MB de soportes por cuenta en la demo; máximo de 1.000.000 USD
ficticios por recarga. La cuenta esperada se comprueba contra la sesión para
evitar cambios de cuenta durante el envío; nunca selecciona al dueño. No acepta dueño,
rol, moneda real, transferencias entre usuarios, retiros ni comandos de débito
arbitrarios del navegador. El saldo inicial es cero; nunca se inventan fondos
durante una migración. `financialAccess` permanece en `false`.

Los movimientos se guardan en un libro contable equilibrado e inmutable,
incluyendo la contrapartida de emisión ficticia. Cada uno conserva módulo,
referencia y concepto; el historial privado se pagina de 50 en 50. Las claves
de solicitud persisten en el servidor y un reintento no duplica la recarga.
Una solicitud cuya respuesta no llega conserva sus datos y soporte ficticio en
`sessionStorage`, por cuenta, incluso al recargar la página; debe confirmarse con la misma clave
antes de crear otra. Si no se puede guardar la solicitud, no se envía.
Las referencias y soportes repetidos de solicitudes pendientes o aprobadas
se rechazan. Una solicitud rechazada puede corregirse en un nuevo envío. Los
datos originales y las decisiones se conservan; el esquema interno de la
billetera migra de 1 a 2 sin cambiar movimientos o pedidos anteriores.

Billetera y marketplace comparten la base de comercio indicada por
`PLAYSPORT_MARKETPLACE_PATH` (actualmente `.local/marketplace/marketplace.sqlite`)
para confirmar saldo, inventario, pedido y chat en **una misma transacción**.
`PLAYSPORT_WALLET_API_BASE` permite configurar el proxy web. No se almacenan
tarjetas, no hay fondos reales, ni integración con bancos o proveedores de pago.

## Maqueta ficticia de apuestas

Abre la cartelera y pulsa «Apostar» en un partido por iniciar o en curso.
El ejemplo conserva el partido elegido (equipos, estado y marcador), tanto para
juegos de ejemplo como para los del sistema. No aparece en finalizados,
cancelados, suspendidos o bajo protesta. Si el partido del sistema cambia a un
estado no admitido, la pantalla deja de ofrecer nuevas simulaciones.
`/demo/betting-preview` sin selección conserva la muestra independiente:
cartelera con partidos por comenzar y en vivo, ofertas 1 a 1, aceptación parcial
y saldos disponibles/reservados expresados únicamente en créditos ficticios.
La pantalla separa tres pasos: elegir un partido, revisar la elección de ambos
participantes y consultar los acuerdos. Antes de aceptar muestra el aporte
de cada parte y el total ilustrativo que recibiría el ganador.
Puedes publicar ofertas de prueba y reiniciar el ejemplo. Cada aceptación genera
un acuerdo separado y deja abierto el remanente. Todo vive en memoria de esa
pantalla y se reinicia al recargar. Solo consulta datos públicos del partido
seleccionado; no modifica cuentas, partidos, billeteras o fondos reales.
No verifica usuarios ni liquida resultados.
Las funciones financieras reales siguen desactivadas.

## Puesta en marcha

```bash
npm install
docker compose up -d
cd apps/api && npx prisma migrate dev --name init && cd ../..
```

## Desarrollo

```bash
npm run dev
npm run dev:web
npm run dev:mobile
npm run dev:api
```

La web usa `.next-dev` durante desarrollo y `.next` para producción, de modo que
`npm run build --workspace @playsport/web` no sobrescriba los archivos del servidor
de desarrollo mientras está activo.

Para validar la API:

```bash
ESLINT_USE_FLAT_CONFIG=false npm run lint --workspace @playsport/api
npm run build --workspace @playsport/api
```

La API usa `@typescript-eslint/no-unused-vars` en lugar de la regla de JavaScript
para reconocer parámetros de firmas de tipos y seguir detectando variables
reales sin uso. El prefijo de lint mantiene la compatibilidad con la configuración
actual `.eslintrc.cjs` en ESLint 9.

## Entrada integrada de la plataforma

«Mi perfil» es el apartado de datos personales, contacto y representados.
«Rol» indica cómo participa una persona: fanático, jugador, manager, organizador,
anotador o scout. La navegación usa «Elegir rol» y «Cambiar rol»; la trayectoria
del jugador se denomina «Hoja deportiva». En móvil, «Mi rol» contiene las
herramientas y el contexto de trabajo, separado del acceso «Mi perfil».
Cada rol es un botón que abre sus herramientas sin una segunda confirmación.
En la web, Manager abre primero la elección entre sus dos equipos ficticios;
cada botón muestra el nombre del equipo y el torneo y entra directamente con
la identidad correspondiente. Ambos ejemplos pertenecen al Torneo de demostración
2026. La selección no usa «Local/Visitante»: esa condición corresponde a cada partido.
En móvil, Manager abre «Mi rol» para elegir o revisar su contexto de equipo
guardado, sin descartar los borradores anteriores.
La ubicación de la bienvenida web se puede desplegar y ajustar antes de pulsar el rol;
se conserva también al volver desde la elección de equipo.
Este cambio de nombres no fusiona las cuentas ficticias del demo ni modifica
sus identificadores, claves de almacenamiento, permisos o historial.

### Perfil personal de demostración

Los datos locales de demostración no sustituyen la cuenta autenticada ni se
vinculan automáticamente a ella. Las referencias a AsyncStorage y selectores
nativos de esta sección describen el cliente anterior, conservado como legado.
La app actual muestra la misma interfaz web dentro de WebView; la cuenta,
su foto y los datos sincronizados utilizan los servicios descritos arriba.

Las fechas de nacimiento se escriben como día, mes y año en perfiles,
representados y preinscripciones, tanto en web como en móvil. Completar el día
o mes avanza automáticamente al siguiente segmento; se admiten dos dígitos o uno
cuando no es ambiguo (por ejemplo, día 5 o mes 3). El año no guarda
ni envía el formulario. La persistencia y la API mantienen `AAAA-MM-DD`,
incluidos los datos existentes. Las fechas de Cartelera no cambian.

Todos los roles tienen «Mi perfil» en la navegación web y móvil. Permite editar
nombre completo, teléfono, dirección territorial y detallada, sexo opcional,
enlaces de Instagram/Facebook/TikTok/X/YouTube y foto. Cédula, nombre y apellido,
fecha de nacimiento, estado y municipio son obligatorios al confirmar, junto
con al menos un correo o teléfono válido. La cuenta responsable debe ser de un adulto.
Los perfiles anteriores se recuperan sin borrar datos: deben completar los
nuevos campos en el próximo guardado. Los borradores incompletos se conservan al
volver o reabrir, con errores explícitos si el dispositivo no permite escribir.
La cédula V/E queda fija al primer guardado y se comprueba que no se repita
entre las cuentas de prueba de ese dispositivo y en el registro familiar de la
API local. No se verifican identidad, correo ni tutela: el alta de producción,
la recuperación de acceso y las correcciones documentales siguen pendientes.
Cada cuenta ficticia mantiene su identificador técnico estable;
las identidades ficticias de cada rol representan cuentas distintas, no una
persona real que se pueda unificar automáticamente.

Los perfiles usan una clave independiente de las planillas y borradores de
anotación: `playsport:demo-personal-profiles:v1`. La web usa localStorage y el
cliente nativo anterior usaba AsyncStorage. La foto de cada perfil demo y los datos complementarios siguen siendo locales;
la web autenticada usa además la foto de cuenta persistente descrita arriba;
los datos obligatorios y los representados se guardan en la API local.
El contacto exige correo electrónico o teléfono, al menos uno; ambos se permiten
y todo contacto proporcionado debe ser válido.
**Usar únicamente datos e imágenes ficticios**: no hay autenticación de
producción ni cifrado propio. No se publican en la cartelera ni cambian
permisos, roles o identidades deportivas ya vinculadas. Guardar la
dirección en la web actualiza la ubicación del perfil demo de la pestaña, sin
reemplazar filtros de cartelera que el usuario haya elegido.

«Mis hijos o representados» permite registrar menores con nombre, nacimiento,
estado, municipio, relación y declaración de autorización. Su cédula es opcional;
no requieren teléfono, correo ni cuenta independiente. Sin cédula reciben un
número privado como `V-12345678-1`, `V-12345678-2`: nunca se registra la cédula
del adulto como documento propio del niño. La API asigna sufijos bajo bloqueo
de escritura y conserva el contador incluso después de incorporar una cédula
o cambiar de representante. Cada menor tiene un ID opaco permanente usado en
rosters, lineups y estadísticas. Incorporar su cédula conserva ese ID y deja
el código anterior como alias buscable. Los registros deportivos anteriores
mantienen sus claves históricas; no se fusionan automáticamente.

La búsqueda familiar admite nombre, código actual/anterior o cédula del
responsable. Coincidencias de nombre y nacimiento detienen el alta para revisión,
sin fusionar personas ni revelar la otra familia. Para cambiar de representante,
el responsable actual crea una invitación dirigida a otro adulto registrado:
vence en siete días y requiere aceptación desde el acceso privado del destinatario.
No se renumera al jugador; el responsable anterior deja de acceder a su ficha.
La declaración y la invitación **no prueban legalmente la tutela**.

El registro familiar demo se persiste en `.local/registration.json` del directorio
de trabajo de la API (ignorado por Git, archivo 0600). Puede configurarse con
`PLAYSPORT_REGISTRATION_PATH`. Las escrituras usan archivo temporal y renombrado
atómico, con bloqueo exclusivo entre procesos que comparten ese archivo; un
bloqueo ocupado devuelve 409 para reintentar. No es un sustituto de una base de
datos transaccional de producción. Cada cuenta local conserva una capacidad
aleatoria privada en localStorage (AsyncStorage en el cliente anterior); no se transmite en URL ni basta
con conocer una cédula para leer una familia. Si se pierde ese acceso no se crea
una segunda persona con la misma cédula: hace falta recuperación controlada,
todavía pendiente. Los nuevos menores se proyectan públicamente solo con nombre
e ID opaco, también en plan pago, nunca con código familiar, nacimiento o contacto.
El estado deportivo oficial y el registro activo usan el almacenamiento permanente descrito arriba.

Las fotos de los perfiles demo se eligen del dispositivo y permanecen locales;
la foto de cuenta autenticada de la web sí se guarda en la API. Se vuelven
a codificar como JPEG y se reducen antes de persistir, sin conservar EXIF.
La web admite JPG/PNG/WebP de hasta 5 MB; el resultado local está limitado a
280000 caracteres de data URL. El cliente nativo anterior usaba el selector
de imágenes y el manipulador de Expo. La app actual utiliza el selector de
la interfaz web integrada, no un editor de perfil nativo paralelo.
Los enlaces sociales confirmados solo admiten HTTPS del dominio de su red.

La web comienza en `http://localhost:3000/`: bienvenida, identidad ficticia,
elección de rol y un inicio de trabajo con sus módulos. No empieza en una
planilla ni requiere conocer enlaces internos. Los seis roles ya existentes
en la app móvil (fanático, jugador, manager, organizador, anotador y scout)
comparten ahora su catálogo y asignación de módulos desde
`packages/shared/src/platform.ts`.

En el inicio web de los seis roles, toda la tarjeta de cada módulo es un enlace
directo: título, descripción y espacio interior. También se puede recorrer con
Tab y abrir con Enter. Se conservan las rutas y los avisos de módulos parciales
o pendientes; estas tarjetas abren su alcance existente, no funciones nuevas.

El manager elige su equipo ficticio por nombre y torneo. Cada rol muestra la
cuenta de demostración que utiliza. La barra superior permite volver al inicio
y cambiar de rol desde cualquier módulo. El rol se conserva en
`sessionStorage` durante la pestaña; cambiarlo no borra el partido ni los
guardados privados. Los enlaces anteriores a las bandejas siguen funcionando
y seleccionan explícitamente el rol correspondiente en la misma pestaña,
sin abrir otra pantalla independiente. Las bandejas regresan al inicio del
rol activo.

| Módulo web | Estado integrado |
| --- | --- |
| Pizarra en vivo | Disponible: anotación para organizador/anotador, preparación de lineup para manager y consulta pública sin controles de escritura para fanático/jugador/scout. |
| ROSTER | Plantilla independiente del lineup, búsqueda de personas y preinscripciones persistentes con sus cargos, sin habilitación deportiva automática. |
| Crear torneo | Borradores persistentes, publicación, equipos y revisión de rosters, fases configurables, calendario semanal, sedes, bloqueos, retiros, sanciones y comunicados. |
| Centro del organizador | Cupos/cierre global del roster y acceso a herramientas oficiales; enlaza Crear torneo para planificar la competición. |
| Cartelera | Calendario por fecha, estado y municipio; todos los estados del juego, resultados históricos, direcciones y enlaces externos a Google Maps. |
| Tabla de posiciones | Consulta web y móvil por liga y torneo, con clasificación, desempate directo y resultados por equipo a partir de los ejemplos de la cartelera. |
| Chat del partido | Panel público plegado en cada pizarra oficial; mensajes con sesión de cuenta durante el juego y los 30 minutos posteriores al final oficial. |
| Marketplace | Compra, venta, subastas y mensajes privados persistentes con USD ficticios; pagos y operación comercial real pendientes. |
| Hoja deportiva | Presentación y alcance; trayectoria y estadísticas históricas pendientes. |
| Sponsors y partners | Presentación y alcance; gestión comercial pendiente. |
| Scouting y talento | Presentación y alcance; búsqueda y watchlists pendientes. |

El inicio también reúne este inventario. Los módulos pendientes muestran su
alcance, no botones que simulen operaciones terminadas. Los datos y las tarjetas
de ejemplo de la app móvil siguen siendo demostrativos, no una prueba de que
sus operaciones tengan backend.

### Cuenta ficticia de pruebas local

Una cuenta concreta puede habilitarse como tester mediante un archivo privado
`local-tester.json` junto a la base de cuentas, con
`{"version":1,"accountId":"UUID de la cuenta registrada"}`. No hay endpoint
público para otorgar ese acceso; registro e inicio de sesión siguen validando
contraseña. El archivo está dentro de `.local`, fuera del control de versiones.
Esta excepción solo funciona fuera de producción y con el origen web HTTP
en `localhost`, `127.0.0.1` o `[::1]`. Nunca se activa en un origen de despliegue.

Solo las sesiones de esa cuenta omiten la caducidad por inactividad y duración
absoluta. Su cookie sigue siendo HttpOnly y SameSite Strict, con 400 días y
renovación al consultar la cuenta. Cerrar el navegador no cierra la sesión;
borrar sus cookies o cerrar sesión explícitamente sí requiere volver a entrar.
Logout y cambio de contraseña siguen revocando los tokens, también del tester.
Las cuentas normales conservan sus límites de 24 horas/30 minutos.

Todo botón **Cambiar rol** de la web vuelve directamente a `/` y muestra
la selección de los seis roles, también para el tester. No abre un selector
adicional ni cierra la cuenta autenticada. El manager elige su equipo desde
la entrada de su rol. La web recuerda rol, equipo y ubicación ficticia en almacenamiento
local asociado a su cuenta; no almacena contraseñas ni tokens de acceso.
Los botones **Inicio** del menú común y **Volver al inicio** de Mi cuenta
abren esa misma bienvenida con los seis roles, incluso si ya se está en `/`.
Cierran también el selector de equipo abierto, sin cerrar la cuenta ni borrar
borradores o registros deportivos. La navegación espera a que termine un
guardado y queda bloqueada si un borrador no pudo conservarse.
Desde el panel de un rol, **Volver atrás** abre la bienvenida aunque ambas
pantallas usen `/`, sin navegar otra vez a esa misma URL ni depender del registro
de una acción de regreso en la página. Esa elección se conserva en la pestaña al recuperar el foco
o recargar: otra pestaña no puede devolverla automáticamente al rol anterior.
Las preferencias de rol solo se actualizan al elegir uno explícitamente.
La entrada **Hoja deportiva** de todos los roles enlaza directamente a
`/sports-sheet`. Su ruta antigua `/demo/player-career` sigue redirigiendo,
pero se unifica con la ruta actual en el historial: **Volver atrás** no puede
regresar a esa redirección y abrir de nuevo la misma hoja.
Los botones y enlaces de acción comunes mantienen fija su zona de clic al pasar
el mouse: el resaltado no los desplaza, para no perder clics cerca de sus bordes.
Al abrir una pestaña se comprueba la cuenta y se recupera ese perfil antes de
inicializar los enlaces antiguos de la pizarra, para no reemplazar el rol o equipo
recordado. Una pestaña que ya tiene su rol de trabajo lo conserva.
Recargar otra pestaña no reemplaza la última elección explícita de rol o equipo.
Los roles mantienen las identidades deportivas del demo y sus validaciones:
no es un superusuario de producción, no evita reglas de lineups ni asignaciones
y no activa dinero real, verificación, apuestas reales ni módulos pendientes.

### Marketplace de pruebas: compra, venta y subastas

El módulo web `/demo/marketplace` está disponible desde los seis roles. Publicar,
confirmar una compra, pujar y escribir exige la cuenta local autenticada por su
cookie HttpOnly; elegir un rol deportivo no concede propiedad de anuncios ni
pedidos. El móvil abre el mismo módulo web, donde se inicia sesión.

Los borradores de publicación se conservan en `sessionStorage` de la misma
pestaña, separados por cuenta y no por rol deportivo. Cambiar de rol mantiene el
borrador; otra cuenta no lo recibe. Publicar correctamente lo vacía.

El catálogo usa por defecto el estado del **perfil guardado del rol activo**,
no su borrador ni una ubicación de ejemplo. Permite elegir otro estado o
«Todo Venezuela» sin modificar el perfil ni pedir GPS. Sin un perfil guardado
con ubicación, el alcance es nacional. El filtrado territorial se aplica en la
API antes de paginar; pedidos y mensajes privados no se limitan por ese filtro.
Al publicar se precargan estado y municipio guardados, ambos editables para
ubicar el artículo, y se exige una pareja válida del catálogo territorial.

El catálogo combina búsqueda, estado, categoría, venta/subasta, deporte y
condición nuevo/usado. Todos estos filtros se aplican en la API **antes** de
paginar; búsqueda conserva la comparación de mayúsculas/minúsculas en español.
«Béisbol y softbol» es un único grupo de exploración que incluye ambos deportes,
sin cambiar las declaraciones individuales guardadas o el formulario de
publicación. Los anuncios antiguos sin deporte aparecen solo en «Todos los
deportes». «Limpiar filtros» elimina también el filtro territorial y muestra
todo Venezuela, sin modificar el perfil.

Los favoritos se guardan de forma persistente por cuenta autenticada en SQLite,
no por rol deportivo ni en almacenamiento local del navegador. Guardar/quitar
es idempotente, no compra, no puja, no crea chats ni bloquea stock. «Mis favoritos»
admite los mismos filtros; las compras y mensajes privados siguen independientes
de ellos. Anuncios cerrados conservan su información y muestran su estado.
Anuncios retirados por el vendedor o por moderación muestran solo una referencia
sin título, foto, descripción ni motivo privado, también para un moderador;
se pueden quitar sin reabrirlos. La migración a versión 5 añade favoritos e
índices sin reescribir anuncios, pedidos o conversaciones anteriores.

Solo se admiten las cuatro categorías deportivas, con deporte seleccionado y
declaración explícita de contenido deportivo validada también por la API.
Los reportes incluyen «Contenido ajeno al deporte» y tienen revisión humana:
se pueden desestimar o retirar anuncios con motivo obligatorio. Reportar no
oculta automáticamente el anuncio. El autor consulta su decisión y el vendedor
puede apelar un retiro. Reportes, apelaciones y decisiones conservan su historial.
La migración conserva anuncios anteriores sin inventar estado, municipio,
deporte ni declaraciones; los anuncios sin estado aparecen solo a nivel nacional.

Todos los importes son **USD ficticios**. La billetera de pruebas no habilita
tarjetas, cargos, transferencias, mercancía ni entregas reales. Las cuentas no certifican identidad
o reputación comercial. Los pedidos registran compra confirmada ficticia, envío simulado,
recepción, cancelación e historial; las reclamaciones de pedidos siguen pendientes
de resolución. Una disputa previa a recepción mantiene el pago retenido; una
posterior a recepción no vuelve a debitar al vendedor automáticamente.

Las nuevas compras retienen el total en la billetera del comprador. Si falta
saldo, no se crea pedido, chat ni descuento de stock. El vendedor no recibe
saldo al marcar envío: solo al confirmar recepción el comprador se libera el
pago ficticio. Cancelar antes del envío devuelve la retención exactamente una
vez y restaura inventario; después del envío no se ofrece cancelación automática.

Las nuevas subastas publicadas con `walletBacked: true` retienen solo la puja
líder. Subir la propia puja reutiliza la retención anterior; superar a otra
cuenta le devuelve el saldo inmediatamente. Una puja sin fondos revierte toda
la operación, incluida cualquier devolución provisional al líder anterior.
Al cierre fijo, la retención pasa al pedido ganador sin cobrar otra vez.
Retirar por moderación una subasta aún activa devuelve al líder su retención;
retirar un anuncio con pedidos ya creados no cancela ni devuelve esos pedidos.

La migración de comercio a versión 6 añade el libro y sus índices sin reescribir
los registros anteriores. Los pedidos sin metadatos de pago se muestran como
`legacy-unpaid`: no se cobran ni se pagan retroactivamente al recibirlos.
Las subastas anteriores sin billetera conservan su cierre e historial, pero
no aceptan nuevas pujas; sus adjudicaciones anteriores no generan fondos.
Una apelación aceptada de una subasta retirada nunca reabre ni adjudica pujas.

En «Mis ventas» el propietario puede editar contenido, foto, territorio, deporte,
precio e inventario disponible, también completar datos de anuncios antiguos.
Una revisión optimista rechaza cambios si hubo una compra, puja u otra edición
desde que se abrió el formulario. Los pedidos existentes conservan sus datos.
Disponible más pedidos pendientes no supera 1000 unidades; stock cero cierra
ventas y añadir unidades reabre ventas agotadas, no anuncios retirados.
La modalidad y la fecha fija de cierre nunca cambian. Una subasta cerrada o con
pujas no admite edición; los anuncios retirados por moderación tampoco.

La moderación usa cuentas explícitas en el archivo privado y git-ignorado
`moderators.json`, junto a la base del marketplace:
`{"version":1,"accountIds":["UUID-DE-LA-CUENTA"]}` (usar UUID reales válidos).
Solo funciona fuera de producción con `PLAYSPORT_WEB_ORIGIN` HTTP de localhost,
127.0.0.1 o ::1. No depende del rol deportivo ni del acceso general de pruebas;
no concede administración de producción, acceso a pedidos ajenos ni lectura de
mensajes privados. El demo local habilita exclusivamente la cuenta de pruebas
aprobada por el usuario. Una configuración inválida produce un error explícito.

Retirar por moderación bloquea nuevas compras y pujas, oculta el anuncio público
y conserva pedidos, mensajes, pujas y auditoría con datos anteriores/posteriores.
Una subasta retirada no se adjudica ni se reabre, incluso si una apelación
aceptada restaura su visibilidad. Los pedidos creados antes del retiro no se
cancelan automáticamente; conservan las transiciones habituales. La migración
SQLite a versión 3 conserva los anuncios y convierte los reportes anteriores
en revisiones pendientes sin sobrescribir sus registros originales.

Cada anuncio incluye preguntas públicas paginadas, legibles sin iniciar sesión.
Los interesados preguntan sin comprar, descontar stock ni bloquear unidades;
solo el vendedor autenticado responde, con su respuesta identificada. Se
advierten la visibilidad pública y la prohibición de publicar datos personales;
la API rechaza correos y números largos de contacto/pago reconocibles, sin
prometer detección semántica completa de direcciones u otros datos sensibles.
Preguntas y respuestas tienen reportes y ocultamiento con motivo obligatorio,
sin retirar el anuncio ni borrar historial. Preguntas nuevas y respuestas
solo se admiten mientras el anuncio está activo.

Confirmar una compra descuenta inventario de forma atómica y crea un pedido con
su propio chat privado entre comprador y vendedor. No existe reserva como paso
previo ni chat privado nuevo antes de comprar. Cada pedido tiene una conversación
independiente, también cuando el comprador compra varias veces el mismo anuncio.
Se coordinan pago ficticio, envío o retiro: conversar y confirmar una compra
no acreditan un pago real. Confirmar recepción completa el pedido de prueba.
Los chats de pedidos se conservan incluso después de cancelación o retiro.
Las subastas crean el chat únicamente para el pedido ganador al cierre.

La migración SQLite a versión 4 conserva byte por byte las consultas privadas
anteriores y sus mensajes como archivos privados de solo lectura; nunca los
publica como preguntas. Los pedidos antiguos mantienen sus estados e historial,
incluido `reserved` si ya existía, y reciben un chat separado por pedido. Los
pedidos nuevos usan `confirmed`, no `reserved`. La migración conserva claves
foráneas y es idempotente.

Cancelar un pedido pendiente restaura
las unidades una sola vez. Solo el vendedor registra el envío y solo el comprador
confirma recepción. Las subastas admiten una unidad, precio inicial e incremento;
cierran a la hora fija del servidor, sin prórroga. El cierre crea exactamente un
pedido para la mayor puja válida, o ninguno si no hubo pujas. No se puede comprar
ni pujar por anuncios propios, ni retirar una subasta que ya tiene pujas.

Los anuncios, pedidos, pujas, solicitudes
idempotentes, mensajes privados y reportes se conservan en SQLite:
`apps/api/.local/marketplace/marketplace.sqlite` por defecto
(`PLAYSPORT_MARKETPLACE_PATH` permite otra ubicación). Son independientes de
partidos, rosters y anotaciones. La API `/api/marketplace` y su proxy web validan
identidad, origen, campos, importes enteros en centavos y cursores. El catálogo
pagina 50 anuncios; las conversaciones privadas paginan 50 mensajes.

Las fotos del Marketplace se guardan como archivos JPEG en `photos/`, junto a
la base de comercio. SQLite guarda únicamente una ruta relativa
`/api/marketplace/photos/<sha256>.jpg`, también en las versiones del historial.
El nombre por contenido evita duplicar archivos idénticos. La API y el proxy
web sirven las fotos por el mismo origen, con tipo JPEG y caché inmutable; no
se aceptan rutas de disco ni direcciones externas enviadas por el cliente.
La preparación de la foto y el envío pueden utilizar Base64 temporalmente,
pero este no se persiste en la base. Se conservan los límites actuales de foto.

Al iniciar la API, las fotos Base64 existentes de anuncios e historial se
extraen automáticamente, conservando el resto de sus campos y revisiones.
Antes se crea un respaldo consistente `backups/before-photo-migration-*.sqlite`;
la migración es transaccional e idempotente y compacta SQLite al terminar.
Un archivo inválido o un fallo de disco detiene el arranque explícitamente,
sin confirmar una migración parcial. El respaldo conserva los datos antiguos,
incluidas sus fotos Base64: consérvalo hasta verificar la recuperación.
Los archivos de fotos históricas no se borran al editar o retirar un anuncio.
Para respaldar o mover el servicio debes incluir **la base y `photos/`**; en
despliegues con contenedores ambos necesitan un volumen persistente. El sistema
de archivos local no es almacenamiento compartido entre varias máquinas.
Esta separación se aplica al Marketplace, no cambia las fotos de cuenta ni
los documentos privados de identidad o billetera.
Las claves idempotentes del Marketplace usan UUID v4 con `crypto.getRandomValues`,
disponible también al probar desde una IP privada con HTTP; no dependen de
`crypto.randomUUID`, que exige un contexto seguro en el navegador.

Ejemplos aprobados para desarrollo local:

```sh
node scripts/seed-marketplace-demo.mjs
```

El script registra un vendedor ficticio mediante el flujo normal de cuentas,
crea tres ventas y tres subastas y no duplica ni reabre los anuncios existentes.
Sus credenciales aleatorias se guardan únicamente en un archivo privado ignorado
por git, junto a la base de cuentas; no se publica un acceso sin contraseña.
El script rechaza producción y destinos no locales.

Pagos, verificación comercial, logística real, recuperación robusta de cuentas,
moderación de producción y resolución efectiva de disputas siguen pendientes.
No se deben usar estos registros de prueba para operaciones reales.

### Chat público por partido

«Tribuna y prensa» ya no es un módulo de los roles en web ni móvil. El enlace
anterior `/demo/news` conduce a la cartelera. Cada pizarra oficial incluye
«Chat del partido», plegado por defecto para todos: también para el anotador,
manager y persona designada como dirigente. Abrirlo es voluntario; no hay
sonidos, ventanas emergentes ni cambios de foco automáticos.

Cualquiera puede leer. Publicar, reportar y silenciar requieren una sesión de
cuenta real del acceso local, independiente de los roles ficticios y sin
atribuir identidad verificada ni permisos deportivos. El chat se abre con
`in_progress`; el servidor admite comentarios hasta, pero no incluyendo, el
instante del final oficial más 30 minutos. Las correcciones de marcador no
reinician ese plazo; deshacer el cierre devuelve el chat al estado del juego.
Suspensiones y protestas pausan los comentarios. Los finales históricos sin
hora de cierre conocida son solo lectura, sin inventar una ventana nueva.

Mensajes, silencios personales por partido, reportes y el cierre observado
se guardan en SQLite local (`PLAYSPORT_CHAT_PATH`, por defecto
`apps/api/.local/chat/game-chat.sqlite`). Se consultan en páginas de 50,
incluyendo comentarios anteriores y actualizaciones incrementales. Hay un
máximo de 300 caracteres, un intervalo mínimo de 3 segundos entre mensajes,
5 mensajes en 30 segundos por cuenta y bloqueo de comentarios repetidos
durante un minuto, incluso cambiando de partido. El texto no se interpreta
como HTML. Silenciar solo modifica lo que ve esa cuenta en ese partido;
los reportes quedan registrados para revisión humana, cuya consola y equipo
operativo todavía están pendientes. No se simulan expulsiones ni revisión automática.

El panel usa un servicio y errores independientes: no escribe jugadas,
lineups, resultados ni apuestas, y sus fallos no bloquean la anotación.
Los ejemplos con jugadas fijas muestran una aclaración, no comentarios
ficticios ni un chat que finja un partido real. Los amistosos privados no
publican chats. En móvil, un acceso también plegado abre el mismo chat en la
web, donde está implementada la sesión de cuenta; no se guardan credenciales
en el rol móvil. Configura `EXPO_PUBLIC_PLAYSPORT_WEB_ORIGIN` para dispositivos
que no accedan al servidor con `localhost`.

El API ofrece `GET/POST /api/game-chat/:gameId`; la web utiliza su proxy del
mismo origen `/api/game-chat/:gameId` (`PLAYSPORT_CHAT_API_BASE` configurable).
Las escrituras validan origen y cookie HttpOnly en el servidor. La
persistencia deportiva restaura los juegos tras reiniciar: el chat
no crea ni reemplaza un partido que no exista en el catálogo oficial.

### Partidos asignados al anotador

En web y móvil, el anotador conserva dos accesos: «Mis partidos asignados»
para seleccionar encuentros y «Pizarra en vivo» para trabajar un solo partido.
«Mis partidos asignados» conserva la jornada completa y los ejemplos.
«Pizarra en vivo» es una entrada separada, sin listas, contadores ni ejemplos
de otros encuentros: abre su única anotación en curso, incluso después de
medianoche. Si no hay una en curso, muestra únicamente un pendiente asignado
desde una hora antes de su inicio programado hasta las 00:00 del día siguiente,
en hora de Venezuela (el límite final queda excluido). El botón «Comenzar
anotación» abre la herramienta del partido; la hora no inicia el juego ni envía
jugadas. Se conservan las validaciones de autorización, lineups y ocupación.
Si no hay candidato, faltan fecha/hora o coinciden varios partidos, muestra un
aviso y un acceso explícito a «Mis partidos asignados», sin elegir arbitrariamente
ni recuperar un pendiente antiguo por ser el último consultado. Web y móvil
comparten esta selección; la consulta periódica actualiza la disponibilidad.

La lista oficial proviene del API, no de la cartelera ficticia ni de códigos
escritos manualmente. Agrupa los encuentros en juego, próximos y finalizados.
Muestra equipos,
torneo, fecha, hora, estadio y estado; permite iniciar, continuar o consultar
el resumen de un juego finalizado, sin editarlo.

El organizador entra a sus partidos y selecciona sus anotadores entre los
autorizados del torneo. La autorización del torneo no asigna automáticamente
todos sus juegos: cada partido requiere una asignación explícita. Retirarla
bloquea nuevas anotaciones y movimientos de personal sin borrar el marcador,
las jugadas o las planillas. La consulta pública y la cartelera siguen siendo
de solo lectura. Sin asignaciones aparece «No tienes partidos asignados»;
los errores de conexión se muestran aparte, no como una lista vacía.

En la web, «Mis partidos asignados» es solo el selector. Al abrir un partido
desaparecen su cabecera, sus tarjetas y sus ejemplos: la pizarra utiliza los
mismos componentes, gráficos y estilos que la consulta pública y la del
manager. Los permisos agregan las jugadas predeterminadas para anotadores y
organizadores autorizados; no crean otra pizarra. La selección de equipo y la
gestión de personal quedan en paneles desplegables, fuera del marcador. Volver
desde la pizarra recupera la lista sin publicar ni descartar borradores.
Las jugadas predeterminadas se muestran en un panel destacado inmediatamente
después del marcador y antes de las bases: lanzamientos, batazos/embasados,
outs/sacrificios y deshacer. Reutilizan los comandos existentes, no una
anotación paralela. Solo aparecen en vistas con escritura; la falta de
lineups, una operación pendiente o el cierre del partido mantienen el bloqueo.

El orden de bateo queda fijo al entregar el lineup. Un suplente presente y
confirmado reemplaza al jugador saliente en su mismo turno, incluso si entra
durante un turno o por un corredor en base. Los cambios defensivos internos
solo intercambian posiciones de campo: conservan los turnos, camisetas,
conteo, corredores y siguiente bateador. Por ejemplo, el cuarto y el séptimo
bate pueden intercambiar puestos en el campo sin intercambiar sus turnos.
API y motor compartido rechazan intentos de enviar otro orden en esos
movimientos; una actualización de alineación tampoco puede reordenar a los
jugadores que continúan activos ni agregar turnos al lineup ya entregado.
La elección del jugador muestra su turno fijo antes de confirmar el cambio.

Un oficial (anotador u organizador que anota) solo puede llevar un partido
en curso a la vez, incluso entre torneos, roles de la misma identidad,
pestañas o dispositivos. La primera jugada aceptada ocupa la anotación;
preparar alineaciones o recibir varias asignaciones futuras no la ocupa.
El servidor rechaza con conflicto las escrituras de otro partido sin
modificarlo, incluidos deshacer y movimientos de personal. Web y móvil
muestran el motivo y permiten consultar el encuentro sin empezar otra
anotación. Finalizar, deshacer la primera jugada hasta volver a pendiente
o retirar la autorización libera al oficial; reasignarlo no recupera una
ocupación antigua. Reabrir un cierre también respeta esta regla.

### Cambios rápidos desde el jugador

En la hoja de anotación y la alineación, tocar el nombre abre «Ver perfil»,
«Sustituir por un suplente» y «Cambio interno», según los permisos del rol.
El perfil mostrado es la ficha del partido (nombre, equipo, puesto y camiseta),
no un perfil de cuenta inventado ni estadísticas personales desbloqueadas.
El público y los partidos finalizados solo permiten consultar.

En un cambio interno se toca al segundo jugador del mismo equipo; se intercambian
sus posiciones defensivas, nunca sus turnos al bate ni camisetas. En sustituciones,
la banca muestra solo suplentes presentes y disponibles. Una camiseta ya registrada
se reutiliza; si falta, se pide antes de guardar, sin inventar un número.
«Ingresar a reserva» muestra únicamente jugadores del roster que todavía no están
presentes. Elegir uno y registrar su camiseta confirma llegada y sustitución como
una sola acción, validando membresía, posición, versión y camiseta antes de escribir.
El manager asignado envía una solicitud pendiente para su propio equipo; solo el
anotador u organizador autorizado puede confirmarla. Los ajustes antiguos quedan
plegados como opciones avanzadas.

La misma interfaz adaptable se integra en Expo/WebView. En amistosos, un participante
nuevo puede incorporarse por nombre y reemplazar al seleccionado en una sola operación,
sin exigir cuenta ni camiseta al participante; el dueño del amistoso sí debe iniciar
sesión para guardarlo. Deshacer la sustitución lo mantiene disponible en la reserva.
La práctica «Cambios rápidos · tocar jugador, banca y llegadas» es reutilizable
y mantiene sus comandos separados de partidos existentes.

### Partidos amistosos privados

Todos los roles tienen «Partidos amistosos» en web y móvil. Solo el creador puede
consultar y anotar sus encuentros; no aparecen en la cartelera pública ni afectan
torneos, clasificaciones, carreras o estadísticas oficiales.

Se eligen béisbol (9 entradas) o sóftbol (7), nombres de los equipos y entre 9 y 12
participantes por equipo en filas numeradas por orden al bate. Las primeras nueve
son obligatorias y las filas 10, 11 y 12 son opcionales, sin huecos intermedios. No se piden
cédulas, camisetas ni cuentas de PlaySport para los participantes, y no se crean
registros globales de jugadores. Los nombres repetidos reciben IDs internos
distintos que no se muestran como documentos. Cada fila permite elegir una
posición sin duplicarla en el equipo, o dejarla sin asignar. Puede ajustarse
después sin cambiar el orden al bate. Los amistosos anteriores con alineaciones
reducidas siguen disponibles; el nuevo mínimo se aplica a la creación.

Cada equipo puede agregar y quitar suplentes uno por uno, sin tope adicional,
en una banca separada y plegable. Solo se solicita su nombre; no ocupan turnos
al bate ni puestos defensivos inicialmente. La banca también se conserva en el
borrador. Durante el amistoso, «Sustituciones y posiciones» permite reemplazar
a un jugador activo: el suplente hereda su turno y la posición seleccionada,
sin agregar bateadores. El cambio se guarda en la cuenta, aparece en el historial
y se puede deshacer. Los partidos anteriores sin banca siguen recuperándose.

La pizarra reutiliza el motor de jugadas, lanzamientos, corredores, entradas y
estadísticas. Se puede deshacer mientras el encuentro esté abierto. Al finalizar
queda para consulta, sin reapertura ni edición. Los borradores de creación se
conservan en el navegador/dispositivo. Las jugadas confirmadas se guardan en
`.local/friendly-games.json` del servicio API (configurable con
`PLAYSPORT_FRIENDLY_PATH`), con escritura atómica, bloqueo y control de versión.
No se sustituyen copias dañadas ni se aceptan anotaciones desde versiones viejas.

El creador debe iniciar sesión. La propiedad se obtiene exclusivamente de su
cuenta autenticada, no del rol elegido ni de un ID o Bearer enviado por el cliente.
Otra sesión de esa cuenta recupera los mismos partidos; otra cuenta no puede
consultarlos ni anotarlos. «Actualizar mis amistosos» recupera las revisiones
vigentes y las escrituras antiguas se rechazan sin sustituir el registro.

Mi cuenta → Mis datos guardados (`/account/saved-games`) permite revisar los
accesos anteriores de ese navegador o app, seleccionar partidos y confirmar
su incorporación a la cuenta actual. No hay reasignaciones automáticas:
el API valida la clave anterior y la titularidad de cada partido bajo bloqueo;
una importación aumenta la revisión para invalidar clientes anteriores.
Las claves y las copias locales se conservan; no se transmiten por URL.

Las planillas privadas se guardan por cuenta en `account_private_scorecards`
dentro de la base de cuentas existente, con revisión y transacción.
Se pueden recuperar copias locales anteriores, sin sobrescribir una planilla
ya sincronizada, y consultarlas en el archivo privado de la cuenta.
La práctica sigue usando claves locales aisladas; no se importa como partido
ni modifica estadísticas o anotaciones oficiales. Los borradores de formularios
sin confirmar siguen siendo locales y no sustituyen los datos guardados.

### ROSTER del manager y preinscripciones

«ROSTER» sustituye el acceso «Centro del manager» en web y móvil. La web abre
`/demo/roster`; `/demo/team-hq` redirige allí. La pizarra y «Mis partidos asignados»
conservan sus rutas y la preparación del lineup de cada partido. El roster lista
el equipo y torneo elegidos al entrar, incluso antes de programar juegos.
No vuelve a pedir el equipo ni abre otro como alternativa si falta la asignación.
«Cambiar equipo» está en el inicio del manager; su contexto también limita
«Mis partidos asignados» y la preparación del lineup. Cartelera conserva su
navegación y filtros independientes. La plantilla se muestra primero, agrupada
en jugadores, dirección, cuerpo técnico y apoyo, con la incorporación debajo.

La búsqueda por cédula o ID devuelve solo identidad deportiva y estado, sin
nacimiento ni contacto. Una persona existente se vincula con su cargo sin
sobrescribir sus datos. Si no existe, el manager guarda nombre y apellido,
nacimiento y correo o teléfono; para menores se exige cédula y contacto del
representante y la cédula propia es opcional. Se asigna un ID permanente y la
preinscripción queda en el registro persistente del ecosistema, no solo en el
borrador del equipo. Se incorpora directamente al roster dentro del cupo y
plazo del torneo, sin aprobación individual del organizador. No crea una cuenta
ni modifica lineups. Todos son jugadores en el roster; titulares, suplentes y
posiciones defensivas se determinan únicamente en el lineup de cada partido.
Los cargos de dirección, coaches y apoyo no conceden permisos de aplicación ni
constituyen una lista obligatoria universal. La categoría se rige por el
reglamento y fecha de corte del torneo; no se infiere una categoría arbitraria.

El manager que preinscribió puede generar una invitación privada de siete días
y compartirla por su cuenta: no se envía correo ni SMS. Solo se conserva su hash.
En «Mi perfil» permite recuperar datos sin reescribirlos; para menores se usa
«Mis hijos o representados» desde el acceso del representante indicado.
Guardar el adulto o confirmar al menor conserva el ID preinscrito y su vínculo
al roster. Las discrepancias de nombre/nacimiento y posibles duplicados requieren
revisión, sin fusiones silenciosas. La confirmación personal es independiente
de la incorporación directa y no verifica identidad, contacto o tutela.

El Centro del organizador permite guardar cuatro cupos por equipo: jugadores,
dirección, cuerpo técnico y apoyo. Se elige una sola modalidad: fecha (hasta
terminar el día en Venezuela, UTC−4), jornada/ronda (al iniciar o al finalizar
todos los partidos hasta esa ronda), o juegos finalizados. Para juegos, el
organizador elige el total del torneo, el primer equipo que alcance el tope
o todos los equipos que lo alcancen. En todos los casos cierra el torneo entero
simultáneamente. Suspendidos y bajo protesta no cuentan como finalizados.
Las rondas se asignan en este panel, sin modificar Cartelera; una asignación
incompleta bloquea incorporaciones sin declarar un cierre definitivo.

El cierre se conserva después de deshacer resultados o reprogramar. Solo una
reapertura explícita con un nuevo tope no alcanzado permite nuevas incorporaciones.
No se admiten cupos inferiores a los integrantes existentes ni se elimina a nadie.
Los torneos antiguos sin estas reglas siguen disponibles y muestran claramente
que no tienen cupos/plazo configurados. El módulo Crear torneo administra ahora
el plan de competición; los cupos y cierres efectivos del roster existente siguen
configurándose desde las herramientas del Centro del organizador.

### Mis partidos asignados del manager

El inicio del manager incluye «Mis partidos asignados», separado de «ROSTER».
Su bandeja muestra únicamente los encuentros del equipo y torneo elegidos al
entrar, agrupados por estado, con horario,
sede, marcador y resultado. No usa partidos de demostración como sustitutos de
asignaciones reales ni concede permisos de anotación.

En web se reutiliza la preparación del lineup y del representante en el campo
para el partido elegido, con borradores separados por torneo, juego y equipo.
Las entregas existentes se recuperan sin reenviarlas ni perder sus confirmaciones.
El manager puede enviar solicitudes de llegadas, sustituciones, cambios defensivos,
corredores de cortesía y directivos; el organizador o anotador debe aprobarlas.
En móvil la bandeja abre el lineup y las solicitudes del encuentro, o prepara una
alineación pendiente en el centro existente con el contexto del partido seleccionado.
Los finalizados, protestados y suspendidos se consultan sin modificaciones.
El manager no asigna anotadores, registra jugadas, suspende ni reprograma encuentros.

### Suspensión por clima o fuerza mayor

El organizador propietario o el anotador asignado puede aplazar un partido pendiente
o suspender uno iniciado, indicando causa y motivo. Si ya comenzó, debe escoger
entre conservar el juego completo o reiniciarlo: marcador, entradas, outs, cuenta,
bases, orden al bate y estadísticas. La configuración de equipos y el personal
aprobado se mantienen. Siempre se archiva la anotación anterior, consultable sin
editarla desde el historial; cada interrupción conserva su autor y fecha.

El estado `suspended` libera al anotador, bloquea anotación, deshacer, movimientos
de personal y cambios de ficha, y deja la nueva fecha pendiente. Solo el organizador
puede fijar fecha y hora. Reprogramar no inicia automáticamente: permite continuar
el momento conservado o empezar desde cero, según la decisión registrada.
No concede victoria o derrota ni reabre juegos finalizados o bajo protesta.
Web y móvil muestran la suspensión; Cartelera mantiene una sola lista y señala
la fecha original como referencia histórica hasta que se asigne la nueva.
Los juegos oficiales y sus archivos se guardan en la base deportiva permanente.

### Juego bajo protesta y mesa técnica

En un partido en curso, el anotador asignado dispone de «Juego bajo protesta».
Debe indicar equipo reclamante, motivo y confirmar la pausa. El servidor guarda
autor, fecha, versión y el momento de juego (entrada, outs, cuenta, marcador y
última jugada). El estado pasa a `protested`: no admite nuevas jugadas, deshacer,
correcciones, entregas de lineup, movimientos de personal ni cambios de los datos
del encuentro. Libera al anotador para otro juego, pero no suma victoria ni derrota.
No se determina automáticamente un ganador ni se alteran las carreras anotadas.

El organizador encuentra «Mesa técnica · Protestas pendientes» en sus partidos.
Registra el ganador indicado en el acta, fundamento y referencia del acta,
confirmando que transcribe la resolución y no decide unilateralmente. El perdedor
se obtiene del otro equipo. La decisión deja el juego finalizado, identifica al
organizador y la fecha y queda visible en la consulta del partido y su resumen.
No puede sustituirse, deshacerse ni usarse para reabrir el juego desde anotación.
Las operaciones requieren la versión vigente para evitar decisiones concurrentes.
La futura reapertura administrativa del ecosistema no se implementa en este flujo.

La tabla de posiciones distingue «Torneos oficiales» (datos del API) de las
«Tablas de demostración» anteriores. Los pendientes de mesa técnica no se cuentan.
Una decisión final suma ganador/perdedor, incluida la serie directa, aunque difiera
del marcador original; CF/CC y las estadísticas conservan lo realmente anotado.
Web y móvil comparten el cálculo y muestran la procedencia de mesa técnica.
El resultado oficial tiene una proyección compartida: el acta prevalece sobre
el marcador para identificar ganador/perdedor en asignaciones, consulta de todos
los roles, cartelera y clasificación. Las consultas se actualizan automáticamente
y al volver a una pestaña/app activa; las decisiones no modifican carreras,
jugadas ni estadísticas individuales. El manager móvil lee el estado oficial
(`scheduled`, `protested`, `final`), no lo infiere del cierre de la planilla.
Desde un resultado técnico de la tabla se puede abrir el partido y consultar
el fundamento y la referencia del acta, sin controles de modificación.
Los datos deportivos y sus autores se conservan tras reiniciar, con permisos
vinculados a cuentas. La validación administrativa del documento del acta
continúa siendo responsabilidad de la organización.

La sección separada «Explora con ejemplos» muestra dos juegos
pendientes y dos finalizados, reutilizando los resultados ficticios de la
cartelera. Las tarjetas llevan identificación de ejemplo y solo lectura.
Pioneros del Valle–Diamantes de Caracas quedó cerrado 1–3 en nueve entradas,
conservando las jugadas que ya mostraba su seguimiento.
En web se puede abrir su pizarra o resumen existente; en móvil se puede
expandir su ficha. Estos ejemplos nunca asignan anotadores, publican jugadas
ni sustituyen los resultados de una consulta fallida al API.

El demo utiliza `org-demo` y `scorer-demo`; los IDs declarados no sustituyen
autenticación real. El API y sus asignaciones se guardan en SQLite; estos aliases
solo se utilizan con la cuenta local autorizada.
`npm run demo:seed` agrega la asignación inicial y la ficha del juego conocido
solo si no estaban configuradas; no revierte una revocación explícita.
`npm run demo:seed -- --lineups` entrega únicamente los lineups ficticios
faltantes del juego conocido, con nueve jugadores aprobados por equipo,
posiciones y camisetas. Conserva cualquier entrega existente y rechaza
juegos iniciados o finalizados; no publica jugadas ni inicia el partido.

### Tabla de posiciones

El módulo conserva su identificador y ruta `/demo/standings`. Web y móvil
comparten ligas y torneos de demostración, los mismos juegos de la cartelera y
el cálculo de posiciones. No mezcla temporadas ni béisbol con softbol, y no
consulta ni modifica el partido oficial. Las ligas y equipos son ejemplos,
no una integración con ligas reales ni una clasificación oficial en tiempo real.

La ronda eliminatoria ordena por juegos ganados (descendente), perdidos
(ascendente) y, si dos equipos siguen iguales, victorias en la serie directa.
Con el mismo récord, el ganador de la serie ocupa una posición superior al
perdedor; no comparten puesto. Bajo el equipo aparece el balance directo y
en su detalle se identifican los juegos de esa serie.
Una serie igualada, sin enfrentamientos finalizados o un empate entre más de
dos equipos mantiene la posición compartida con «Desempate pendiente»; el desempate múltiple requiere
definir el reglamento del torneo. No se desempata por nombre ni por carreras.
Los equipos sin juegos finalizados se muestran sin posición.

Se muestran JJ, JG, JP, porcentaje de victorias, carreras a favor/en contra,
diferencial y racha. JE solo aparece si ese torneo contiene juegos registrados
como empate; esos registros históricos no se borran ni se confunden con
equipos igualados en la tabla. PCT es JG / (JG + JP), excluyendo empates; es informativo,
no un criterio adicional de orden. Solo cuentan juegos finalizados con
marcadores válidos. El detalle de cada equipo explica su clasificación y lista
los resultados que suman sus números, con acceso al juego en la web. Los
honores y líderes individuales no forman parte de esta tabla.

### Cartelera

En el inicio del jugador, tocar el nombre del equipo despliega sus equipos
disponibles con torneo y liga. Elegir uno cierra las opciones y conserva el
mismo contexto compartido de cartelera, pizarra y posiciones, sin cambiar
inscripciones. Con un solo equipo no se ofrece un cambio innecesario.
El control del manager y los filtros de las demás pantallas no cambian.

La consulta de equipos y torneos no requiere leer el perfil personal privado
de una cuenta sin identidad verificada. En ese caso se conserva la ubicación
elegida al entrar; las cuentas normales siguen viendo solo sus equipos devueltos
por la API. Las cuentas locales de pruebas mantienen los ejemplos existentes.
Al verificarse la identidad se consulta también el perfil personal. Los errores
reales de carga siguen visibles y se pueden reintentar con
«Volver a cargar mis equipos y torneos», sin cerrar la sesión.

La web integra Cartelera al inicio de todos los roles. Conserva el identificador,
la ruta `/demo/events-map` y las claves de filtros anteriores para no romper
enlaces ni borrar selecciones guardadas. Al primer
ingreso usa hoy en `America/Caracas` y la ubicación del perfil de demostración;
las identidades anteriores sin ubicación utilizan Distrito Capital / Libertador,
identificado como valor del demo, no como ubicación personal verificada.
La bienvenida permite elegir ubicación con el catálogo real. En la cartelera
se puede guardarla explícitamente en el perfil del demo, consultar otros lugares
sin modificarlo o recuperar la ubicación del perfil.

La cartelera muestra una sola lista por fecha, estado y municipio, ordenada por hora.
Combina los archivos de ejemplo con el catálogo público del API, con un único
conteo de pendientes, en curso, bajo protesta y finalizados. Estos últimos se enlazan mediante
`/demo/events-map?official=<gameId>` sin sustituir el archivo ficticio `?game=`.
El detalle utiliza el partido, torneo y nombres seleccionados, nunca otro juego
como reemplazo. La ruta pública de pizarra admite `?game=<gameId>` para partidas
oficiales. Los datos de sede pueden incluir `stateId` y `municipalityId`, ambos
validados contra el catálogo territorial. El organizador puede guardarlos desde
«Ubicación de la sede para la cartelera» dentro de su partido antes de una protesta
o finalización. Un partido sin ubicación registrada no se incluye en la búsqueda
territorial ni se le inventa una ubicación; se indica que falta ese dato, sin crear
otra lista. Los fallos de consulta se muestran sin ocultar los archivos existentes.
La cartelera móvil ofrece la lista pública
oficial y un detalle de solo lectura con marcador, estadísticas y acta.

Fecha, estado y municipio se conservan al regresar y recargar la pestaña mediante
el mecanismo común de borradores. Cambiar estado actualiza los municipios y
selecciona uno perteneciente a ese estado. La fecha no tiene límite de antigüedad:
los juegos finalizados muestran marcador y resumen; cancelados y juegos sin
resultado se identifican sin inventar un ganador.

El calendario y el [catálogo territorial](packages/shared/README.md) son permanentes.
Los 335 municipios incluyen La Guaira con su nombre actualizado y correcciones
contrastadas; se explican entidades sin división municipal y el territorio en
disputa. Las cuatro sedes y sus coordenadas son reales. **Solo los partidos,
equipos y resultados de la cartelera son ficticios**, con fechas fijas versionadas
y rótulos visibles: no representan encuentros reales ni modifican el partido
oficial del API.

Los juegos finalizados muestran hora, torneo, estadio, equipos, resultado y
reconocimientos confirmados (ganador, perdedor, salvador cuando corresponde y MVP).
Las tarjetas son compactas: el marcador aparece junto a cada equipo, sin repetir
el resultado en otro párrafo o recuadro; se muestran en dos columnas en pantallas
amplias y una en móvil, con desplazamiento vertical normal.
Los reconocimientos todavía no definidos se indican como pendientes; un empate
no recibe pitcher ganador ni perdedor. «Ver detalles del juego» abre un archivo
de solo lectura con pizarra por entradas, estadísticas y ambas hojas de anotación,
sin acceder al partido oficial ni escribir en sus datos o en planillas privadas.
Los archivos de ejemplo usan registros ficticios fijos, comprobados contra el
marcador final, y reutilizan el motor y las celdas de anotación existentes.
Al volver se conservan los filtros. Un archivo ausente se indica explícitamente,
sin reconstruir anotaciones a partir del marcador.

Solo los juegos pendientes o en curso muestran dirección escrita y «Cómo llegar en Google Maps».
El enlace abre otra pestaña con las coordenadas del estadio como destino, sin
enviar una ubicación de origen. No se incrusta ningún mapa ni se descargan
mapas o bibliotecas cartográficas; no se usa una clave de Google Maps ni se
solicita geolocalización. Las dependencias Leaflet se retiraron de la web.
La lista incluye finalizados, en juego y por jugar de la misma fecha y ubicación,
sin filtrar por estado. El 5 de noviembre de 2026 hay ejemplos de los tres
estados juntos en Distrito Capital / Libertador; el juego en curso muestra
su marcador parcial, alta/baja de la entrada, outs y «Ver juego en vivo»,
y el pendiente muestra la hora de inicio.
El detalle del juego en curso reutiliza las hojas y estadísticas de solo lectura,
con pizarra por entradas, bateador, pitcher, cuenta y corredores en cada base.
«Ver juego en vivo» utiliza el mismo componente de «Pizarra en vivo», incluyendo
el diamante gráfico, la cola de bateadores, las tarjetas de corredores y el
desglose de carreras. Su modo observador recibe el estado del juego seleccionado
sin abrir conexiones al partido oficial, leer o escribir planillas privadas ni
guardar borradores de anotación. Los filtros de cartelera permanecen intactos.
El inicio del fanático no muestra un acceso directo a «Pizarra en vivo»:
elige el partido mediante Cartelera → Ver juego en vivo. Se conserva su capacidad
de consulta y la compatibilidad con enlaces públicos anteriores; no es una
revocación de permisos. Los demás roles mantienen sus accesos habituales.
La app móvil también retira ese módulo del menú del fanático y dirige sus
atajos a Cartelera, donde permite elegir un partido oficial de solo lectura.
No muestra reconocimientos finales mientras el juego siga abierto. Los dos
seguimientos ficticios están versionados con jugadas fijas (alta y baja), sin
reloj simulado ni escrituras al servicio oficial; no representan una transmisión
real. Las entradas aún no disputadas se distinguen de las que llevan cero carreras.
El histórico oficial es persistente; la sede debe tener ubicación territorial
real para aparecer en la cartelera. Las escrituras requieren cuenta autorizada.

En la pizarra en vivo, jugador, fanático y scout son observadores: consultan
marcador, alineaciones y estadísticas, sin controles de anotación o cambios
ni selector de equipo. Los jugadores, camisetas, posiciones y turnos de ambos
equipos se consultan directamente en las hojas de anotación, sin un botón
adicional de alineaciones. Si falta una entrega, se indica sin inventar jugadores.

La navegación común incluye **Volver atrás** en la parte superior izquierda
de todas las pantallas de la web y la app móvil. Dentro
de una herramienta vuelve primero al panel anterior; al entrar por un enlace
directo, la web dispone de Inicio como destino seguro. Desde el inicio de un rol
en la web vuelve a la selección de roles, sin cerrar la cuenta ni borrar datos
deportivos. En la bienvenida sin
pantalla anterior el botón aparece deshabilitado.

Las opciones del menú superior de la web tienen apariencia de botón, con
fondo, borde y un área táctil mínima de 48 px. La foto y el acceso seguro
permanecen juntos en el botón de cuenta; las rutas y acciones no cambian.

Volver no ejecuta deshacer, cierre de partido, borrado ni publicación. Durante
un envío se bloquea la salida. Los campos pendientes de lineup, personal y
revisión se conservan como borradores: en la web se guardan en `sessionStorage`
por identidad, partido y formulario. La app instalada usa ahora esos mismos
formularios web y su almacenamiento local dentro de la WebView. Los accesos
anteriores de AsyncStorage se conservan para su recuperación confirmada.
Contextos y borradores quedan separados por rol, torneo,
partido, equipo y cuenta; no se restauran sesiones ni permisos de usuario.
No sustituyen ni se publican sobre el registro oficial.
Los errores de almacenamiento se muestran y permiten reintentar sin descartar
el borrador. La conservación es local a ese dispositivo, no una sincronización
entre dispositivos ni un respaldo del servidor.
Espera a que termine «Guardando borrador» antes de cerrar: un cierre forzado
durante la escritura puede perder el último cambio todavía no guardado.
Desinstalar la app o borrar sus datos elimina los borradores locales.
Los nuevos módulos web heredan el botón del layout; las nuevas herramientas
editables deben reutilizar `useNavigationDraft`, `useNavigationBusy` y
`useScreenBack` para preservar ese comportamiento.
Los nuevos formularios móviles deben utilizar `useMobileDrafts` y mantener
separados los campos pendientes del estado oficial recibido del API.
Los enlaces antiguos respetan el rol ya seleccionado y no lo sustituyen
por manager, anotador u organizador. Para elegir otro rol del demo se usa
«Cambiar rol»; un enlace directo solo adopta su rol si no hay uno activo.

**No es autenticación real:** seleccionar roles no crea cuentas, verifica
identidades ni concede permisos de producción. El registro y el acceso de
cuentas usan su módulo autenticado, los permisos deportivos se vinculan a sus
identidades verificadas y el estado oficial se conserva en SQLite, no en Git.

### Regla obligatoria de incompatibilidad por torneo

En un mismo torneo, una persona que sea organizador y/o anotador no puede ser
jugador ni manager de ninguno de sus equipos, sin excepciones administrativas.
La prohibición funciona en ambos sentidos: también se debe rechazar asignar
como organizador o anotador a quien participe como jugador o manager.

La validación debe utilizar la identidad única de la persona y el torneo,
no solo el rol activo, el equipo, el partido o el identificador de una
cuenta. Cambiar de rol, de equipo o utilizar otra cuenta no debe eludirla.
Debe comprobarse al asignar roles oficiales, inscribir managers y aprobar
jugadores en rosters; el servidor debe rechazar la operación incompatible,
además de informar el motivo en la interfaz.

**Estado: aplicado automáticamente en el API del demo.** Al crear el torneo se
vincula la cuenta del organizador a su cédula; al autorizar anotadores y aprobar
managers se exige igualmente una identidad vinculada. La cuenta no puede
cambiar de cédula y otras cuentas con la misma cédula heredan la incompatibilidad.
El historial de ambos grupos se conserva durante todo el torneo: revocar un
anotador, retirar jugadores, sustituir un manager o retirar personal de campo
no habilita después el rol contrario.

También se comprueban los cargos `MANAGER` y `DIRIGENTE` del personal de equipo,
tanto en la entrega inicial como en movimientos posteriores. Un conflicto
devuelve HTTP 409 sin aplicar parcialmente autorizaciones, identidades o
inscripciones. Las cuentas nuevas sin cédula vinculada se rechazan con HTTP 400;
el servidor no supone que el identificador de una cuenta sea su cédula.

La restricción es por torneo: una persona puede tener otro rol en otro torneo.
El registro global de jugadores no equivale por sí solo a participar en todos
los torneos; aprobar un roster o registrar un jugador en contexto de un torneo
sí deja historial de participación en ese torneo.

Los aliases ficticios conservan sus cédulas declaradas solo en el entorno local
autorizado. Los torneos de cuentas reales exigen identidad verificada; identidades
e historiales de incompatibilidad persisten con el estado deportivo. El selector
visual no sustituye esta comprobación del servidor.

La demo de anotación incluye un calendario ficticio para `tour-global-1`.
La herramienta compacta de anotación está en
`http://localhost:3000/demo/live-scoring?view=scorekeeper` y `?view=organizer`.
El manager local prepara su lineup en `/demo/live-scoring`; el visitante, en
`?view=rival`. Ambos usan únicamente el roster aprobado por el organizador y,
después de entregar, consultan el mismo partido oficial en vivo, sin editar jugadas.
La antigua dirección `?view=private-example` redirige al anotador. Los guardados
privados en `localStorage` no se borran, importan ni convierten en hechos oficiales.
La cabecera «PIZARRA EN VIVO» ofrece «Alineaciones del partido» junto al título,
sin texto descriptivo debajo. La distribución mantiene el botón al lado del
título en pantallas estrechas. Permite consultar orden, camiseta y posición y
volver al juego sin perder anotaciones, y reúne sustituciones, cambios defensivos,
intercambios de posiciones y los movimientos oficiales para anotador y organizador.
El botón forma parte de la propia cabecera de la pizarra, también al consultar
la alineación; no depende de insertar controles en otra zona del documento.
El selector de equipo permite al oficial registrar cambios en cualquiera de las
dos alineaciones. Las planillas oficiales de ambos equipos aparecen bajo el juego.
Los pasos de preparación se muestran fuera de la pizarra y se recuperan al volver al partido.
El bloque «PIZARRA RESUMEN», sin subtítulo, muestra una pizarra compacta con
las carreras por entrada y el total de cada equipo:
visitante en la parte alta y local en la baja, destacando quién está al bate.
Junto a la entrada, su parte y los outs se muestra «Bolas: … · Strikes: …».
Un pequeño diamante muestra primera a la derecha, segunda arriba y tercera a la
izquierda, con home abajo. Las bases vacías se delinean en blanco y las ocupadas
se destacan en dorado con un corredor. Su descripción accesible identifica a
quien ocupa cada base. Es solo visual: se actualiza al anotar y deshacer, y las
opciones de jugada siguen en los controles de bases inferiores.
La cuenta está fuera del desplazamiento de la tabla para permanecer visible en
pantallas estrechas. Se actualiza al anotar, cambiar de media entrada o deshacer.
Las medias entradas iniciadas muestran cero cuando no hay carreras y las no
jugadas muestran «—». La pizarra y ambas planillas muestran las 7 o 9 entradas
elegidas en «Duración» y se amplían cuando hay entradas extra. Sin una duración
definida, mantienen las siete columnas iniciales.
Tres tarjetas pequeñas muestran al bateador actual y los dos siguientes del equipo en ofensiva.
Cada una incluye «Bateo: 2 de 3» (dos imparables en tres turnos oficiales), para
no confundirlo con la cuenta de picheos. También muestra su posición actual
abreviada, orden de bateo, camiseta y AVG del partido, no el acumulado del torneo.
Antes del primer turno oficial completado se muestra «Bateo: 0 de 0» y «AVG —».
Si falta identificar al jugador se muestra «Bateo: —», sin inventar posición ni promedio.
Los boletos, golpes y sacrificios no suman turnos oficiales y los errores no cuentan
como imparables. Los valores corresponden al jugador, no al puesto en el orden de bateo.
La información se actualiza al terminar el turno, cambiar de media entrada o recibir un cambio
de jugadores confirmado, respetando la vuelta al inicio del orden de bateo.
Cuando falta la alineación rival se indica expresamente, sin inventar sus jugadores.
El bloque de controles lleva únicamente el encabezado «ANOTACION DE JUGADAS EN VIVO»,
sin los textos introductorios del partido, representante o modo de práctica.
Las bases y las jugadas aparecen directamente debajo, sin otro cuadro de marcador:
la información del juego se concentra en la pizarra resumen superior, incluido
el aviso cuando se cierra el seguimiento.
Se mantienen los avisos de error y de alineaciones faltantes. No se habilita la
anotación hasta recibir ambos lineups; no se inventa una entrega rival.
El guardado de cada jugada no muestra un aviso de confirmación adicional.
En ambas planillas, la barra de Bola, Strike y Faul también muestra todas
las jugadas ofensivas predeterminadas. Cada botón
registra inmediatamente la jugada con los avances mínimos por la llegada del bateador y actualiza
cuenta, corredores, marcador, estadísticas y hoja de anotaciones sin abrir paneles ni desplazar
la pantalla. «Deshacer última anotación», dentro del mismo grupo de botones,
revierte la jugada. No hay botones ni
paneles separados de «Anotar jugada» o «Cambios» en el juego: los corredores se
manejan desde las bases y los cambios de jugadores desde «Mi Alineación».
«Bola», «Strike» y «Faul» comparten el mismo color de botón.
Las jugadas que permiten embasarse se muestran en verde y las que registran un
out, incluidos los sacrificios, en rojo suave, según el resultado para el equipo
en ofensiva. «Deshacer última anotación» se muestra en ámbar tanto en este grupo
como en los menús de bases. Los botones conservan sus nombres y usan texto oscuro
sobre fondos suaves para no depender solo del color.
Se ordenan primero los tres picheos azules, luego las jugadas verdes (sencillo,
doble, triple, jonrón, golpeado y error), después los outs y sacrificios rojos,
y al final deshacer en ámbar. Un pequeño espacio separa los grupos sin añadir
títulos ni recuadros; los botones se ajustan al ancho disponible.
Las jugadas incompatibles con los corredores o eliminados actuales muestran un
error sin alterar la planilla guardada.
Un sencillo coloca al bateador en primera y solo desplaza a los corredores que
deban dejar sitio: si primera está vacía, el corredor de segunda permanece allí.
En dobles, triples y jonrones se respeta el orden de los corredores y se despejan
las bases alcanzadas por el bateador. Los avances adicionales se marcan desde
las bases. Las jugadas nuevas guardan sus
destinos explícitamente; las anteriores conservan sus avances y resultados al
recargar, sin reinterpretar lo que ya se había anotado.
El tercer strike pide distinguir ponche abanicando o cantado antes de registrar
el eliminado y pasar al siguiente bateador, sin un botón Ponche adicional en
Outs y sacrificios.
Sigue visible en la hoja y las estadísticas, también para planillas guardadas
anteriormente, que conservan el tipo desconocido.
OUT muestra Rolling / rodado, Línea, Elevado, Toque y Out por regla. Los cuatro
batazos abren una confirmación: se pulsa el número y nombre de las posiciones
en orden para construir la vía (6-3, 3-6-1, 4-6-3, etc.), sin un catálogo de
combinaciones. En líneas y elevados con out sencillo se pregunta primero
quién atrapó la pelota, mostrando posición y defensor activo. La elección se
reemplaza al pulsar otro defensor, no agrega una ruta ni participación previa.
Solo se registra quien atrapó. `caughtBy` conserva su identidad y posición en
comandos, historial y eventos oficiales, también al guardar y deshacer.
No se inventa el defensor de jugadas antiguas.
Cambiar entre atrapada sencilla y doble/triple limpia la selección
y exige completar el formulario correspondiente. Incluye una práctica separada.
Se pueden repetir posiciones, quitar el último defensor o limpiar
la vía. Nada se registra antes de confirmar. La posición 10 solo aparece con un
jardinero adicional activo en softbol.
Dentro se elige out sencillo, doble o triple jugada; la vía nunca determina el
número de outs. El bateador queda identificado como eliminado. Si hay un único
corredor para una doble jugada, o exactamente dos para una triple, se muestran
automáticamente como eliminados, sin pedir una selección redundante. Si hay más
corredores que outs adicionales, deben elegirse los eliminados. La confirmación
sigue exigiendo tipo de batazo y vía; no se registra nada al elegir la cantidad
de outs. Los demás permanecen en su base salvo
avance explícito. Primero se indican los destinos reales: el sacrificio por
elevado solo se habilita si hay carrera anotada y menos de dos outs; avanzar
de primera a segunda no lo habilita. El sacrificio de toque requiere un avance
real y menos de dos outs. Marcar o desmarcar sacrificio no cambia los destinos;
si se elimina el avance requerido, se quita la marca con una explicación.
La interfaz y el motor comparten esas condiciones, también en sacrificios con error.
Infield fly aparece en OUT y exige primera y segunda ocupadas (o bases llenas),
menos de dos outs y confirmación de la declaración arbitral. Registra un out del
bateador, turno oficial y elevado (FO), sin hit ni sacrificio, con código IFF.
No exige atrapada ni vía inventada. Los corredores conservan sus bases salvo
avances reales indicados; sus outs se registran aparte. La identificación se
conserva en historial, eventos oficiales, guardado y deshacer, sin reinterpretar
outs antiguos. Incluye una práctica separada con primera y segunda ocupadas.
La vía y el tipo se conservan en comandos, historial, planilla y eventos
oficiales, incluyendo guardado, recarga y deshacer. Las estadísticas ofensivas
incluyen GO, LO, FO, TO y GIDP; cuando falta clasificación antigua se muestra
desconocido, no un cero inventado. No se asignan asistencias ni outs individuales
defensivos solo a partir de la secuencia, porque no identifica quién realizó
cada eliminación. Los permisos de estadísticas no cambian.
Práctica del anotador incluye ejercicios de vías con corredores y ejemplos
anotados, separados de partidos reales y de los ejercicios anteriores.
La base por bolas tampoco se ofrece manualmente: la cuarta bola concede primera,
avanza solo a los corredores forzados y reinicia la cuenta para el siguiente bateador.
Las bases por bolas anteriores siguen visibles y conservan sus estadísticas.
La doble y triple jugada se eligen dentro del batazo. La jugada de selección
continúa en IN PLAY para los casos en que el bateador llega a salvo.
La selección simple, selección de dos outs y selección con error también
exigen tipo de batazo y vía antes de confirmar. Los destinos, errores, outs
evitados y el momento del tercer out se revisan por separado: una vía no
convierte al bateador a salvo en eliminado ni asigna un hit o un doble play
ofensivo. Los hits y errores con eliminados en sus destinos también piden
tipo y vía. El tercer strike caído con out pide vía, pero no tipo de batazo.
Atrapado robando, sorprendido y out al avanzar (incluido home) abren una
confirmación del recorrido defensivo. No se inventa un rolling ni una línea
en estas acciones. Ponches retenidos y outs por regla conservan su registro
propio, sin exigir un contacto o una vía inexistentes.
Un cambio del partido invalida el borrador; cancelar o corregir no anota nada.
Las jugadas anteriores sin recorrido permanecen legibles y no se completan
automáticamente con datos supuestos.
Las anotaciones anteriores se conservan sin reinterpretarlas.
«Out por regla» abre las causas del bateador: interferencia, bateo fuera de
turno por apelación, bateo fuera del cajón, segundo contacto ilegal, bate ilegal
o alterado, pelota dejada caer intencionalmente y otra causa con descripción.
También permite abrir el formulario específico de infield fly; su acceso
directo en OUT se conserva. Al elegir una causa se muestra su explicación y
se exige confirmar la decisión arbitral. Abrir, elegir, cambiar o cancelar no
registra nada. No se exige un recorrido inexistente ni se convierte en ponche.
Pelota dejada caer requiere primera ocupada, menos de dos outs y elevado o
línea fair; la vía real es opcional. Ese contacto sí conserva su clasificación
ofensiva, sin inventar asistencias o putouts defensivos individuales.
La apelación por bateo fuera de turno elimina a quien debía batear. Antes de
confirmarla, el anotador debe anular con Deshacer el turno indebido si lo
registró y verificar el bateador actual; los robos, WP, PB y balks anteriores
se conservan. No se reescriben jugadas anteriores automáticamente. Una
detección durante el turno, o una apelación ya fuera de plazo, no usa este out.
Cada causa queda en comandos, historial, planilla y eventos oficiales
(`batterRuleOut` sobre `ruleOut`, evento `OUT`), y se recupera con la misma
cuenta o tras reiniciar y deshacer. Las anotaciones antiguas sin causa siguen
siendo legibles sin asignarles una causa ficticia.
Se reinicia la cuenta, se consume un turno oficial y se elimina solo al
bateador, conservando los corredores. Otras decisiones arbitrales se anotan
aparte. Hay prácticas separadas para elegir causas y consultar ejemplos anotados.
Primera, segunda y tercera base despliegan, al pulsarlas, el mismo menú:
robo de base, atrapado robando, sorprendido fuera de base, avance de corredor,
corredor temporal y out por regla. Las acciones no válidas quedan deshabilitadas.
Los cuadros de las bases ocupadas tienen un fondo ligeramente más oscuro y un
borde más marcado; el resaltado se actualiza al mover corredores y al deshacer.
Sin aumentar su tamaño, muestran la base como título en una línea independiente.
Tras un pequeño espacio aparecen, en líneas separadas, el nombre,
«Bateo: … de …», el AVG del partido y, al final, la camiseta y posición actual
en letra más oscura y negrita. La tipografía y los espacios se compactan para
conservar las dimensiones del cuadro sin perder datos.
Los nombres largos se abrevian visualmente, conservando el nombre completo en la
descripción accesible y al pasar el cursor. Los corredores temporales muestran
sus propios datos, no las estadísticas del jugador al que reemplazan.
Al pulsar «Avance de corredor», los destinos se despliegan justo debajo de ese
botón, antes de las demás jugadas; al pulsarlo de nuevo se ocultan.
La causa «Avance por obstrucción defensiva» exige elegir la base concedida por
el árbitro e identificar un único defensor activo. Solo mueve al corredor
seleccionado: no inventa avances para los demás, outs, robos ni impulsadas.
Registra un error por la obstrucción, aunque se concedan varias bases, y muestra
«AV·OBS» en la fila del corredor. Los outs que habría evitado se pueden indicar
como 0 o 1; si no se conocen, la reconstrucción queda pendiente.
El ejercicio «Obstrucción defensiva · base concedida al corredor» conserva un
ejemplo del avance y permite practicar otro, con guardado y deshacer separados
de partidos existentes. Web y Expo conservan la misma causa y atribución.
«Jugada de selección» no aparece sin corredores. En web y Expo ofrece únicamente
outs compatibles con los corredores presentes: forzados si las bases anteriores
están ocupadas, o por toque al avanzar a la siguiente base o regresar a la propia
si no existe fuerza. Con bases llenas ofrece los forzados en segunda, tercera y
home. Elegir una opción prepara el bateador a primera, el corredor eliminado y
solo los avances obligatorios; confirmar guarda y cancelar no altera la planilla.
Los ajustes de destino no permiten retroceder, ocupar la misma base ni pasar a
otro corredor. Para varios eliminados se conservan las opciones de OUT.
No hay un botón rojo independiente de «Out forzado»: el bateador eliminado en
primera por un rodado se registra con «Eliminado por rodado», y los corredores
forzados con «Jugada de selección». La condición de fuerza y su efecto sobre
las carreras siguen vigentes; las anotaciones anteriores se conservan.
El botón verde «Jugada de selección · 2 outs», junto a selección normal después
de IN PLAY, está disponible con dos o más corredores y cero o un out previo.
Pregunta primero la base del primer out y después la del segundo, sin mostrar
una lista de combinaciones. Recalcula las posibilidades y las fuerzas después
del primero. Si una base admite un único out, lo identifica automáticamente;
solo pregunta cómo fue cuando hay varias posibilidades, distinguiendo al
corredor y el toque al avanzar o al regresar. Permite cambiar cualquiera de
los outs antes de guardar. Los dos eliminados quedan fijados y el bateador a
salvo, sin hit; al final solo se revisan los destinos de quienes siguen a salvo.
Con un out previo, solo cuenta una carrera anterior al tercer out por toque
si se confirma el tiempo; un tercer out forzado no permite carreras.
Las dobles jugadas forzadas y de fuerza invertida no generan RBI.
La planilla muestra «FC·DP» y los dos outs de corredores; el evento oficial es
DOUBLE_PLAY sin convertir al bateador en eliminado. Los ejercicios «Selección ·
2 outs · bases llenas», «Selección · 2 outs · un out previo» y «Selección · 2 outs ·
home y tercera anotados» permiten practicar, recargar y deshacer aisladamente.
Junto a ella, el botón verde «Selección + error» muestra los intentos compatibles
con las bases ocupadas e identifica al corredor que se salvó por el error.
Permite revisar sus destinos y marcar outs reales de otros participantes;
el corredor salvado no se convierte en un out. Exige atribuir cada error a un
defensor y confirmar las impulsadas. No suma un hit, conserva los outs evitados
para reconstruir las carreras y muestra «FC+E» en el turno del bateador.
Con dos outs, un intento fallido no termina la entrada; solo un tercer out real
aplica la regla de carreras por fuerza o por tiempo. Los ejercicios
«Selección + error · corredor en primera» y «Selección + error · dos errores anotados»
permiten practicar o revisar una jugada guardada y deshacer sin alterar otros partidos.
«Intento de out a otro corredor: todos quietos» requiere confirmar que la defensa
podía retirar al bateador en primera con esfuerzo normal; de lo contrario se debe
cancelar y anotar el hit correspondiente. Un tercer out forzado no admite carreras;
si el tercero es por toque, las carreras requieren indicar que llegaron antes y
que el bateador ya había alcanzado primera. Los ejercicios «Jugada de selección»
cubren las siete combinaciones de bases ocupadas, separados de partidos existentes.

**Desempate de softbol por defecto.** En las modalidades rápida, modificada y
lenta, tras siete entradas empatadas, cada media entrada extra comienza con
cero outs y el corredor del turno anterior al siguiente bateador en segunda.
Se usa la alineación vigente, incluidos los sustitutos; no necesariamente el
último out. Con duración explícita de nueve entradas comienza en la décima.
No se aplica al béisbol ni se coloca un corredor cuando ya existe un ganador.
La parte baja extra sí recibe su corredor aunque el visitante haya tomado ventaja.
No genera aparición al plato, hit, base robada ni error defensivo. Si anota,
su carrera se clasifica como sucia, también tras un relevo, reemplazo o jonrón.
El estado y la bitácora indican la colocación; la planilla web muestra «TB» sin
mezclar el detalle del último out de la media entrada anterior.
Motor compartido, anotación oficial (comandos y eventos directos), amistosos,
web y app mantienen la misma regla con guardado, recarga y deshacer.
Los guardados antiguos no se reescriben: si ya estaban en entradas extra,
adoptan la colocación desde el siguiente inning completo; si aún no llegaron,
se activa al comenzar sus extras. No se permite cambiar la duración después
de alcanzar las entradas extra. El ejercicio ficticio «Softbol · desempate en
el 8.º inning» está separado de otros ejercicios y partidos, en web y app.
En amistosos, la colocación requiere al menos dos bateadores distintos por equipo.

El corredor temporal permite
seleccionar al jugador sin abrir otra pantalla, conservando las reglas y la
confirmación compartida del partido real. El out por regla del corredor no
termina el turno ni cambia la cuenta del bateador, excepto al cerrar la media
entrada con el tercer eliminado. Los movimientos se reflejan en la fila del
corredor de la hoja de anotaciones y se pueden deshacer.
Los menús de primera, segunda, tercera y home incluyen «Deshacer última anotación»,
también con la base vacía. Revierte la última anotación oficial del partido, no solo
la de esa base, y conserva los movimientos compartidos confirmados.
Se deshabilita cuando no hay anotaciones disponibles para deshacer.
«Out al avanzar» permite elegir dónde intentaba llegar el corredor: segunda,
tercera o home. Se registra desde su base de origen; Home también permite elegir
qué corredor fue eliminado intentando anotar. Suma un out, retira solo a ese
corredor y conserva la cuenta del bateador salvo al completarse el tercer out.
No suma carrera, robo ni ponche y no reclasifica automáticamente el batazo.
El destino intentado queda en la hoja y en el guardado; la jugada puede deshacerse.
El dirigente recibe un partido preasignado en modo de solo lectura; la selección
corresponde al organizador o anotador. No escribe identificadores ni elige la fase.
Los cruces del ejemplo se resuelven desde resultados confirmados;
un empate o resultado pendiente no clasifica a ningún equipo. Este calendario
demostrativo todavía no está conectado a un motor real de torneos.

Con el API activo, ejecuta `npm run demo:seed` para preparar el torneo, equipos
y jugadores ficticios de la demo. No sobrescribe plantillas existentes.
La pantalla consulta la plantilla oficial automáticamente y permite usar sus
integrantes (`PRUEBA001` a `PRUEBA009` para los nueve titulares del ejemplo) para la alineación del día,
sin modificar esa plantilla. Las altas y bajas del torneo quedan fuera de este flujo;
no se presupone que exista un plazo de modificación. El API actual guarda estos
datos permanentemente: reiniciar no requiere volver a sembrarlos. La siembra
local exige `PLAYSPORT_DEMO_ACCOUNT_COOKIE` con la cookie de la cuenta de pruebas
autorizada; no la guardes en Git ni la compartas.
En una plantilla nueva, `PRUEBA19` a `PRUEBA21` también están inscritos en Tigres
para probar suplentes y llegadas tardías. Los suplentes no se declaran
presentes automáticamente. El script
conserva los anotadores existentes y añade `scorer-demo`, sin cambiar al organizador.
Los 23 jugadores ficticios tienen camisetas de referencia del 1 al 23.
En el cuadro web del lineup, la camiseta se elige manualmente del 00 al 99:
no se precarga ni se genera una alineación automática. Los otros formularios
de demostración conservan sus camisetas sugeridas al elegir un jugador o sustituto.
No se asignan números inventados a otros jugadores
ni se sobrescriben alineaciones ya entregadas o jugadas guardadas.
Los guardados privados históricos conservan sus camisetas, comandos, revisiones
y resultados; la nueva herramienta no escribe sobre ellos.
Los suplentes y jugadores que llegan tarde muestran su camiseta de prueba en las listas.
La preparación web usa una tarjeta beisbolera con cabecera local/visitante,
datos fijos del calendario y una tabla compacta de turnos, camisetas y posiciones,
adaptada también a pantallas pequeñas.

**Cancelar una entrega antes de iniciar:** el manager puede usar «Cancelar
lineup enviado» y confirmar para retirar únicamente su entrega de las bandejas
del rival y los oficiales. El cuadro vuelve a sus 13 filas vacías;
debe completarlo y enviarlo otra vez. Se mantienen el
dirigente, el roster permanente y el lineup rival. Las solicitudes pendientes
de esa entrega se cierran con una explicación, sin borrar su historial.
El servidor verifica el equipo, la revisión y la versión de la entrega.
Una vez iniciado el partido, ni volver la pizarra a «programado» permite cancelar:
los movimientos siguen a cargo del anotador u organizador.

En web siempre hay 13 filas disponibles, sin elegir antes una cantidad.
Se puede enviar con 9 a 13 titulares completos; las filas finales vacías no se envían:
la primera fila corresponde al primer bate, la segunda al segundo, etc.
Cada fila permite elegir un jugador del propio
roster, después su camiseta del 00 al 99 y su posición predefinida. No se escriben
cédulas, camisetas ni posiciones manualmente. Las selecciones parciales y los
turnos se conservan en el borrador al recargar o actualizar los datos del partido.
El selector de jugador es un desplegable que se recoge al elegir. Con el jugador
seleccionado quedan habilitadas tanto la camiseta como la posición defensiva;
ambas deben completarse antes de enviar.
Cada fila completa es un botón: abre el roster y los selectores de esa fila,
incluso si ya tiene jugador, camiseta y posición. «Listo» cierra la edición;
volver a tocar la misma fila permite reestructurarla sin cambiar el turno.
Esta edición solo está disponible antes de pulsar Enviar. Una alineación ya
entregada conserva su comprobante y el flujo existente de cambios oficiales.
«Reiniciar lineup» pide confirmación y vacía únicamente el borrador
de ese partido: jugadores, camisetas, posiciones, roles y FLEX.
Restaura las 13 filas vacías, también al recargar. No modifica
el roster, dirigente, suplentes, personal presente ni las alineaciones enviadas.
El enlace `/demo/manager-games?game=ID_DEL_PARTIDO` abre directamente ese encuentro,
si está asignado al equipo y torneo activos; no sustituye el ID solicitado por
otro partido ni borra alineaciones o borradores previos.
Vaciar o reemplazar un jugador no desplaza las otras filas; los huecos intermedios
deben completarse antes de enviar, al igual que cualquier fila a medio llenar.
Los turnos finales sin usar son opcionales, incluso en borradores antiguos.
Puede añadirse un FLEX
sin bateo; los roles DP/FLEX y bateador extra siguen disponibles.
Los jugadores, camisetas y posiciones ya elegidos no pueden repetirse en otra fila.
Al vaciar una fila, sus opciones vuelven a estar disponibles.
El formulario, el API y el motor compartido rechazan
posiciones repetidas, incluidas las sustituciones; los intercambios defensivos
mantienen una sola persona por puesto. `NA` representa ausencia de posición
defensiva y puede usarse en varios bateadores extras.
Al entregar quedan fijas tanto la cantidad de turnos titulares como la cantidad
de defensores. Una sustitución hereda el turno y debe conservar ambas cantidades;
un intercambio defensivo puede mover jugadores, pero no agregar ni quitar defensores.
`DH` y `NA` no cuentan como defensores; FLEX sí cuenta. El servidor aplica la regla
a solicitudes, confirmaciones y cambios oficiales directos, también desde móvil.
Antes de comenzar se conserva la opción de cancelar la entrega y rehacerla.
El selector de sustituciones durante el partido muestra solo posiciones libres
y la del jugador saliente que conserven la cantidad inicial de defensores. Los intercambios entre dos jugadores
activos se eligen por separado, sin ofrecer puestos ocupados como destinos libres,
y siguen requiriendo confirmación del anotador u organizador.

En móvil, el orden de bateo se asigna según se agregan los jugadores a la
alineación; al eliminar uno se renumeran los turnos. En web, el orden lo determina
la fila elegida y no se renumera al vaciarla. El jugador flexible no ocupa turno.

La preparación web y móvil reúne en una misma pantalla los datos fijos del partido,
la selección del dirigente de ese encuentro y el constructor del lineup.
En web no se repite el roster completo: los jugadores se consultan en el
desplegable de cada turno y los suplentes disponibles se muestran en tarjetas
de banca con su estado de presencia. El personal técnico se elige en un apartado
opcional desplegable; en móvil se mantiene la vista del roster completo.
Se elige al dirigente entre los integrantes del roster, incluidos
dirección, coaches y apoyo; no se cambia el manager permanente ni su cuenta.
El personal presente también se selecciona del roster con su cargo existente.
Solo los jugadores pueden entrar al lineup; allí se determina orden de bateo,
posición, camiseta y suplentes presentes, sin editar el roster permanente.
Al enviarla correctamente se abre la consulta oficial en vivo.
La apertura ocurre al confirmarse el envío, sin esperar una segunda consulta
del comprobante; si esa consulta falla se informa que la entrega sí se realizó.
La autorización se guarda en el API para ese equipo y
partido, se muestra junto a la alineación y no cambia al dirigente permanente ni da
acceso a su cuenta. Se conserva al recargar y al reiniciar el API.
La preparación solo permite organizar y enviar la alineación del partido: no
incluye edición del roster ni estadísticas ficticias de un juego ya iniciado.

La planilla oficial del anotador y organizador registra bolas, strikes, faltas, resultados del turno,
destinos de los corredores, robos, carreras, corredor temporal, sustituciones,
cambios defensivos. El motor y los controles diseñados anteriormente se reutilizan;
los guardados privados históricos se conservan sin modificarlos.
La cuarta bola y el tercer strike terminan el turno;
tres eliminados cambian la mitad de entrada. Los botones anotan inmediatamente
con los avances mínimos, incluido «Se embasa por error», sin confirmación adicional;
los menús de bases permiten registrar otros avances y sus causas. En movimientos
independientes de varios corredores, anota primero el más adelantado.
No se muestra una lista de historial aparte: las jugadas se ven en la hoja de
anotaciones. Se conserva el registro interno para guardar, calcular estadísticas
y deshacer anotaciones oficiales, incluso el cierre. La versión oficial siempre
aumenta, también al deshacer. Un movimiento de personal confirmado establece un
límite: no se deshacen jugadas previas atravesando ese cambio de alineación.
El selector «Duración» permite definir softbol a 7 entradas o béisbol a 9 para
el partido oficial. La selección se guarda en el API, no cambia las
jugadas ya registradas. Los partidos anteriores quedan
«Sin definir» hasta elegir una duración; no se presupone que todo juego sea de softbol.
Al terminar la alta de la última entrada con el local arriba, al anotar el local
la carrera de la ventaja en la baja, o al completar una entrada reglamentaria
sin empate, se ofrece confirmar el final oficial. Con empate se continúa y
se aplican las mismas condiciones en las entradas extra.
El aviso no bloquea la anotación: «Seguir anotando» lo oculta para poder corregir
o completar jugadas, y «Confirmar final del partido» publica el cierre oficial.
Deshacer permite revertir tanto la jugada que originó el aviso como el cierre,
sin afectar los movimientos compartidos confirmados. Al recargar, un cierre
confirmado permanece cerrado; si no se confirmó, el aviso puede volver a mostrarse.
Esta detección no aplica reglas de diferencia de carreras, límite de tiempo,
empates permitidos u otras condiciones particulares del torneo.

#### Carreras limpias y sucias

El motor compartido conserva la compatibilidad con los guardados históricos y calcula CL, CS y
carreras pendientes de revisión. El lanzador se identifica desde la posición P
de la defensa vigente; sus cambios deben registrarse antes de seguir anotando.
Cada corredor conserva la responsabilidad del lanzador que lo dejó en base,
también con corredor temporal o sustitución. Una base por bolas con relevo a
cuenta de 2-0, 2-1 o tres bolas conserva la responsabilidad anterior; a 2-2
corresponde al relevista.

«Se embasa por error» guarda la jugada con un toque. Justo después se puede
completar el detalle opcional de cuántos outs evitó: actualiza la misma jugada,
sin sumar otro turno ni otra anotación. Si falta ese detalle, no se inventa.
Los avisos de rechazo aparecen junto a la barra de jugadas para que un resultado
no permitido (como un elevado de sacrificio que no produce carrera) no parezca
un botón sin respuesta. En «Avance de corredor»
se elige la causa: jugada sin error, error defensivo, bola pasada, lanzamiento
descontrolado o movimiento ilegal. Un error en foul que debió ser atrapado se
registra por separado, sin terminar el turno ni modificar la cuenta. No se
cuenta dos veces al mismo jugador si posteriormente queda eliminado.

El panel plegable «Carreras limpias y sucias» muestra totales del equipo y de
cada lanzador responsable. Los outs virtuales permiten detectar carreras sucias
después del tercer out que debió ocurrir. No se supone que todas las carreras
posteriores a cualquier error sean sucias: un jonrón posterior, por ejemplo,
puede hacer irrelevante un avance previo por bola pasada.
Una carrera puede ser sucia para el equipo y limpia para un relevista que no
recibió las oportunidades anteriores de out.

Los avances ambiguos, errores históricos sin detalle, oportunidades de varios
outs sin identificar a todos los eliminados hipotéticos y otras reconstrucciones
no concluyentes quedan **pendientes**, no se suman a CL ni CS. El anotador puede
revisar cada carrera con una justificación y clasificar por separado para equipo
y lanzador. No se pretende sustituir todo el juicio reglamentario con una
simulación automática de bases. Los guardados privados existentes no se
reescriben ni cambian de versión; el desglose se deriva al reproducirlos y las
revisiones nuevas pueden deshacerse.

En las vistas web de anotador y organizador hay un registro oficial de jugadas
y el mismo panel de revisión. El dirigente rival no recibe esos controles.
En móvil, la anotación oficial también captura los outs evitados y las nuevas
causas de avance, y muestra CL/CS/pendientes del lanzador. Un marcador oficial
ajustado sin sus jugadas muestra que el desglose está incompleto.
El servicio oficial usa el almacenamiento permanente y los permisos por cuenta
descritos arriba.

Las casillas por jugador y entrada muestran solo resultados abreviados:
1B/2B/3B/HR, K, BB, E, GP, BR, C, OUT y OR, conservando también sacrificios
y resultados antiguos. Los picheos y avances intermedios no llenan la casilla.
No se muestra una leyenda de abreviaturas en la pantalla; el detalle explica cada actuación.
Mientras no hay resultado, «...» permite consultar los picheos ya registrados.
Al mantener pulsada una casilla aparece su detalle completo; desaparece al
soltar, retirar el puntero o dedo, cancelar el gesto o perder el foco.
Con teclado se mantiene Espacio o Enter; Escape también lo cierra.
Este resumen no modifica las anotaciones, estadísticas ni guardados existentes.
«Embasado por regla» queda pendiente: no se confunde con «Out por regla».
Las anotaciones actuales se guardan en el API oficial y se comparten por SSE con
ambos managers. «Ver partido oficial en vivo» recupera esa misma fuente después
de recargar. Las pestañas ocultas liberan sus conexiones en vivo y recuperan
una instantánea actualizada al volver a mostrarse, evitando bloquear la carga
del partido por exceso de conexiones abiertas. La carga inicial tiene un límite
de 10 segundos; si falla, informa el error y permite reintentar.
Los guardados privados anteriores permanecen separados en
`localStorage`, sin nuevas escrituras ni migración automática.
El anotador u organizador registra directamente los cambios comunicados en el
campo, sin requerir una solicitud digital del manager. Se aplica
la regla del corredor temporal del organizador, consultada nuevamente antes de
cada uso y conservada con la jugada para reproducir el historial;
no se certifican reglas de reingreso ni transiciones especiales DP/FLEX.
Si aún no se recibió la alineación rival, la consulta lo informa y la anotación
queda bloqueada. Las estadísticas se asocian a jugadores identificados. El final
requiere confirmación del oficial; no se certifican automáticamente reglas especiales.

### Entrega de alineaciones y personal presente

El envío inicial incluye los suplentes marcados como presentes y los directivos:
dirigente y manager como cargos distintos, y delegados. No incluye coach de
primera ni de tercera. El nombre y la cédula declarados para un directivo no
crean una cuenta ni conceden permisos.

La entrega y sus movimientos llegan en vivo a las bandejas del organizador, los
anotadores autorizados para el juego y el dirigente contrario. Los enlaces de la
demo abren esos roles con sus cuentas ficticias en otras pestañas. Son bandejas dentro de la
aplicación, no correos ni notificaciones push, y no certifican lectura.
Las identidades de la demo siguen el esquema actual de identificadores enviados
al API; no sustituyen una autenticación real de producción.

Después de la primera entrega no se permite sobrescribirla: una repetición
idéntica no reinicia el turno; una edición requiere el flujo de movimientos.
Al volver a entrar, el tercer paso recupera la alineación entregada, sus suplentes,
directivos y cambios confirmados, y permite continuar a la planilla sin reenviar
ni volver a llenar un borrador vacío. Antes de un primer envío se mantienen las
validaciones; sus mensajes aparecen junto al botón y reciben el foco.
Sustituciones, posiciones, corredor temporal y cambios en directivos se registran
por el anotador u organizador, revalidando plantilla, presencia y regla del torneo.
Se comprueban tanto la revisión del lineup como la versión oficial para evitar
pisar una jugada o un cambio concurrente. Las solicitudes antiguas conservan
su historial y pueden confirmarse o rechazarse con motivo. Los managers no editan
el registro oficial ni modifican el roster aprobado.

Un inscrito que llega tarde pasa a los suplentes presentes cuando se confirma
su llegada; no obtiene un turno adicional. Para jugar requiere una sustitución
oficial. Estos procesos nunca inscriben a alguien nuevo en el roster.
El corredor temporal debe coincidir con una base y corredor reales de la pizarra.
Las entregas y anotaciones se conservan al recargar el navegador y al reiniciar
la API, incluidos los cambios confirmados de personal y el historial de deshacer.

Pruebas de entregas y del motor privado:

```bash
TS_NODE_PROJECT=apps/api/tsconfig.json node --test -r ts-node/register apps/api/test/field-representative.test.cjs apps/api/test/team-sheets.test.cjs apps/web/test/private-scorecard.test.cjs
```
