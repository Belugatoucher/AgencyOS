#!/usr/bin/env python3
"""Reference transcription + diarization worker for Agency OS Notes (docs/03).

Runs on the worker box; audio never leaves your infrastructure. Emits diarized
segments as JSON: {"segments": [{start_ms,end_ms,speaker,text}], "speakers": {}}.

Deps (installed in Dockerfile.worker):
    pip install faster-whisper pyannote.audio

Model: faster-whisper large-v3, int8 (CPU). ~6-8 min per hour of audio on 8 vCPU.
Set HF_TOKEN for the pyannote diarization model. If pyannote is unavailable,
falls back to a single SPEAKER_00 label so notes still generate.
"""
import argparse
import json
import os
import sys


def transcribe(input_path: str):
    from faster_whisper import WhisperModel

    model = WhisperModel("large-v3", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(input_path, word_timestamps=False)
    return [
        {"start_ms": int(s.start * 1000), "end_ms": int(s.end * 1000), "text": s.text.strip()}
        for s in segments
    ]


def diarize(input_path: str):
    """Return a list of (start_ms, end_ms, speaker) turns, or None if unavailable."""
    token = os.environ.get("HF_TOKEN")
    if not token:
        return None
    try:
        from pyannote.audio import Pipeline

        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=token)
        diar = pipeline(input_path)
        return [
            (int(turn.start * 1000), int(turn.end * 1000), f"SPEAKER_{speaker.split('_')[-1]:0>2}")
            for turn, _, speaker in diar.itertracks(yield_label=True)
        ]
    except Exception as e:  # pyannote missing or model unavailable — degrade gracefully
        print(f"diarization unavailable: {e}", file=sys.stderr)
        return None


def assign_speaker(seg, turns):
    if not turns:
        return "SPEAKER_00"
    mid = (seg["start_ms"] + seg["end_ms"]) / 2
    for start, end, speaker in turns:
        if start <= mid <= end:
            return speaker
    return "SPEAKER_00"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    segments = transcribe(args.input)
    turns = diarize(args.input)
    for seg in segments:
        seg["speaker"] = assign_speaker(seg, turns)

    with open(args.output, "w") as f:
        json.dump({"segments": segments, "speakers": {}}, f)


if __name__ == "__main__":
    main()
