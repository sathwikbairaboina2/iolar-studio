"""Word-level alignment for reel voiceovers.

Prints {"text": str, "words": [{"w","start","end"}]} on stdout.
Uses openai-whisper (torch + the ffmpeg binary) rather than faster-whisper: PyAV's
DLLs are blocked by Windows Application Control on this machine.
"""
import contextlib
import json
import sys
import warnings

warnings.filterwarnings("ignore")
import whisper  # noqa: E402

audio, model_name, device = sys.argv[1], sys.argv[2], sys.argv[3]
prompt = sys.stdin.read().strip() or None

# whisper prints progress and "Detected language" on stdout; stdout is our JSON channel,
# so everything the library says goes to stderr instead.
with contextlib.redirect_stdout(sys.stderr):
    model = whisper.load_model(model_name, device=device)
    result = model.transcribe(
        audio,
        word_timestamps=True,
        initial_prompt=prompt,
        fp16=(device == "cuda"),
        verbose=False,
    )

words = []
for seg in result.get("segments", []):
    for w in seg.get("words", []):
        token = w["word"].strip()
        if token:
            words.append({"w": token, "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3)})

json.dump({"text": result.get("text", "").strip(), "words": words}, sys.stdout)
