import { NextRequest, NextResponse } from 'next/server';
import { walletProofMaximumBytes } from '@playsport/shared';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (request.nextUrl.search) return NextResponse.json({ message: 'La solicitud no admite parámetros en la URL.' }, { status: 400 });
  const type = request.headers.get('content-type');
  if (!type?.startsWith('multipart/form-data;')) return NextResponse.json({ message: 'Envía los datos y el comprobante como formulario multipart.' }, { status: 415 });
  const chunks: Uint8Array[] = [], reader = request.body?.getReader();
  let size = 0;
  if (reader) {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > walletProofMaximumBytes + 8192) {
        await reader.cancel();
        return NextResponse.json({ message: 'La solicitud y el comprobante superan el tamaño permitido.' }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
  }
  const headers = new Headers({ 'Content-Type': type });
  for (const key of ['cookie', 'origin']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const upstream = await fetch(`${process.env.PLAYSPORT_WALLET_API_BASE ?? 'http://localhost:4000/api/wallet'}/recharges`,
      { method: 'POST', headers, body: Buffer.concat(chunks), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    console.error('No se pudo confirmar la solicitud de recarga con comprobante.');
    return NextResponse.json({ message: 'No se pudo confirmar la solicitud. Reintenta con la misma clave y comprobante.' }, { status: 503 });
  }
}
