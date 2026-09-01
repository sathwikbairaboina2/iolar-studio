"""Kokoro text-to-speech for reel voiceovers.

Reads the script on stdin, writes a wav to argv[1]. Higher quality than Piper and still
fully local; the model files live under models/kokoro/.
"""
import sys
import warnings

warnings.filterwarnings("ignore")
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from kokoro_onnx import Kokoro  # noqa: E402

out_path, model, voices, voice, speed = sys.argv[1:6]
text = sys.stdin.read().strip()

kokoro = Kokoro(model, voices)
chunks = []
# Long scripts are synthesised sentence by sentence: the model is trained on utterances,
# and one long block drifts in pace and volume.
for part in kokoro.create_stream_sync(text, voice=voice, speed=float(speed), lang="en-us") if hasattr(kokoro, "create_stream_sync") else []:
    chunks.append(part[0])

RATE = 24000
# A real speaker breathes between sentences; the model's chunks butt together with almost
# none. The gap is where everything downstream cuts — whisper hears clean sentence
# boundaries, and the bite planner gets silence to cut in instead of clipping a word.
PAUSE = np.zeros(int(0.30 * RATE), dtype=np.float32)

if not chunks:
    samples, rate = kokoro.create(text, voice=voice, speed=float(speed), lang="en-us")
    sf.write(out_path, samples, rate)
else:
    spaced = []
    for i, c in enumerate(chunks):
        if i:
            spaced.append(PAUSE)
        spaced.append(np.asarray(c, dtype=np.float32))
    sf.write(out_path, np.concatenate(spaced), RATE)
