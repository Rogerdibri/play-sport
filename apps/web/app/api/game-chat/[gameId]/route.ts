import { NextRequest, NextResponse } from 'next/server';
import { proxyJsonService } from '../../service-proxy';

export const dynamic = 'force-dynamic';
async function handle(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await context.params;
  const before = request.nextUrl.searchParams.get('before');
  const after = request.nextUrl.searchParams.get('after');
  if (!gameId || gameId.length > 160 || [...request.nextUrl.searchParams.keys()].some(key => !['before', 'after'].includes(key)) ||
      before !== null && after !== null || ['before', 'after'].some(key => request.nextUrl.searchParams.getAll(key).length > 1) ||
      [before, after].some(cursor => cursor !== null && (!/^[1-9]\d*$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) ||
      request.method === 'POST' && (before !== null || after !== null)) {
    return NextResponse.json({ message: 'El partido o el cursor del chat no es válido.' }, { status: 400 });
  }
  const base = process.env.PLAYSPORT_CHAT_API_BASE ?? 'http://localhost:4000/api/game-chat';
  return proxyJsonService(request, `${base}/${encodeURIComponent(gameId)}${before ? `?before=${before}` : after ? `?after=${after}` : ''}`, 4096,
    'No se pudo conectar con el chat del partido. La pizarra sigue funcionando de forma independiente.');
}
export const GET = handle;
export const POST = handle;
