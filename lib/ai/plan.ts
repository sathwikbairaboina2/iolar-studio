import { promises as fs } from 'fs';
import path from 'path';
import { Post, validatePost, MAX_SLIDES } from '../schema';
import { getSettings } from '../settings';
import { postDir, savePost, loadPost } from '../store';
import { runClaude } from './claude';
import { extractJson } from './revise';

const SCHEMA_RULES = `Return ONLY a complete post JSON object (no prose, no markdown fences) with this exact shape:
{
  "brand": string, "template": one of ["spiral-notes","margin-qa","blackboard","studygram-pastel","engineer-grid","terminal-dark","legal-pad","sticky-wall"],
  "ratio": "3:4", "seed": integer,
  "series": string (short series title, uppercase),
  "date": string (DD/MM/YYYY),
  "slides": [ { "page_title": string, "blocks": [Block, ...] }, ... ],
  "caption": { "text": string, "hashtags": [string, ...] }
}
Block types (discriminated by "type"):
- {"type":"heading","text":string,"ink"?:"blue"|"red"|"green"|"black"|"accent"}
- {"type":"paragraph","text":string}
- {"type":"bullets","items":[string,...]}
- {"type":"sidebox","title":string,"items":[string,...],"ink"?:string}
- {"type":"table","headers":[string,...],"rows":[[string,...],...]}
- {"type":"code","lang":string,"lines":[string,...]}
- {"type":"diagram","kind":"flow","spec":{"nodes":[string,...]}}
- {"type":"callout","style":"tip"|"takeaway"|"cloud","title":string,"text":string}
- {"type":"qa","q":string,"a_bullets":[string,...],"example_code"?:[string,...]}

HARD LIMITS: at most ${MAX_SLIDES} slides.
"page_title" is the section name ONLY — never write "Page 3:" or any page number in it; the template adds that.
DENSITY BUDGET — a slide that exceeds this overflows the page and is rejected. Per slide use AT MOST 6 blocks and stay under ~55 rendered lines, counting: heading = 1 line, each bullet/table row/code line = 1 line, paragraph = 1 line per 90 characters, callout/sidebox = 2 lines plus its items. Tables max 5 rows x 4 cols with short cells, paragraphs max 2 sentences, code max 5 lines. Prefer splitting across slides over cramming. Content must be technically accurate. Numbered section headings ("1. ...", "2. ...") like handwritten study notes. Slide 1 = overview, last slide = summary/best practices when it fits the topic.`;

async function generate(prompt: string, allowedTools?: string[]): Promise<Post> {
  const first = await runClaude(prompt, { timeoutMs: 600_000, allowedTools });
  try {
    return validatePost(extractJson(first));
  } catch (err) {
    const retry = await runClaude(
      `${prompt}\n\nYour previous output failed validation: ${String(err).slice(0, 500)}. Return corrected JSON only.`,
      { timeoutMs: 600_000, allowedTools }
    );
    return validatePost(extractJson(retry));
  }
}

export async function planFromTopic(slug: string, topic: string): Promise<Post> {
  const s = getSettings();
  const existing = await loadPost(slug).catch(() => null);
  const prompt = [
    `You are the content planner for "${s.brand}", an Instagram account posting handwritten-style tech notes carousels.`,
    `Create a complete carousel post about: ${topic}`,
    SCHEMA_RULES,
    `Use "brand": "${s.brand}", "template": "${existing?.template ?? s.defaultTemplate}", "ratio": "${existing?.ratio ?? s.defaultRatio}", "seed": 42, today's date ${new Date().toLocaleDateString('en-GB')}.`,
    `Write an engaging caption (2-3 sentences, hook first) and 8-12 relevant hashtags.`,
  ].join('\n\n');
  const post = await generate(prompt);
  await savePost(slug, post);
  return post;
}

export async function downloadReferences(slug: string, urls: string[]): Promise<string[]> {
  const dir = path.join(postDir(slug), 'refs');
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const r = await fetch(urls[i]);
    if (!r.ok) throw new Error(`reference ${i + 1} fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const file = path.join(dir, `ref-${String(i + 1).padStart(2, '0')}.jpg`);
    await fs.writeFile(file, buf);
    files.push(file);
  }
  return files;
}

export async function planFromReferences(slug: string, urls: string[]): Promise<Post> {
  const s = getSettings();
  const files = await downloadReferences(slug, urls);
  const existing = await loadPost(slug).catch(() => null);
  const prompt = [
    `You are the content planner for "${s.brand}", an Instagram account posting handwritten-style tech notes carousels.`,
    `Reference carousel images are saved at these paths — READ AND LOOK AT EVERY ONE with the Read tool before answering:`,
    files.map((f) => `- ${f}`).join('\n'),
    `Analyze them: the topic taught, how content is structured across slides (overview -> deep dives -> summary), what block types they use (tables, code, Q&A, tip boxes), and the narrative arc.`,
    `Then create a FRESH, ORIGINAL carousel post on the SAME TOPIC with a similar structural arc. Do NOT copy their sentences verbatim — write original wording and pick your own examples. Match their level of depth and density.`,
    SCHEMA_RULES,
    `Use "brand": "${s.brand}", "template": "${existing?.template ?? s.defaultTemplate}", "ratio": "${existing?.ratio ?? s.defaultRatio}", "seed": 42, today's date ${new Date().toLocaleDateString('en-GB')}.`,
    `Write an engaging caption (2-3 sentences, hook first) and 8-12 relevant hashtags.`,
  ].join('\n\n');
  const post = await generate(prompt, ['Read']);
  await savePost(slug, post);
  return post;
}
