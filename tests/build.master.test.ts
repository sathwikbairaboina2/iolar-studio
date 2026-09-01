import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => vi.resetModules());

const MEASURE = `
[Parsed_loudnorm_3 @ 0x1] 
{
	"input_i" : "-23.61",
	"input_tp" : "-4.47",
	"input_lra" : "7.10",
	"input_thresh" : "-34.13",
	"output_i" : "-16.05",
	"output_tp" : "-1.50",
	"output_lra" : "5.90",
	"output_thresh" : "-26.51",
	"normalization_type" : "linear",
	"target_offset" : "0.05"
}`;

describe('reading the loudness measurement back', () => {
  it('finds the JSON block at the end of everything else ffmpeg said', async () => {
    const { parseLoudness } = await import('@/lib/reel/build/master');
    const m = parseLoudness('size=N/A time=00:00:57.60 bitrate=N/A speed= 111x\n' + MEASURE);
    expect(m?.input_i).toBe('-23.61');
    expect(m?.target_offset).toBe('0.05');
  });

  it('returns null rather than a half-read measurement', async () => {
    const { parseLoudness } = await import('@/lib/reel/build/master');
    expect(parseLoudness('no json here')).toBeNull();
    expect(parseLoudness('{"input_i": "-23.61"}')).toBeNull();
  });
});

describe('mastering the voice', () => {
  it('measures first, then applies one linear gain from the measurement', async () => {
    const calls: string[][] = [];
    vi.doMock('@/lib/reel/probe', () => ({
      run: vi.fn(async (_c: string, args: string[]) => {
        calls.push(args);
        return { code: 0, stdout: '', stderr: calls.length === 1 ? MEASURE : '' };
      }),
    }));
    const { masterVoice } = await import('@/lib/reel/build/master');

    await masterVoice('in.wav', 'out.wav');

    expect(calls).toHaveLength(2);
    // First pass goes nowhere: it only measures.
    expect(calls[0]).toContain('null');
    const filter = calls[1][calls[1].indexOf('-af') + 1];
    // The shape in front of the loudness pass, in both passes.
    expect(filter).toContain('highpass=f=70');
    expect(filter).toContain('deesser');
    // The second pass carries the first pass's numbers, applied as a linear gain.
    expect(filter).toContain('measured_I=-23.61');
    expect(filter).toContain('linear=true');
    // The stem lands at the voice convention with true-peak headroom for the encode.
    expect(filter).toContain('I=-16');
    expect(filter).toContain('TP=-1.5');
    expect(calls[1]).toEqual(expect.arrayContaining(['-ar', '48000']));
  });

  it('still levels the voice when the measurement cannot be read', async () => {
    const calls: string[][] = [];
    vi.doMock('@/lib/reel/probe', () => ({
      run: vi.fn(async (_c: string, args: string[]) => {
        calls.push(args);
        return { code: 0, stdout: '', stderr: 'nothing useful' };
      }),
    }));
    const { masterVoice } = await import('@/lib/reel/build/master');

    await masterVoice('in.wav', 'out.wav');

    const filter = calls[1][calls[1].indexOf('-af') + 1];
    expect(filter).toContain('loudnorm=I=-16');
    expect(filter).not.toContain('linear=true');
  });

  it('reports a failed measure pass rather than mastering blind', async () => {
    vi.doMock('@/lib/reel/probe', () => ({
      run: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'boom' })),
    }));
    const { masterVoice } = await import('@/lib/reel/build/master');

    await expect(masterVoice('in.wav', 'out.wav')).rejects.toThrow(/measure failed/);
  });
});
