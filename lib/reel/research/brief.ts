import { z } from 'zod';

export const SOURCE_CLASSES = ["youtube", "news", "x", "blog", "github", "docs"] as const;
export const SourceClassSchema = z.enum(SOURCE_CLASSES);
export type SourceClass = z.infer<typeof SourceClassSchema>;

export const ReferenceReelSchema = z
  .object({
    url: z.string().url(),
    shortcode: z.string(),
    username: z.string(),
    caption: z.string(),
    viewCount: z.number().int().nullable(),
    likeCount: z.number().int().nullable(),
    takenAt: z.string().nullable(),
    source: z.enum(["instascraper", "manual"]),
  })
  .strict();

export const BriefSchema = z
  .object({
    runId: z.string().min(1),
    createdAt: z.string().datetime(),
    topic: z.string().min(1),
    angle: z.string().min(1),
    audience: z.string().min(1),
    videoFormat: z.enum(["reel", "short", "long"]),
    mustProve: z.array(z.string().min(1)).min(2).max(5),
    mustInclude: z.array(z.string()),
    avoid: z.array(z.string()),
    recencyWindowDays: z.number().int().positive(),
    sourceClasses: z.array(SourceClassSchema).min(1),
    searchQueries: z.array(
      z.object({ class: SourceClassSchema, queries: z.array(z.string().min(1)).min(1) }).strict(),
    ),
    referenceReel: ReferenceReelSchema.nullable(),
    // The run directory is the state machine: /reel reads this and continues
    // from wherever the run stopped.
    status: z.enum(["briefed", "hunted", "critiqued", "reviewed", "gathered", "drafted", "approved"]),
  })
  .strict();

export type Brief = z.infer<typeof BriefSchema>;

export function parseBrief(raw: unknown): Brief {
  const parsed = BriefSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`brief.json: ${issue.path.join(".") || "root"} — ${issue.message}`);
  }
  return parsed.data;
}

export function slugifyTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function makeRunId(topic: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}`;
  return `${slugifyTopic(topic)}-${stamp}`;
}
