export class AccessRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function accessRequest(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) });
  const value: unknown = await response.json();
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ?
      value.message : 'No se pudo completar la consulta de accesos.';
    throw new AccessRequestError(message, response.status);
  }
  return value;
}
