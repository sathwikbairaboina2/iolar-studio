import { ChatOllama } from '@langchain/ollama';
import { getSettings } from '@/lib/settings';

/**
 * The local model as a Runner: the same signature the research agents already take, so a
 * stage that ran on headless Claude runs on qwen by swapping one argument.
 *
 * JSON mode is on for every call, because every agent prompt asks for JSON and a 27B
 * model asked nicely still drifts into prose one time in ten. Thinking is off: it costs
 * minutes on a long prompt and the reply is what is graded, not the reasoning.
 */
export type QwenOptions = {
  baseUrl?: string;
  model?: string;
  numCtx?: number;
  timeoutMs?: number;
};

export function makeQwen(opts: QwenOptions = {}) {
  const s = getSettings();
  return new ChatOllama({
    baseUrl: opts.baseUrl ?? s.researchOllamaUrl,
    model: opts.model ?? s.researchModel,
    format: 'json',
    think: false,
    numCtx: opts.numCtx ?? 32768,
    keepAlive: '10m',
    temperature: 0.2,
  });
}

export function qwenRunner(opts: QwenOptions = {}) {
  return async (prompt: string, run: { timeoutMs?: number } = {}): Promise<string> => {
    const model = makeQwen(opts);
    const timeoutMs = run.timeoutMs ?? opts.timeoutMs ?? 600_000;
    const reply = await model.invoke(prompt, { signal: AbortSignal.timeout(timeoutMs) });
    const content = reply.content;
    return typeof content === 'string'
      ? content
      : content.map((c) => ('text' in c ? c.text : '')).join('');
  };
}
