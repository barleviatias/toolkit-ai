import { useCallback } from 'react';

/**
 * Run a synchronous, potentially-long operation (e.g. `spawnSync` git clone,
 * install/remove chains) while showing a busy indicator. Defers the blocking
 * work by ~1 frame so React/Ink has a chance to paint the "⟳ <label>..." row
 * before the event loop stalls.
 *
 * Caller supplies its own `setBusy` / `setMessage` state setters so this hook
 * stays agnostic to presentation.
 */
export function useRunBusy(
  setBusy: (label: string | null) => void,
  setMessage: (msg: string) => void,
): (label: string, fn: () => void) => void {
  return useCallback((label: string, fn: () => void) => {
    setBusy(label);
    setMessage('');
    setTimeout(() => {
      try {
        fn();
      } catch (e: unknown) {
        setMessage(`\u2715 ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(null);
      }
    }, 16);
  }, [setBusy, setMessage]);
}
