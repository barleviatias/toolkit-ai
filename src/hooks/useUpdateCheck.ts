import { useEffect, useState } from 'react';
import { autoUpdateInFlight, checkForUpdate, getCachedUpdateInfo, type UpdateInfo } from '../core/update-check.js';

export interface UpdateStatus extends UpdateInfo {
  autoUpdating: boolean;
}

// The `npm install -g` spawn happens in index.tsx before React mounts; this
// hook only reflects cache state and refines it when checkForUpdate resolves.
export function useUpdateCheck(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>(() => withInFlight(getCachedUpdateInfo()));

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then(next => {
      if (cancelled) return;
      const nextStatus = withInFlight(next);
      // Avoid a no-op re-render when the fresh check matches the cache.
      setStatus(prev =>
        prev.latest === nextStatus.latest &&
        prev.newer === nextStatus.newer &&
        prev.autoUpdating === nextStatus.autoUpdating
          ? prev
          : nextStatus,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

function withInFlight(info: UpdateInfo): UpdateStatus {
  return { ...info, autoUpdating: autoUpdateInFlight(info) };
}
