import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let failed = 0;
for (const file of readdirSync(new URL('./checks/', import.meta.url))
  .filter((f) => f.endsWith('.ts'))
  .sort()) {
  process.stdout.write(`\nПроверка ${file}\n`);
  const result = spawnSync(process.execPath, ['scripts/run-ts.mjs', `scripts/checks/${file}`], {
    cwd: root,
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.status !== 0) failed++;
}
process.stdout.write(`\nНаборов с ошибками: ${failed}\n`);
process.exitCode = failed ? 1 : 0;
