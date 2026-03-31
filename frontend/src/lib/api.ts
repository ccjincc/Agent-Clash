import { useAppStore } from '@/store';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8001';

export type StreamEvent =
  | { type?: string; status?: string; state?: string; speaker?: string; model?: string; round?: number; history_index?: number }
  | { type: 'chunk'; content: string }
  | { type: 'rag'; agent: string; query: string; model?: string }
  | { type: 'usage'; usage: Record<string, unknown> }
  | { type: 'done'; metadata?: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { status: 'error'; message: string };

export async function apiRequest<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const sessionId = useAppStore.getState().ensureSessionId();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: init?.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      'session-id': sessionId,
    },
    body: body ? JSON.stringify(body) : undefined,
    ...init,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      message = parsed.message || parsed.detail || message;
    } catch {}
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, undefined, { ...init, method: 'GET' });
}

export async function streamRequest(
  path: string,
  body: unknown | undefined,
  onEvent: (evt: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const sessionId = useAppStore.getState().ensureSessionId();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'session-id': sessionId,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed) as StreamEvent;
        onEvent(evt);
      } catch {
        onEvent({ type: 'error', message: `Bad stream chunk: ${trimmed.slice(0, 120)}` });
      }
    }
  }
}
