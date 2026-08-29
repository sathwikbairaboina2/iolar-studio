// One-shot: creates .venv-whisper and installs openai-whisper for reel voice alignment.
import { spawnSync } from 'child_process';
import path from 'path';

const venv = path.join(process.cwd(), '.venv-whisper');
const python = process.platform === 'win32'
  ? path.join(venv, 'Scripts', 'python.exe')
  : path.join(venv, 'bin', 'python');

const step = (bin, args) => {
  const r = spawnSync(bin, args, { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) {
    console.error(`failed: ${bin} ${args.join(' ')}`);
    process.exit(1);
  }
};

step('python', ['-m', 'venv', venv]);
step(python, ['-m', 'pip', 'install', '--upgrade', 'pip']);
step(python, ['-m', 'pip', 'install', 'openai-whisper']);
console.log('\nwhisper ready. For GPU alignment install a CUDA torch build:');
console.log(`  ${python} -m pip install --force-reinstall --index-url https://download.pytorch.org/whl/cu128 torch`);
console.log('then set "whisperDevice": "cuda" in data/settings.json.');
