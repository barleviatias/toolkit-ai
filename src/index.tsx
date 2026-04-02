import path from 'path';
import { runHeadless, runBanner } from './commands/headless.js';
import { runInit } from './commands/init.js';

const TOOLKIT_DIR = path.join(__dirname, '..');
const args = process.argv.slice(2);

async function main() {
  // init command — scaffold a skill repo
  if (args[0] === 'init') {
    runInit(args[1] || '.');
    return;
  }

  // If headless flags are present, run without loading React/Ink
  if (args.length > 0) {
    const handled = runHeadless(args, TOOLKIT_DIR);
    if (handled) return;
  }

  // No args or interactive commands -> launch TUI
  if (args.length === 0 || args.includes('add') || args.includes('remove')) {
    // Dynamic import to avoid loading React for headless commands
    const { renderApp } = await import('./app.js');
    const initialTab = args.includes('remove') ? 'installed' : 'browse';
    await renderApp(TOOLKIT_DIR, initialTab);
    return;
  }

  // Unknown command
  runBanner();
}

main().catch(err => {
  console.error(`\x1b[31m${err.message}\x1b[0m`);
  process.exit(1);
});
