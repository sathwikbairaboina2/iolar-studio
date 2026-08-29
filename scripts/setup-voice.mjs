// One-shot: installs Piper and downloads the reel voiceover voice.
import { spawnSync } from 'child_process';
import path from 'path';

const venv = path.join(process.cwd(), '.venv-whisper');
const python = process.platform === 'win32'
  ? path.join(venv, 'Scripts', 'python.exe')
  : path.join(venv, 'bin', 'python');
const voice = process.argv[2] ?? 'en_US-ryan-high';
const dataDir = path.join(process.cwd(), 'models', 'piper');

const step = (bin, args) => {
  const r = spawnSync(bin, args, { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) {
    console.error(`failed: ${bin} ${args.join(' ')}`);
    process.exit(1);
  }
};

step(python, ['-m', 'pip', 'install', 'piper-tts']);
step(python, ['-m', 'piper.download_voices', voice, '--data-dir', dataDir]);
console.log(`\nvoice ready: ${voice} in ${dataDir}`);
console.log('Set "piperVoice" in data/settings.json to use a different one.');
