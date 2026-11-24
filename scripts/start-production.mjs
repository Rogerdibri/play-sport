import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.PLAYSPORT_WEB_ORIGIN || process.env.RENDER_EXTERNAL_URL;
if (!origin) {
  console.error('Configura PLAYSPORT_WEB_ORIGIN con la dirección HTTPS pública de PlaySport.');
  process.exit(1);
}
const data = resolve(process.env.PLAYSPORT_DATA_DIR ?? '/data');
mkdirSync(data, { recursive: true, mode: 0o700 });
const env = { ...process.env, NODE_ENV: 'production', PLAYSPORT_WEB_ORIGIN: origin };

// The API keeps its private .local/ databases relative to its working directory, so it runs inside the persistent disk.
const children = [
  spawn(process.execPath, [resolve(root, 'apps/api/dist/main.js')], { cwd: data, env: { ...env, PORT: '4000' }, stdio: 'inherit' }),
  spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', resolve(root, 'apps/web'), '-p', process.env.PORT ?? '3000'],
    { cwd: root, env, stdio: 'inherit' }),
];
let stopping = false;
const stop = code => {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 10000).unref();
  Promise.all(children.map(child => child.exitCode === null ? new Promise(done => child.once('exit', done)) : null))
    .then(() => process.exit(code));
};
for (const child of children) child.once('exit', code => stop(code ?? 1));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stop(0));
