import { NextRequest, NextResponse } from 'next/server';
import { readWalletQuery } from '@playsport/shared';
import { proxyJsonService } from '../service-proxy';
export const dynamic = 'force-dynamic';
async function handle(request: NextRequest) {
  try {
    if (request.method === 'POST' && request.nextUrl.search) throw new Error('La recarga no admite parámetros en la URL.');
    readWalletQuery(request.nextUrl.searchParams.entries());
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'La consulta de la billetera no es válida.' }, { status: 400 }); }
  return proxyJsonService(request, `${process.env.PLAYSPORT_WALLET_API_BASE ?? 'http://localhost:4000/api/wallet'}${request.nextUrl.search}`,
    4096, 'No se pudo conectar con la billetera. No se confirmó la recarga; reintenta con la misma solicitud.');
}
export const GET = handle;
export const POST = handle;
