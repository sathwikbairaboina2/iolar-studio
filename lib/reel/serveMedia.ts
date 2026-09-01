import { promises as fs } from 'fs';
import path from 'path';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (!rawStart && !rawEnd) return null;

  // "bytes=-500" means the last 500 bytes.
  let start = rawStart ? Number(rawStart) : size - Number(rawEnd);
  let end = rawStart && rawEnd ? Number(rawEnd) : size - 1;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return { start, end };
}

/**
 * Serves a media file with byte-range support.
 *
 * A <video> element cannot seek without it: Chrome asks for a range, a plain 200 with the
 * whole body makes seeking fail, and the studio player — which sets currentTime on every
 * clip change — sits on a black frame.
 */
export async function serveMedia(file: string, req: Request): Promise<Response> {
  const stat = await fs.stat(file);
  const type = mimeFor(file);
  const range = parseRange(req.headers.get('range'), stat.size);
  // Size and mtime together: a re-rendered shot keeps its name, and a retry that happens to
  // land on the same byte count still moves the clock.
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const cache = { etag, 'cache-control': 'no-cache' };

  if (!range) {
    // `no-cache` means "ask me first", not "do not keep it". The player mounts a fresh
    // element at every cut and preloads the shot after it; without this each of those reads
    // the file down the wire again, and a reel of short clips stalls between them.
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ...cache, 'accept-ranges': 'bytes' } });
    }
    const buf = await fs.readFile(file);
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': type,
        'content-length': String(stat.size),
        'accept-ranges': 'bytes',
        ...cache,
      },
    });
  }

  const length = range.end - range.start + 1;
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, range.start);
    return new Response(new Uint8Array(buf), {
      status: 206,
      headers: {
        'content-type': type,
        'content-length': String(length),
        'content-range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'accept-ranges': 'bytes',
        ...cache,
      },
    });
  } finally {
    await handle.close();
  }
}
