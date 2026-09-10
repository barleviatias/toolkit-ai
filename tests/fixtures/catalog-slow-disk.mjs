import fs from 'node:fs';
import { isMainThread } from 'node:worker_threads';

// Emulate slow source-tree reads on the worker, without slowing Ink's event loop.
if (!isMainThread && process.env.TOOLKIT_TEST_SLOW_PATH) {
  const read = fs.readdirSync;
  let marked = false;
  fs.readdirSync = function (dir, ...args) {
    if (String(dir).startsWith(process.env.TOOLKIT_TEST_SLOW_PATH)) {
      if (!marked) {
        fs.writeFileSync(process.env.TOOLKIT_TEST_DISK_MARKER, 'scanning');
        marked = true;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    return read.call(this, dir, ...args);
  };
}
