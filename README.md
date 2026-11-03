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
