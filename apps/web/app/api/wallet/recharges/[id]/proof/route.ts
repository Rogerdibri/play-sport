import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || request.nextUrl.search) return NextResponse.json({ message: 'La consulta del comprobante no es válida.' }, { status: 400 });
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('Cookie', cookie);
  try {
    const upstream = await fetch(`${process.env.PLAYSPORT_WALLET_API_BASE ?? 'http://localhost:4000/api/wallet'}/recharges/${id}/proof`,
      { headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    const response = new NextResponse(upstream.body, { status: upstream.status });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
    if (upstream.ok) {
      const disposition = upstream.headers.get('content-disposition');
      if (!disposition?.startsWith('attachment;')) throw new Error('El comprobante no admite descarga segura.');
      response.headers.set('Content-Disposition', disposition);
    }
    return response;
  } catch {
    console.error('No se pudo descargar el comprobante privado.');
    return NextResponse.json({ message: 'No se pudo descargar el comprobante. Reintenta la consulta.' }, { status: 503 });
  }
}
