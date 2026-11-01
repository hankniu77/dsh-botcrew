import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let child = null;

/**
 * Start the local work-panel HTTP service next to the DSH host.
 * The service is intentionally a child process: the MCP server is spawned by
 * DSH once per connection (including its stdio probe), while this host plugin
 * loads exactly once per profile.
 */
export function apply(ctx) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(here, '..', 'src', 'panel-server.js');

  try {
    child = spawn(process.execPath, [script], {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    child.on('error', () => {
      child = null;
    });
    child.on('exit', () => {
      child = null;
    });
  } catch {
    child = null;
  }

  ctx.effect(
    () => () => {
      if (!child) return;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      child = null;
    },
    'botcrew.panel'
  );
}

