import { NextRequest, NextResponse } from 'next/server';
import { proxyJsonService } from '../../service-proxy';
import { statisticsFilterKeys } from '@playsport/shared';

export const dynamic = 'force-dynamic';
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const own = path.length === 1 && path[0] === 'me';
  const management = path.length === 1 && path[0] === 'manager-teams';
  const scorerManagement = path.length === 1 && path[0] === 'scorekeeper-tournaments';
  const scorerExtra = path.length === 1 && path[0] === 'scorekeeper-extra' && request.method === 'POST';
  const scorerGames = path.length === 1 && path[0] === 'scorekeeper-games' && request.method === 'GET';
  const scorerStats = path.length === 1 && path[0] === 'scorekeeper-statistics' && request.method === 'GET';
  const substitutions = path.length === 1 && path[0] === 'scorekeeper-substitutions';
  const scopedScorer = scorerStats || substitutions && request.method === 'GET';
  const totals = path.length === 1 && path[0] === 'manager-player-totals' && request.method === 'GET';
  const statistics = path.length === 1 && path[0] === 'statistics' && request.method === 'GET';
  const career = path.length === 1 && path[0] === 'career' && request.method === 'GET';
  const published = path.length === 2 && path[0] === 'public' && /^[a-zA-Z0-9_-]{24}$/.test(path[1]);
  if (request.nextUrl.search && !statistics && !career && !totals && !scopedScorer ||
      !own && !published && !statistics && !career && !management && !totals && !scorerManagement && !scorerExtra && !scorerGames && !scorerStats && !substitutions || published && request.method !== 'GET' ||
      (statistics || career || totals || scopedScorer) && [...request.nextUrl.searchParams.keys()].some(key =>
        !(scopedScorer ? ['tournamentId', 'gameId'] : totals ? ['tournamentId', 'teamId'] : career ? ['source'] : ['mode', 'source', ...statisticsFilterKeys]).includes(key) ||
        request.nextUrl.searchParams.getAll(key).length !== 1))
    return NextResponse.json({ message: 'La consulta de hoja deportiva no es válida.' }, { status: 400 });
  const base = process.env.PLAYSPORT_SPORTS_SHEET_API_BASE ?? 'http://localhost:4000/api/sports-sheet';
  return proxyJsonService(request, `${base}/${path.join('/')}${statistics || career || totals || scopedScorer ? request.nextUrl.search : ''}`,
    management || scorerManagement ? 1024 * 1024 : 16384, 'No se pudo conectar con tu hoja deportiva. Vuelve a intentar.');
}
export const GET = handle;
export const POST = handle;
