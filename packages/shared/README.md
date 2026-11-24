# Catálogo territorial y calendario

`src/venezuela.ts` contiene datos permanentes de Venezuela, no fixtures deportivos.
Incluye los **335 municipios** de 23 estados administrados y el Distrito Capital.
Dependencias Federales no tiene división municipal. Guayana Esequiba se presenta
como territorio en disputa, reclamado por Venezuela y administrado por Guyana,
sin inventar una división municipal venezolana ni representarla como establecida.

## Fuente y atribución

Adaptado de [Venezuela-JSON, zokeber y colaboradores](https://github.com/zokeber/venezuela-json),
bajo [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Se conservaron estados y municipios; se omitieron capitales, ciudades y parroquias.
Consulta y contraste: 4 de noviembre de 2026, usando la
[referencia de municipios por estado](https://es.wikipedia.org/wiki/Anexo:Municipios_de_Venezuela).
La fuente comunitaria no sustituye una certificación oficial del catálogo.

Correcciones respecto del JSON original:

- Estado Vargas → La Guaira; su municipio sigue llamándose Vargas.
- Bolívar: Heres → Angostura del Orinoco; Píar → Piar.
- Carabobo: Mora → Juan José Mora.
- Zulia: Páez → Guajira.
- Anzoátegui: McGregor → Sir Arthur McGregor.
- Guárico: nombres completos de Leonardo Infante, Juan José Rondón,
  Julián Mellado, Francisco de Miranda, José Tadeo Monagas, José Félix Ribas
  y Juan Germán Roscio.
- Trujillo: Juan Vicente Campo Elías y José Felipe Márquez Cañizales.

Los IDs estatales originales usan ISO 3166-2. Los IDs de municipios y entidades
sin municipios son identificadores internos de la plataforma, **no códigos
oficiales municipales**. Los municipales conservan la forma del nombre original
para que una corrección del nombre visible no cambie referencias guardadas.

`src/events-calendar.ts` valida fechas gregorianas (años 0001–9999), conserva
fechas locales sin convertirlas al día UTC y calcula hoy en `America/Caracas`.
No hay un corte de antigüedad ni generación automática de resultados al pasar
un día. La cartelera filtra por la ubicación de la sede del partido, sin
excluir juegos por su estado.

Los juegos ficticios compartidos por web y móvil están en
[`src/demo-calendar.ts`](src/demo-calendar.ts); el anterior
[`event-examples.ts`](../../apps/web/app/demo/[slug]/event-examples.ts)
los reexporta para conservar los imports de la cartelera.
Los nombres, direcciones de referencia y coordenadas de sus cuatro estadios
son reales, con fuentes en cada registro. La dirección del José Bernardo Pérez
se contrastó con [Mapcarta / OpenStreetMap](https://mapcarta.com/es/W510866094).
Se usan lugares o sectores de referencia donde no se ha verificado una calle,
sin inventar calles ni números de inmueble.
`calendarDirectionsUrl` valida las coordenadas y genera un enlace externo de
Google Maps Directions, sin origen ni clave. No carga mapas en la plataforma.
Esos fixtures no anuncian partidos reales en los estadios,
no se mezclan con el marcador oficial y no envían comandos al API.

`src/standings.ts` calcula la tabla únicamente con juegos finalizados:
ganados, perdidos y serie directa entre dos equipos igualados. Los empates sin
resolver comparten posición; los equipos sin resultados no tienen posición.
Devuelve totales, racha, explicación y partidos de respaldo sin modificar la
entrada. Rechaza juegos duplicados, equipos ajenos y marcadores finales
inválidos. `src/demo-standings.ts` delimita ligas y torneos de ejemplo para
impedir que una temporada, disciplina o liga incorpore resultados de otra.
`src/game-protest.ts` define el momento congelado y el acta de mesa técnica.
`src/official-games.ts` valida el estado `protested` y la coherencia de equipos y
resolución. `src/official-standings.ts` calcula por identificador de torneo y equipo,
sin mezclar las tablas ficticias. Los pendientes no cuentan; `decidedWinner`
adjudica victoria/derrota sin cambiar carreras y marca la evidencia como decisión
técnica. Ese ganador se usa también en racha y enfrentamiento directo.
`src/official-results.ts` concentra el resultado visible (`officialGameResult`):
solo los finales tienen ganador, el acta prevalece sobre las carreras y una
protesta pendiente no produce victoria/derrota. `officialGameNames` resuelve los
nombres por ID de equipo, y `readOfficialObservation` valida la pizarra recibida
con su estado y protesta reales, sin inferirlos de `scorecard.finished`.
Cartelera, consultas de roles y tablas reutilizan estas proyecciones y conservan
los marcadores y estadísticas originales. El catálogo oficial es independiente
de los fixtures territoriales: sus sedes aún no incluyen estado ni municipio.

## Registro de personas y representados

`src/friendly-games.ts` valida los equipos y participantes por nombre, reconstruye
la planilla y proporciona el cliente privado y los borradores comunes a web y móvil.
La creación exige 9 a 12 participantes por equipo con nombre y posición válida,
sin posiciones repetidas salvo «Sin asignar». La marca `seed.friendly` conserva
la lectura de amistosos antiguos reducidos sin relajar el mínimo de nueve bateadores
de las planillas ordinarias. No registra personas ni añade camisetas.
`RegistrationClient.accessKey()` reutiliza el acceso privado local existente,
sin requerir un perfil adulto ni exponer la clave en las rutas.

`src/registration.ts` comparte entre API, web y móvil la validación del adulto
responsable (cédula, nombre, nacimiento, estado/municipio y correo o teléfono) y del menor
(nombre, nacimiento, ubicación, relación y autorización; documento opcional).
Separa documento legal, código privado de registro e ID permanente. Los sufijos
no se calculan en los clientes: los asigna y persiste la API.
`validateRegistrationContact` exige al menos un contacto y valida todos los
proporcionados; los adultos antiguos sin campo `phone` siguen siendo legibles.

`src/roster.ts` define cargos, preinscripciones mínimas y `RosterClient`.
Separa persona, cargo e incorporación directa; valida el contexto del equipo en
las respuestas. Las consultas ordinarias solo contienen identidad deportiva y
estado, nunca nacimiento/contacto. Las preinscripciones se persisten en la API
y sus jugadores pueden seleccionarse en el lineup sin aprobación individual.
La confirmación personal permanece separada. La invitación privada permite recuperar datos desde
`RegistrationClient.recoverPreRegistration`; confirmar mediante el registro
adulto o familiar conserva el mismo ID, sin una segunda persona.

`src/roster-rules.ts` comparte grupos, cupos, validación de reglas, cálculo del
cierre global y `RosterRulesClient`. Una sola modalidad (fecha, ronda o juegos)
cierra para todos los equipos; el servidor persiste el cierre y controla revisión,
reapertura y cupos. No contiene titulares, suplentes ni posiciones defensivas.

`src/registration-client.ts` conserva por cuenta local el acceso privado al
registro familiar y el borrador incompleto del menor. No usa cédulas como
credenciales ni coloca el acceso en URL. Propaga errores de red, validación y
almacenamiento sin recrear silenciosamente un acceso perdido.
`src/demo-profile.ts` recupera perfiles anteriores sin eliminar sus campos y
exige nacimiento y al menos correo o teléfono al volver a guardar. Solo se deben usar datos ficticios;
la autenticación real, la verificación documental y la recuperación de acceso
no están implementadas.
