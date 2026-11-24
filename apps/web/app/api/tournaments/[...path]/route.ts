import { NextRequest, NextResponse } from 'next/server';
import { proxyJsonService } from '../../service-proxy';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const valid =
    (path.length === 1 && ['public', 'manager', 'capacity','admin-capacity'].includes(path[0])) ||
    (path.length === 2 &&
      ((path[0] === 'public' && /^[a-f0-9-]{36}$/.test(path[1])) ||
        (/^[a-f0-9-]{36}$/.test(path[0]) && ['roster', 'history'].includes(path[1]))));
  if (!valid) return NextResponse.json({ message: 'La consulta de torneos no existe.' }, { status: 404 });
  if (path[0] === 'capacity' && request.nextUrl.search)
    return NextResponse.json({ message: 'La capacidad propia no admite parámetros.' }, { status: 400 });
  return proxyJsonService(
    request,
    `${process.env.PLAYSPORT_TOURNAMENTS_API_BASE ?? 'http://localhost:4000/api/tournaments'}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`,
    1048576,
    'No se pudo consultar el torneo.'
  );
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.length !== 1 || !['manager', 'free-reservation','plan-selection','plan-authorization','restart-game'].includes(path[0]) || request.nextUrl.search)
    return NextResponse.json({ message: 'La operación de inscripción no existe.' }, { status: 404 });
  return proxyJsonService(request, `${process.env.PLAYSPORT_TOURNAMENTS_API_BASE ?? 'http://localhost:4000/api/tournaments'}/${path[0]}`,
    1048576, path[0] === 'manager' ? 'No se pudo guardar la inscripción.' : 'No se pudo guardar la reserva gratuita.');
}
