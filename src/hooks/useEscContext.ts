import { createContext, useContext, useMemo, useRef } from 'react';

/**
 * Coordination between the app-level Esc handler and sub-view Esc handlers.
 *
 * Ink's `useInput` fires every registered handler synchronously with no
 * bubble/capture model. To implement "Esc = go back if there's somewhere to
 * go, otherwise exit", we:
 *
 * 1. Let the app's handler clear a shared ref on every Esc press.
 * 2. Each sub-view that consumes Esc calls markConsumed() during its handler.
 * 3. The app's handler checks the ref in a microtask (after all child
 *    handlers have run) to decide whether to exit.
 *
 * Lives in its own module (not app.tsx) to avoid a circular import:
 * children of app.tsx need to import useMarkEscConsumed, but they're already
 * imported by app.tsx, which would create the circle if the hook lived there.
 */
interface EscContextValue {
  markConsumed: () => void;
}

export const EscContext = createContext<EscContextValue>({ markConsumed: () => {} });

/** Child hook: call the returned fn during an Esc handler to say "I handled it". */
export function useMarkEscConsumed(): () => void {
  return useContext(EscContext).markConsumed;
}

/**
 * App-level hook: provides the context value and the ref the app needs to
 * check in a microtask after all child handlers have run.
 */
export function useEscCoordinator(): {
  contextValue: EscContextValue;
  wasConsumed: () => boolean;
  reset: () => void;
} {
  const consumedRef = useRef(false);
  const contextValue = useMemo<EscContextValue>(() => ({
    markConsumed: () => { consumedRef.current = true; },
  }), []);
  return {
    contextValue,
    wasConsumed: () => consumedRef.current,
    reset: () => { consumedRef.current = false; },
  };
}
