import { useEffect, useState } from 'react';
import { checkForUpdate, getCachedUpdateInfo, type UpdateInfo } from '../core/update-check.js';

export function useUpdateCheck(): UpdateInfo {
  const [status, setStatus] = useState<UpdateInfo>(() => getCachedUpdateInfo());

  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then(next => {
      if (cancelled) return;
      // Avoid a no-op re-render when the fresh check matches the cache.
      setStatus(prev =>
        prev.latest === next.latest &&
        prev.newer === next.newer
          ? prev
          : next,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
