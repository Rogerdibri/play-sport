# PlaySport

PlaySport conecta atletas, equipos, ligas y comunidades deportivas en una sola plataforma.

## Módulos

Auth, usuarios, organizadores, ligas, torneos, equipos, plantillas, jugadores, partidos, marcador en vivo, posiciones, honores, mapa de eventos, sedes y reseñas, noticias, moderación, scouting, medios, marketplace, patrocinadores y notificaciones.

## Requisitos

- Node.js 20+
- npm 10+
- Docker (opcional, para PostgreSQL)

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
El ponche no se ofrece como jugada manual: el tercer strike lo registra
automáticamente, suma el eliminado y pasa al siguiente bateador. Sigue visible
en la hoja de anotaciones y las estadísticas, también para planillas guardadas anteriormente.
«Out al batear» sustituye en los botones a los outs por rodado,
línea y elevado; también sirve para un toque fallido sin avance. Suma el
eliminado y un turno oficial al bate, sin avanzar corredores ni registrar un
ponche o sacrificio. Los outs específicos de planillas anteriores se conservan.
La base por bolas tampoco se ofrece manualmente: la cuarta bola concede primera,
avanza solo a los corredores forzados y reinicia la cuenta para el siguiente bateador.
Las bases por bolas anteriores siguen visibles y conservan sus estadísticas.
La doble jugada, triple jugada y jugada de selección no se ofrecen entre las
opciones de bateo de la barra. Las anotaciones
anteriores se conservan; todavía no se incorporan a las jugadas de embasados.
«Out por regla» registra al bateador eliminado con un toque, sin exigir motivo.
Reinicia la cuenta y actualiza el turno; no avanza corredores automáticamente,
no suma ponche y, si es el tercer eliminado, cierra la media entrada.
Se conserva en la hoja de anotaciones, el guardado local y las estadísticas; puede deshacerse.
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
datos en memoria: si se reinicia, vuelve a ejecutar `npm run demo:seed`.
En una plantilla nueva, `PRUEBA19` a `PRUEBA21` también están inscritos en Tigres
para probar suplentes y llegadas tardías. «Generar alineación base» usa nueve
jugadores; los restantes no se declaran presentes automáticamente. El script
conserva los anotadores existentes y añade `scorer-demo`, sin cambiar al organizador.
Los 23 jugadores ficticios tienen camisetas de prueba del 1 al 23. Se precargan
al seleccionar un jugador, generar la alineación base o elegir un sustituto;
pueden editarse antes del envío. No se asignan números inventados a otros jugadores
ni se sobrescriben alineaciones ya entregadas o jugadas guardadas.
Los guardados privados históricos conservan sus camisetas, comandos, revisiones
y resultados; la nueva herramienta no escribe sobre ellos.
Los suplentes y jugadores que llegan tarde muestran su camiseta de prueba en las listas.
La verificación del partido muestra además una tabla de
consulta con las camisetas de los 23 jugadores ficticios, incluidos `PRUEBA22`
y `PRUEBA23`, que no pertenecen a los rosters del ejemplo. Consultarla no declara
presencias, no entrega la alineación rival y no modifica las plantillas oficiales.
Los borradores anteriores que conservaron camisetas vacías también se completan
automáticamente, sin borrar jugadores, posiciones, orden de bateo ni números
personalizados; el envío vuelve a comprobar esta reparación antes de validar.
En la preparación, elegir una posición agrega o actualiza inmediatamente al jugador,
con su camiseta y rol, y retira esa posición del selector sin pulsar un botón de
agregar. El selector vuelve al aviso inicial y queda preparado para elegir otro
jugador; la posición se libera al retirarlo. Al editar se conserva disponible
la posición propia. El formulario, el API y el motor compartido rechazan
posiciones repetidas, incluidas las sustituciones; los intercambios defensivos
mantienen una sola persona por puesto. `NA` representa ausencia de posición
defensiva y puede usarse en varios bateadores extras.
El selector de cambios durante el partido aplica el mismo filtro: muestra solo
posiciones libres y la del jugador saliente. Los intercambios entre dos jugadores
activos se eligen por separado, sin ofrecer puestos ocupados como destinos libres,
y siguen requiriendo confirmación del anotador u organizador.

En web y móvil, el orden de bateo se asigna según se agregan los jugadores a la
alineación. Actualizar un jugador conserva su lugar; al eliminarlo se renumeran
los turnos. El jugador flexible no ocupa turno de bateo.

La demo web se divide en cuatro pantallas: verificar el partido asignado, autorizar
por cédula a un integrante de la plantilla como representante en el campo y
preparar la alineación; al enviarla correctamente se abre la consulta oficial en vivo.
La apertura ocurre al confirmarse el envío, sin esperar una segunda consulta
del comprobante; si esa consulta falla se informa que la entrega sí se realizó.
La autorización se guarda en el API para ese equipo y
partido, se muestra junto a la alineación y no cambia al dirigente permanente ni da
acceso a su cuenta. Al recargar se conserva mientras no se reinicie el API.
El tercer paso solo permite preparar y enviar la alineación del partido: no
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
El servicio oficial de demostración continúa siendo en memoria: no constituye
almacenamiento durable para producción.

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
demo abren esos perfiles ficticios en otras pestañas. Son bandejas dentro de la
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
Las entregas y anotaciones del API de demostración siguen siendo datos en memoria:
recargar el navegador los conserva; reiniciar el API no equivale a almacenamiento
duradero de producción.

Pruebas de entregas y del motor privado:

```bash
TS_NODE_PROJECT=apps/api/tsconfig.json node --test -r ts-node/register apps/api/test/field-representative.test.cjs apps/api/test/team-sheets.test.cjs apps/web/test/private-scorecard.test.cjs
```
