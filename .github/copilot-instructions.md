- [x] Verify that the copilot-instructions.md file in the .github directory is created.
Summary: Archivo creado y ubicado en .github/copilot-instructions.md.

- [x] Clarify Project Requirements
	Summary: Requisitos definidos por el usuario: monorepo TypeScript con web (Next.js), móvil (Expo), API (NestJS), Prisma/PostgreSQL, módulos de dominio PlaySport.

- [x] Scaffold the Project
	Summary: Estructura monorepo creada con apps web/móvil/api, paquete compartido, Prisma, Docker Compose y README.

- [x] Customize the Project
	Summary: Se personalizó PlaySport con módulos de dominio solicitados y branding base en web/móvil/API.

- [x] Recommend Required Extensions
	Summary: No había extensiones obligatorias en el setup; se dejó .vscode/extensions.json con recommendations vacío.

- [x] Compile the Project
	Summary: Node.js/npm instalados, dependencias instaladas y build del monorepo completado en verde.

- [x] Create and Run Task
	Summary: Tarea VS Code creada (PlaySport: dev all); ejecución falló por ausencia de npm en el entorno.

- [x] Launch the Project
	Summary: Proyecto lanzado en desarrollo: web (Next.js), API (NestJS) y móvil (Expo web) activos.

- [x] Ensure Documentation is Complete
	Summary: README.md existe y el checklist fue actualizado; se removieron comentarios HTML del archivo.

- Work through each checklist item systematically.
- Keep communication concise and focused.
- Follow development best practices.

## Revision visual y demostraciones de PlaySport

- Antes de mostrar cambios de interfaz, abrir las pantallas afectadas en escritorio y movil, revisar capturas y comprobar alineacion, anchura de encabezados/filtros/tarjetas, legibilidad y controles plegados/desplegados. No basta con pasar pruebas o comprobar ausencia de desbordamiento.
- Preparar ejemplos reutilizables para demostrar las funciones entregadas, conectados a los filtros y detalles correspondientes y separados de cuentas reales y partidos existentes; nunca sobrescribir datos para preparar una demostracion. No mostrar avisos repetitivos de datos ficticios, demo o demostracion en las pantallas. Conservar las restricciones de permisos, solo lectura y dinero real deshabilitado.
- En el encabezado del inicio de cada rol mostrar solamente el nombre guardado de la persona y el rol activo; nunca inventar una identidad si falta el nombre.

## Coherencia del ecosistema PlaySport

- La referencia visual aprobada es la web principal. No sustituirla por la interfaz de pruebas de Expo ni presentar esta ultima como un nuevo diseno aprobado.
- La decision de producto es una sola interfaz: web adaptable a escritorio/movil, integrada en la app mediante WebView. Expo web abre esa misma web; no reintroducir un panel nativo paralelo. Guardar amistosos y planillas privadas requiere iniciar sesion; la consulta publica y la practica no.
- Revisar cada cambio en todas sus superficies correspondientes: web de escritorio, web movil, app Expo, API y reglas compartidas. Compartir un motor o aprobar pruebas aisladas no demuestra una entrega integrada.
- Los datos de usuario y de partidos deben recuperarse mediante la misma cuenta y conservar su titularidad, privacidad y permisos al cambiar de dispositivo, plataforma o rol. No usar una identidad de ejemplo o una clave exclusivamente local como sustituto de la cuenta autenticada.
- Comprobar la continuidad entre clientes con datos de prueba aislados: guardar en uno, recuperar en otro y verificar permisos y conflictos de revision. Mantener las practicas separadas de los partidos existentes; no migrar, reasignar ni sobrescribir datos reales para preparar una prueba.
- No mostrar cifras de ejemplo como datos actuales de la cuenta o del ecosistema. Declarar las diferencias pendientes de apariencia, funcionamiento y sincronizacion; no dar por terminado el ecosistema mientras esas brechas sigan abiertas.
