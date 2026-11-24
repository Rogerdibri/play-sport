import { NextRequest } from 'next/server';
import { proxyJsonService } from '../service-proxy';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return proxyJsonService(
    request,
    `${process.env.PLAYSPORT_TOURNAMENTS_API_BASE ?? 'http://localhost:4000/api/tournaments'}${request.nextUrl.search}`,
    1048576,
    'No se pudo consultar o guardar el torneo.'
  );
}
export const POST = GET;
