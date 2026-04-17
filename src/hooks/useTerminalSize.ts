import { useState, useEffect } from 'react';

interface TerminalSize {
  rows: number;
  columns: number;
}

function readSize(): TerminalSize {
  return {
    rows: process.stdout.rows || 24,
    columns: process.stdout.columns || 80,
  };
}

/**
 * Track terminal dimensions and update on SIGWINCH. Guarded so same-value
 * resize events don't trigger re-renders through React.memo boundaries.
 */
export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(readSize);
  useEffect(() => {
    const onResize = () => {
      const next = readSize();
      setSize(prev => (prev.rows === next.rows && prev.columns === next.columns) ? prev : next);
    };
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);
  return size;
}

/** Convenience wrapper for consumers that only care about row count. */
export function useTerminalRows(): number {
  return useTerminalSize().rows;
}
