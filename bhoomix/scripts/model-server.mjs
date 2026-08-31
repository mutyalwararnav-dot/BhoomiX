import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true, override: true });

const python = process.platform === 'win32'
  ? resolve('.venv-ml/Scripts/python.exe')
  : resolve('.venv-ml/bin/python');

if (!existsSync(python)) {
  console.error('The model environment is missing. Create .venv-ml and install training/requirements-rooftop.txt first.');
  process.exit(1);
}

const child = spawn(python, [
  '-m', 'uvicorn', 'training.inference_service:app',
  '--host', '127.0.0.1',
  '--port', process.env.AI_INFERENCE_PORT || '8000',
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`BhoomiX model server could not start: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
