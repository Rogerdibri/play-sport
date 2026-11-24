import { NextRequest, NextResponse } from 'next/server';
import { proxyJsonService } from '../../service-proxy';

export const dynamic = 'force-dynamic';
const actions = new Set(['me', 'register', 'login', 'logout', 'password', 'password-reset', 'password-reset-confirm', 'photo', 'identity', 'identity-requests', 'identity-evidence', 'identity-review', 'profile', 'scorecards', 'administration', 'access', 'activate-role', 'scorekeeper-extras']);

async function handle(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (action === 'photo' && request.nextUrl.search) return NextResponse.json({ message: 'La operación de foto no admite parámetros en la URL.' }, { status: 400 });
  const reads = new Set(['me','identity-requests','identity-evidence','profile','scorecards','administration','access','scorekeeper-extras']);
  if (!actions.has(action) || request.method === 'GET' && !reads.has(action) || request.method === 'POST' && reads.has(action) && !['profile','scorecards','administration','scorekeeper-extras'].includes(action)) {
    return NextResponse.json({ message: 'La operación de cuenta no existe.' }, { status: 404 });
  }
  const base = process.env.PLAYSPORT_ACCOUNTS_API_BASE ?? 'http://localhost:4000/api/accounts';
  if (['access','activate-role','scorekeeper-extras'].includes(action) && request.nextUrl.search || action === 'administration' &&
      (request.method === 'POST' && request.nextUrl.search || [...request.nextUrl.searchParams.keys()].some(key => !['q','page','auditPage'].includes(key)) ||
       [...request.nextUrl.searchParams.keys()].some(key => request.nextUrl.searchParams.getAll(key).length !== 1)))
    return NextResponse.json({ message: 'La consulta de accesos no es válida.' }, { status: 400 });
  if (action !== 'identity-evidence' && action.startsWith('identity') && request.nextUrl.search)
    return NextResponse.json({ message: 'La operación no admite parámetros en la URL.' }, { status: 400 });
  if (action === 'scorecards' && [...request.nextUrl.searchParams.keys()].some(key => key !== 'scope'))
    return NextResponse.json({ message: 'Consulta únicamente tus propias planillas.' }, { status: 400 });
  return proxyJsonService(request, `${base}/${action}${['identity-evidence','scorecards','administration'].includes(action) ? request.nextUrl.search : ''}`, ['identity','profile','scorecards'].includes(action) ? 1048576 : action === 'photo' ? 92160 : 8192, 'No se pudo conectar con el servicio de cuentas. Vuelve a intentar.');
}

export const GET = handle;
export const POST = handle;
