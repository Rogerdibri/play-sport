import { NextRequest, NextResponse } from 'next/server';
import { proxyJsonService } from '../service-proxy';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  if (request.nextUrl.search)
    return NextResponse.json({ message: 'La lista de logos no admite parámetros.' }, { status: 400 });
  return proxyJsonService(
    request,
    process.env.PLAYSPORT_LOGOS_API_BASE ?? 'http://localhost:4000/api/institutional-logos',
    92160,
    'No se pudo consultar la identidad visual.'
  );
}
export const POST = GET;
