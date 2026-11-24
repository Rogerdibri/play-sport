import { NextRequest, NextResponse } from 'next/server';

export async function proxyJsonService(request: NextRequest, url: string, limit: number, unavailable: string) {
  let body: string | undefined;
  if (request.method === 'POST') {
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      return NextResponse.json({ message: 'Envía los datos como JSON.' }, { status: 415 });
    }
    const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > limit) {
          await reader.cancel();
          return NextResponse.json({ message: 'La solicitud es demasiado grande.' }, { status: 413 });
        }
        chunks.push(chunk.value);
      }
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const key of ['cookie', 'origin']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const upstream = await fetch(url, { method: request.method, headers, body, cache: 'no-store',
      redirect: 'error', signal: AbortSignal.timeout(10000) });
    const response = new NextResponse(upstream.status === 204 ? null : await upstream.text(), { status: upstream.status });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Content-Type', 'application/json');
    const cookie = upstream.headers.get('set-cookie');
    if (cookie) response.headers.set('Set-Cookie', cookie);
    return response;
  } catch {
    console.error(unavailable);
    return NextResponse.json({ message: unavailable }, { status: 503 });
  }
}
