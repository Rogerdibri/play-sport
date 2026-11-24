import { NextRequest, NextResponse } from 'next/server';
import { proxyJsonService } from '../../service-proxy';
export const dynamic = 'force-dynamic';
async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (
    path[0] !== 'registration' ||
    path[1] !== 'roster' ||
    path.length !== 3 ||
    !['teams', 'members', 'person', 'preinscriptions', 'invitation', 'player-teams', 'manager-teams'].includes(path[2]) ||
    ['player-teams', 'manager-teams'].includes(path[2]) && (request.method !== 'GET' || Boolean(request.nextUrl.search))
  )
    return NextResponse.json({ message: 'La operación deportiva no existe.' }, { status: 404 });
  const base = (process.env.PLAYSPORT_ACCOUNTS_API_BASE ?? 'http://localhost:4000/api/accounts').replace(
    /\/accounts\/?$/,
    ''
  );
  return proxyJsonService(
    request,
    `${base}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`,
    1048576,
    'No se pudo conectar con el registro deportivo.'
  );
}
export const GET = handle;
export const POST = handle;
