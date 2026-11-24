import { NextRequest, NextResponse } from 'next/server';
import { isMarketplacePhotoPath } from '@playsport/shared';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;
  if (!isMarketplacePhotoPath(`/api/marketplace/photos/${filename}`) || request.nextUrl.search) {
    return NextResponse.json({ message: 'La consulta de la foto no es válida.' }, { status: 400 });
  }
  try {
    const upstream = await fetch(`${process.env.PLAYSPORT_MARKETPLACE_API_BASE ?? 'http://localhost:4000/api/marketplace'}/photos/${filename}`,
      { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) {
      return NextResponse.json({ message: upstream.status === 404 ? 'La foto no existe.' : 'No se pudo cargar la foto del anuncio.' },
        { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
    }
    if (upstream.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') throw new Error('El servicio no devolvió una foto JPEG.');
    return new NextResponse(upstream.body, { headers: {
      'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    console.error('No se pudo cargar la foto del Marketplace.', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ message: 'No se pudo cargar la foto del anuncio. Reintenta la consulta.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
