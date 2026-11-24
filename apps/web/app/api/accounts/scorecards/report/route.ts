import { NextRequest, NextResponse } from 'next/server';
import { proxyJsonService } from '../../../service-proxy';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].some(key => key !== 'scope') || !request.nextUrl.searchParams.get('scope'))
    return NextResponse.json({ message: 'Consulta el resumen de una planilla de tu propia cuenta.' }, { status: 400 });
  const base = process.env.PLAYSPORT_ACCOUNTS_API_BASE ?? 'http://localhost:4000/api/accounts';
  return proxyJsonService(request, `${base}/scorecards/report${request.nextUrl.search}`, 1048576,
    'No se pudo conectar con el servicio de resúmenes de tu cuenta.');
}
