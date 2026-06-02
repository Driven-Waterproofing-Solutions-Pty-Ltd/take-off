import { useEffect, useState } from 'react';

// Browser auth gate. Hits GET /auth/me to find out who's logged in.
// 401 → unauthenticated. 200 → returns the user (cookie sessions) OR the
// MCP token identity (devs running with localStorage.takeoff_token set).

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'member';
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; via: 'session'; user: SessionUser }
  | { status: 'authenticated'; via: 'mcp'; identity: string }
  | { status: 'unauthenticated' };

function getDevAuthHeader(): Record<string, string> {
  try {
    const t = typeof localStorage !== 'undefined' ? localStorage.getItem('takeoff_token') : null;
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/auth/me', {
          credentials: 'include',
          headers: getDevAuthHeader(),
        });
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: 'unauthenticated' });
          return;
        }
        if (!res.ok) {
          // Network or 5xx — treat as unauthenticated so we don't strand the
          // user on the loading spinner forever.
          setState({ status: 'unauthenticated' });
          return;
        }
        const body = (await res.json()) as
          | { user: SessionUser; via: 'session' }
          | { identity: string; via: 'mcp' };
        if ('user' in body) {
          setState({ status: 'authenticated', via: 'session', user: body.user });
        } else {
          setState({ status: 'authenticated', via: body.via, identity: body.identity });
        }
      } catch {
        if (!cancelled) setState({ status: 'unauthenticated' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: getDevAuthHeader(),
  });
  // Hard reload so all in-memory state resets and any cached fetch promises die.
  window.location.assign('/');
}
