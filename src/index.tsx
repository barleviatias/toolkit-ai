import path from 'path';
import { runHeadless, runBanner } from './commands/headless.js';
import { runInit } from './commands/init.js';
import { checkForUpdate, formatUpdateLine, getCachedUpdateInfo } from './core/update-check.js';

const TOOLKIT_DIR = path.join(__dirname, '..');
const args = process.argv.slice(2);

async function main() {
  // Fire the background update check — non-blocking. The result lands in the
  // ~/.toolkit/update-check.json cache; the TUI's useUpdateCheck hook reads it
  // on next launch, and the headless exit path prints a line from cache below.
  const updatePromise = checkForUpdate().catch(() => null);

  // init command — scaffold a skill repo
  if (args[0] === 'init') {
    runInit(args[1] || '.');
    printUpdateLineFromCache();
    return;
  }

  // If headless flags are present, run without loading React/Ink
  if (args.length > 0) {
    const handled = runHeadless(args, TOOLKIT_DIR);
    if (handled) {
      // Wait briefly for the fresh check if cache was empty, then print.
      await Promise.race([updatePromise, new Promise(r => setTimeout(r, 1500))]);
      printUpdateLineFromCache();
      return;
    }
  }

  // No args or interactive commands -> launch TUI
  if (args.length === 0 || args.includes('add') || args.includes('remove')) {
    // Dynamic import to avoid loading React for headless commands
    const { renderApp } = await import('./app.js');
    const initialTab = args.includes('remove') ? 'installed' : 'catalog';
    await renderApp(TOOLKIT_DIR, initialTab);
    return;
  }

  // Unknown command
  runBanner();
  printUpdateLineFromCache();
}

function printUpdateLineFromCache(): void {
  const line = formatUpdateLine(getCachedUpdateInfo());
  if (line) console.log(`\n\x1b[33m${line}\x1b[0m`);
}

main().catch(err => {
  console.error(`\x1b[31m${err.message}\x1b[0m`);
  process.exit(1);
});
