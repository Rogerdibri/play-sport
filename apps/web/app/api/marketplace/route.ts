import { NextRequest, NextResponse } from 'next/server';
import { readMarketplaceQuery } from '@playsport/shared';
import { proxyJsonService } from '../service-proxy';

export const dynamic = 'force-dynamic';
async function handle(request: NextRequest) {
  try {
    if (request.method === 'POST' && request.nextUrl.search) throw new Error('La consulta del Marketplace no es válida.');
    readMarketplaceQuery(request.nextUrl.searchParams.entries());
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'La consulta del Marketplace no es válida.' }, { status: 400 }); }
  return proxyJsonService(request, `${process.env.PLAYSPORT_MARKETPLACE_API_BASE ?? 'http://localhost:4000/api/marketplace'}${request.nextUrl.search}`,
    80 * 1024, 'No se pudo conectar con el Marketplace. Los partidos y sus anotaciones siguen siendo independientes.');
}
export const GET = handle;
export const POST = handle;
