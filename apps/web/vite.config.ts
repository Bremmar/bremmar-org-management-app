import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build numbering begins with the first commit after this anchor. Keeping the
// anchor in source makes the number deterministic for local and CI builds,
// while still allowing VITE_BUILD_NUMBER to override it for a release build.
const BUILD_NUMBER_ANCHOR = 'df6f7d62ef4a40ad6ef55e8a1234ceeecf193afd';

function gitValue(args: string[]) {
  try {
    return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function buildNumber() {
  const explicit = process.env.VITE_BUILD_NUMBER?.trim();
  if (explicit) return explicit;

  const head = process.env.GITHUB_SHA?.trim() || gitValue(['rev-parse', 'HEAD']);
  const distance = head ? Number(gitValue(['rev-list', '--count', `${BUILD_NUMBER_ANCHOR}..${head}`])) : Number.NaN;
  if (!Number.isSafeInteger(distance) || distance < 0) return '1.01';

  // 1.01, 1.02 ... 1.99, 2.00, 2.01 ...
  const sequence = Math.max(1, distance);
  const major = 1 + Math.floor(sequence / 100);
  const minor = sequence % 100;
  return `${major}.${minor.toString().padStart(2, '0')}`;
}

const builtAt = process.env.VITE_BUILD_DATE?.trim() || new Date().toISOString();

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_NUMBER__: JSON.stringify(buildNumber()),
    __BUILD_DATE__: JSON.stringify(builtAt),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
