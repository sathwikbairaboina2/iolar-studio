import { Post, validatePost, MAX_SLIDES } from '../schema';
import { thinker } from './runner';

export function extractJson(s: string): unknown {
  // Strip markdown fences and any prose around the outermost JSON object.
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : s;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('no JSON object in AI output');
  return JSON.parse(candidate.slice(start, end + 1));
}

function buildPrompt(post: Post, request: string, scope: string, slideIndex?: number, extraError?: string) {
  const scopeRule =
    scope === 'slide'
      ? `Only modify slide index ${slideIndex} (0-based). Every other slide must remain byte-identical unless the request explicitly requires moving content between slides (pagination/reflow).`
      : scope === 'caption'
        ? 'Only modify the caption object. Slides must remain byte-identical.'
        : 'You may modify any slide, add slides, remove slides, or rebalance content across slides.';

  return [
    'You edit Instagram notes-carousel content stored as JSON.',
    'Rules:',
    `- Return ONLY the complete updated post JSON. No prose, no markdown fences.`,
    `- The JSON must match the existing schema exactly (same field names, block types: heading, paragraph, bullets, sidebox, table, code, diagram, callout, qa).`,
    `- HARD LIMIT: at most ${MAX_SLIDES} slides. If content cannot fit, condense; mention a second post in caption text only if asked.`,
    `- ${scopeRule}`,
    '- Keep content technically accurate and concise; slides are handwritten-notes style.',
    extraError ? `- Your previous output failed validation: ${extraError}. Fix it.` : '',
    '',
    'Current post JSON:',
    JSON.stringify(post),
    '',
    'User request:',
    request,
  ].filter(Boolean).join('\n');
}

export async function revisePost(
  post: Post,
  request: string,
  scope: 'slide' | 'post' | 'caption',
  slideIndex?: number
): Promise<Post> {
  const first = await thinker()(buildPrompt(post, request, scope, slideIndex));
  try {
    return validatePost(extractJson(first));
  } catch (err) {
    // One retry with the validation error appended.
    const retry = await thinker()(buildPrompt(post, request, scope, slideIndex, String(err).slice(0, 500)));
    return validatePost(extractJson(retry));
  }
}
