import { promises as fs } from 'fs';
import path from 'path';
import { queuePrompt, waitForJob, fetchImage, firstCheckpoint, saveWorkflowToDesktop } from './client';

export function doodleDir() {
  return path.join(process.cwd(), 'assets', 'doodles');
}

export function buildDoodleWorkflow(ckpt: string, prompt: string, seed = 42) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: `minimalist hand-drawn doodle sketch of ${prompt}, black ink on white background, sticker style, simple line art` },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: 'photo, realistic, color photograph, text, watermark, blurry' },
    },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 768, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        seed, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'iolar-doodle' } },
  };
}

export async function generateDoodle(prompt: string, name: string): Promise<string> {
  const ckpt = await firstCheckpoint();
  const wf = buildDoodleWorkflow(ckpt, prompt);
  await saveWorkflowToDesktop('iolar-doodle', wf);
  const { prompt_id } = await queuePrompt(wf);
  const { images } = await waitForJob(prompt_id);
  const buf = await fetchImage(images[0]);
  await fs.mkdir(doodleDir(), { recursive: true });
  const file = path.join(doodleDir(), `${name}.png`);
  await fs.writeFile(file, buf);
  return file;
}

export async function listDoodles(): Promise<string[]> {
  try {
    return (await fs.readdir(doodleDir())).filter((f) => f.endsWith('.png'));
  } catch {
    return [];
  }
}
