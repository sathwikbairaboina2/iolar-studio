import { promises as fs } from 'fs';
import path from 'path';
import { postDir } from '../store';
import { getSettings } from '../settings';
import { queuePrompt, waitForJob, fetchImage, uploadImage, firstCheckpoint, saveWorkflowToDesktop } from './client';

export function buildPolishWorkflow(ckpt: string, imageName: string, denoise: number) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '2': { class_type: 'LoadImage', inputs: { image: imageName } },
    '3': { class_type: 'VAEEncode', inputs: { pixels: ['2', 0], vae: ['1', 2] } },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: 'handwritten notes on paper, natural ink texture, subtle paper grain' },
    },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'blurry, distorted text, illegible' } },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['3', 0],
        seed: 42, steps: 14, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise,
      },
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'iolar-polish' } },
  };
}

export async function polishSlide(pngPath: string, outPath: string): Promise<void> {
  const ckpt = await firstCheckpoint();
  const denoise = getSettings().polishDenoise;
  const uploadName = `iolar-src-${path.basename(pngPath)}`;
  await uploadImage(pngPath, uploadName);
  const wf = buildPolishWorkflow(ckpt, uploadName, denoise);
  await saveWorkflowToDesktop('iolar-polish', wf);
  const { prompt_id } = await queuePrompt(wf);
  const { images } = await waitForJob(prompt_id);
  const buf = await fetchImage(images[0]);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buf);
}

export async function polishPost(slug: string): Promise<{ slides: number }> {
  const rendersDir = path.join(postDir(slug), 'renders');
  const files = (await fs.readdir(rendersDir)).filter((f) => /^slide-\d+\.png$/.test(f));
  if (!files.length) throw new Error('render first');
  for (const f of files.sort()) {
    await polishSlide(path.join(rendersDir, f), path.join(rendersDir, 'polished', f));
  }
  return { slides: files.length };
}
