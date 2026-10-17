import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

interface Health {
  status: string;
  /** Left out by the server for a caller who is not logged in. */
  schemaVersion?: number;
}

type HealthState = { kind: 'loading' } | { kind: 'ok'; health: Health } | { kind: 'error' };

export function ServerStatus() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Health check failed with status ${response.status}`);
        return response.json() as Promise<Health>;
      })
      .then((health) => setState({ kind: 'ok', health }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Badge variant={state.kind === 'error' ? 'destructive' : 'secondary'}>
        {state.kind === 'ok' ? 'online' : state.kind === 'error' ? 'offline' : '...'}
      </Badge>
      <p role="status">
        {state.kind === 'loading' && 'Checking server...'}
        {state.kind === 'ok' &&
          (state.health.schemaVersion === undefined
            ? 'Server is running.'
            : `Server is running (database schema v${state.health.schemaVersion}).`)}
        {state.kind === 'error' && 'Cannot reach the server.'}
      </p>
    </div>
  );
}
