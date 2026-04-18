import { useEffect, useState } from 'react';
import { autoUpdateInFlight, checkForUpdate, getCachedUpdateInfo, type UpdateInfo } from '../core/update-check.js';

export interface UpdateStatus extends UpdateInfo {
  /** True when a detached `npm install -g` has been spawned for `latest` within 24h. */
  autoUpdating: boolean;
}

/**
 * Fire-and-forget update check. Returns the cached answer immediately (so the
 * banner can render on first paint if we already know there's a newer version)
 * then lets the background fetch refine it. Errors are swallowed inside
 * `checkForUpdate`, so this hook never rejects. The actual `npm install -g`
 * spawn happens in index.tsx before React mounts; here we only reflect state.
 */
export function useUpdateCheck(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>(() => withInFlight(getCachedUpdateInfo()));

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then(next => {
      if (!cancelled) setStatus(withInFlight(next));
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
