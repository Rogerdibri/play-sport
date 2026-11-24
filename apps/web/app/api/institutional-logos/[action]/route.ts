import { NextRequest, NextResponse } from 'next/server';
import { readInstitutionKind, readInstitutionId } from '@playsport/shared';
import { proxyJsonService } from '../../service-proxy';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params,
    base = process.env.PLAYSPORT_LOGOS_API_BASE ?? 'http://localhost:4000/api/institutional-logos';
  if (!['manage', 'image'].includes(action))
    return NextResponse.json({ message: 'La operación de logos no existe.' }, { status: 404 });
  const params = request.nextUrl.searchParams,
    fields = action === 'manage' ? ['role', 'actorId'] : ['kind', 'id', 'revision'];
  if (
    [...params.keys()].some((key) => !fields.includes(key) || params.getAll(key).length !== 1) ||
    fields.some((key) => !params.get(key))
  )
    return NextResponse.json({ message: 'La consulta de logos no es válida.' }, { status: 400 });
  if (action === 'manage')
    return proxyJsonService(
      request,
      `${base}/manage?${params.toString()}`,
      92160,
      'No se pudieron consultar tus identidades visuales.'
    );
  try {
    readInstitutionKind(params.get('kind'));
    readInstitutionId(params.get('id'));
    if (!/^[1-9]\d*$/.test(params.get('revision') ?? '') || !Number.isSafeInteger(Number(params.get('revision'))))
      throw new Error('La revisión del logo no es válida.');
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'La identidad no es válida.' },
      { status: 400 }
    );
  }
  try {
    const upstream = await fetch(`${base}/image?${params.toString()}`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    const type = upstream.headers.get('content-type');
    if (upstream.ok && type !== 'image/png' && type !== 'image/jpeg')
      throw new Error('El servicio no entregó un logo válido.');
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Type': type ?? 'application/json'
      }
    });
  } catch {
    console.error('No se pudo descargar el logo institucional.');
    return NextResponse.json(
      { message: 'No se pudo descargar el logo. Recarga la identidad visual.' },
      { status: 503 }
    );
  }
}
