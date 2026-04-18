import path from 'path';
import { runHeadless, runBanner } from './commands/headless.js';
import { runInit } from './commands/init.js';
import { autoUpdateInFlight, checkForUpdate, formatUpdateLine, getCachedUpdateInfo, maybeAutoUpdate } from './core/update-check.js';
import { RED, RESET, YELLOW } from './core/ansi.js';

const TOOLKIT_DIR = path.join(__dirname, '..');
const args = process.argv.slice(2);

// `--version` and `--help` are expected to exit in milliseconds and are
// commonly scripted — don't saddle them with the update-check network path.
const IS_QUICK_COMMAND = args.length === 1 && /^(--version|--help|-v|-h)$/.test(args[0]);

async function main() {
  const updatePromise = IS_QUICK_COMMAND
    ? null
    : checkForUpdate()
        .then(info => { maybeAutoUpdate(info); return info; })
        .catch(() => null);

  if (args[0] === 'init') {
    runInit(args[1] || '.');
    printUpdateLineFromCache();
    return;
  }

  if (args.length > 0) {
    const handled = runHeadless(args, TOOLKIT_DIR);
    if (handled) {
      // Give a fresh network check up to 1.5s to land before we print — if
      // the cache was cold we'd otherwise miss the banner on the user's first
      // ever invocation. AbortSignal.timeout lets the event loop exit cleanly
      // when updatePromise wins (plain setTimeout would keep a dangling timer).
      if (updatePromise) {
        await Promise.race([
          updatePromise,
          new Promise(resolve => AbortSignal.timeout(1500).addEventListener('abort', () => resolve(null))),
        ]);
      }
      printUpdateLineFromCache();
      return;
    }
  }

  if (args.length === 0 || args.includes('add') || args.includes('remove')) {
    // Dynamic import to avoid loading React for headless commands.
    const { renderApp } = await import('./app.js');
    const initialTab = args.includes('remove') ? 'installed' : 'catalog';
    await renderApp(TOOLKIT_DIR, initialTab);
    return;
  }

  runBanner();
  printUpdateLineFromCache();
}

function printUpdateLineFromCache(): void {
  // Don't pollute piped stdout (e.g. `toolkit-ai --list | grep foo`) or CI
  // build logs. Only print when a human is watching the terminal. Writing to
  // stderr so even if stderr is somehow redirected, we never corrupt the
  // command's actual stdout output.
  if (!process.stderr.isTTY) return;
  const info = getCachedUpdateInfo();
  if (autoUpdateInFlight(info)) {
    console.error(`\n${YELLOW}↑ toolkit-ai ${info.latest} is installing in the background — restart the CLI to pick it up.${RESET}`);
    return;
  }
  const line = formatUpdateLine(info);
  if (line) console.error(`\n${YELLOW}${line}${RESET}`);
}

main().catch(err => {
  console.error(`${RED}${err.message}${RESET}`);
  process.exit(1);
});
