import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

// Local project values must win over stale machine or terminal variables.
// This prevents an old Supabase key from silently overriding .env.local.
config({ path: '.env.local', quiet: true, override: true });

const nextCli = resolve('node_modules/next/dist/bin/next');
const child = spawn(process.execPath, [nextCli, 'dev', '--webpack', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`BhoomiX development server could not start: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
