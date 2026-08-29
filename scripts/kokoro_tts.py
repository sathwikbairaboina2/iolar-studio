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

if not chunks:
    samples, rate = kokoro.create(text, voice=voice, speed=float(speed), lang="en-us")
    sf.write(out_path, samples, rate)
else:
    sf.write(out_path, np.concatenate(chunks), 24000)
