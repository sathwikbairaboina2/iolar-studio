import { z } from 'zod';
import { COMMANDS } from '@/lib/reel/commands';

/**
 * The tool list a model is shown, generated from the command registry.
 *
 * Never hand-write these. Copying an enum by hand is how `crossfade` became
 * `fade` while the registry was being built; the same slip here would surface as
 * the model appearing to hallucinate a value it was in fact handed.
 */

export type AgentTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  };
};

/** Function-calling schemas disallow dots in names, so `clip.trim` is offered as `clip_trim`. */
export function opToToolName(op: string): string {
  return op.replace(/\./g, '_');
}

export function toolNameToOp(name: string): string | null {
  const match = Object.keys(COMMANDS).find((op) => opToToolName(op) === name);
  return match ?? null;
}

/** A human-readable line per op; it is the only guidance the model gets. */
const DESCRIPTIONS: Record<string, string> = {
  'clip.trim':
    'Change how long a clip runs by moving one of its edges. Negative deltaSec shortens the clip, positive lengthens it. Trimming the "in" edge moves its start, "out" moves its end.',
  'clip.split': 'Cut one clip into two at a timestamp, in seconds from the start of the reel.',
  'clip.delete': 'Remove a clip from the timeline. The clips after it close the gap.',
  'clip.move': 'Reorder a clip to a different slot in the timeline, counting from 0.',
  'clip.motion':
    'Set how the camera moves across a clip: zoom-in, zoom-out, pan-left, pan-right or hold. Strength is how far it travels, roughly 0 to 0.3.',
  'clip.fit': 'Choose whether a clip fills the frame (cover) or is letterboxed whole (contain).',
  'clip.transition': 'Set how a clip enters: a hard cut, or a crossfade from the previous clip.',
  'clip.asset': 'Point a clip at a different piece of footage already attached to this reel.',
  'beat.text':
    'Rewrite the line one beat speaks. The recorded voiceover still says the old words, so the take has to be spoken again before the reel matches the script.',
  'caption.edit': 'Rewrite the words of one caption cue.',
  'caption.nudge':
    'Shift a caption cue earlier or later. Negative deltaSec moves it earlier, which is the fix when a caption appears late.',
  'caption.toggle': 'Hide or show a caption cue without deleting it.',
  'caption.merge': 'Join a caption cue with the one after it so the two read as a single line.',
  'caption.split': 'Break one caption cue into two at its middle word.',
};

export function agentTools(): AgentTool[] {
  return Object.entries(COMMANDS).map(([op, spec]) => {
    const schema = z.toJSONSchema(spec.args) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    return {
      type: 'function' as const,
      function: {
        name: opToToolName(op),
        description: DESCRIPTIONS[op] ?? op,
        parameters: {
          type: 'object' as const,
          properties: schema.properties ?? {},
          required: schema.required ?? [],
        },
      },
    };
  });
}
