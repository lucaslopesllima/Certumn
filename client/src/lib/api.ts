// Tiny fetch wrapper. Native fetch, no axios. Adds Bearer token, parses JSON, throws on error.
const TOKEN_KEY = 'rs_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface RequestOpts {
  // passe o signal de um AbortController no cleanup do useEffect — resposta de
  // página abandonada não chega a tocar o estado.
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, body?: unknown, opts?: RequestOpts): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: opts?.signal,
  });

  if (res.status === 401) {
    setToken(null);
    if (location.pathname !== '/login') location.href = '/login';
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? data?.message ?? `Erro ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string, o?: RequestOpts) => request<T>('GET', p, undefined, o),
  post: <T>(p: string, b?: unknown, o?: RequestOpts) => request<T>('POST', p, b, o),
  put: <T>(p: string, b?: unknown, o?: RequestOpts) => request<T>('PUT', p, b, o),
  patch: <T>(p: string, b?: unknown, o?: RequestOpts) => request<T>('PATCH', p, b, o),
  del: <T>(p: string, o?: RequestOpts) => request<T>('DELETE', p, undefined, o),
};
