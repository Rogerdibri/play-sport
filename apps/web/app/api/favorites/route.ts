import { NextRequest, NextResponse } from 'next/server';
import { proxyJsonService } from '../service-proxy';

export const dynamic = 'force-dynamic';
async function handle(request: NextRequest) {
  if (request.nextUrl.search)
    return NextResponse.json({ message: 'Los favoritos no admiten parámetros de identidad.' }, { status: 400 });
  const base = process.env.PLAYSPORT_FAVORITES_API_BASE ?? 'http://localhost:4000/api/favorites';
  return proxyJsonService(request, base, 8192, 'No se pudo conectar con tus favoritos. Vuelve a intentar.');
}
export const GET = handle;
export const POST = handle;
