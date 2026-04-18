import { useEffect, useState } from 'react';
import { checkForUpdate, getCachedUpdateInfo, type UpdateInfo } from '../core/update-check.js';

/**
 * Fire-and-forget update check. Returns the cached answer immediately (so the
 * banner can render on first paint if we already know there's a newer version)
 * then kicks off a background fetch that may refine the answer. Errors are
 * swallowed inside `checkForUpdate`, so this hook never rejects.
 */
export function useUpdateCheck(): UpdateInfo {
  const [info, setInfo] = useState<UpdateInfo>(() => getCachedUpdateInfo());

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then(next => {
      if (!cancelled) setInfo(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return info;
}
