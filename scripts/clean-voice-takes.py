#!/usr/bin/env python3
"""Clean spoken-narration takes for the demonstration video.

Removes named false starts, trims over-long pauses and the head and tail of each
take, then applies a light processing chain. Writes <name>-clean.wav beside each
input.

Usage:
  python3 scripts/clean-voice-takes.py take1.wav take2.wav
  python3 scripts/clean-voice-takes.py --cut take1.wav:15.79-15.97 take1.wav

The chain deliberately contains no compressor and no broadband denoiser. Both
were measured against a speech-to-text transcript of the same audio and both
smeared consonants: "stop" was heard as "start" and "healthy" as "help you".
Surgical notches plus a gentle gate remove the recording's hum without touching
the speech.
"""
import argparse
import subprocess
from pathlib import Path

MAX_SILENCE = 1.0      # only trim pauses longer than this
TARGET_SILENCE = 0.7   # what a trimmed pause becomes
EDGE_SILENCE = 0.25    # silence left at the head and tail of a take
PAD = 0.08             # room tone left either side of a join

CHAIN = ",".join([
    "highpass=f=90:poles=2",                                # rumble below the voice
    "equalizer=f=120:t=q:w=4:g=-10",                        # notch the 120 Hz buzz
    "equalizer=f=70:t=q:w=3:g=-8",                          # notch the low hum cluster
    "agate=threshold=0.012:ratio=2:attack=15:release=250",  # quiet room tone between phrases
    "deesser=i=0.2",
    "equalizer=f=240:t=q:w=1.1:g=-2",                       # less boxiness
    "equalizer=f=3200:t=q:w=1.3:g=1.5",                     # a little presence
    "loudnorm=I=-16:TP=-1.5:LRA=9",
])


def duration(path: Path) -> float:
    return float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path),
    ]))


def silences(path: Path, minimum: float) -> list[tuple[float, float]]:
    output = subprocess.run([
        "ffmpeg", "-v", "info", "-i", str(path),
        "-af", f"silencedetect=noise=-38dB:d={minimum}", "-f", "null", "-",
    ], capture_output=True, text=True).stderr
    spans: list[tuple[float, float]] = []
    start = None
    for line in output.splitlines():
        if "silence_start" in line:
            start = float(line.rsplit("silence_start:", 1)[1].strip())
        elif "silence_end" in line and start is not None:
            end = float(line.rsplit("silence_end:", 1)[1].split("|")[0].strip())
            spans.append((start, end))
            start = None
    if start is not None:
        spans.append((start, duration(path)))
    return spans


def keep_segments(path: Path, cuts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    total = duration(path)
    drops = list(cuts)
    for start, end in silences(path, MAX_SILENCE):
        if end - start > MAX_SILENCE:
            # Trim from the start of the pause. The silence immediately before
            # the next word must survive, or the join clips its first consonant.
            drops.append((start + 0.12, start + 0.12 + (end - start) - TARGET_SILENCE))
    drops.sort()

    segments: list[tuple[float, float]] = []
    cursor = 0.0
    for start, end in drops:
        start, end = max(start, cursor), min(end, total)
        if end - start <= 0.02:
            continue
        if start - cursor > 0.05:
            segments.append((cursor, start + PAD))
        cursor = max(cursor, end - PAD)
    if total - cursor > 0.05:
        segments.append((cursor, total))

    edges = silences(path, 0.25)
    head = edges[0][1] if edges and edges[0][0] <= 0.05 else 0.0
    tail = total - edges[-1][0] if edges and total - edges[-1][1] < 0.05 else 0.0
    if head > EDGE_SILENCE + 0.05 and segments:
        first_start, first_end = segments[0]
        segments[0] = (min(first_start + head - EDGE_SILENCE, first_end - 0.1), first_end)
    if tail > EDGE_SILENCE + 0.05 and segments:
        last_start, last_end = segments[-1]
        segments[-1] = (last_start, max(last_end - (tail - EDGE_SILENCE), last_start + 0.1))
    return segments


def clean(path: Path, cuts: list[tuple[float, float]]) -> Path:
    segments = keep_segments(path, cuts)
    trims = "".join(
        f"[0:a]atrim=start={start:.3f}:end={end:.3f},asetpts=N/SR/TB[s{index}];"
        for index, (start, end) in enumerate(segments)
    )
    joins = "".join(f"[s{index}]" for index in range(len(segments)))
    graph = f"{trims}{joins}concat=n={len(segments)}:v=0:a=1[joined];[joined]{CHAIN}[out]"
    target = path.with_name(f"{path.stem}-clean.wav")
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-i", str(path),
        "-filter_complex", graph, "-map", "[out]", str(target),
    ], check=True)
    print(f"{path.name}: {len(segments)} segments, {duration(path):.2f}s -> {duration(target):.2f}s")
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("takes", nargs="+", type=Path)
    parser.add_argument("--cut", action="append", default=[],
                        metavar="FILE:START-END", help="remove a span, e.g. take1.wav:15.79-15.97")
    arguments = parser.parse_args()

    cuts: dict[str, list[tuple[float, float]]] = {}
    for entry in arguments.cut:
        name, span = entry.rsplit(":", 1)
        start, end = span.split("-")
        cuts.setdefault(Path(name).name, []).append((float(start), float(end)))

    for take in arguments.takes:
        clean(take, cuts.get(take.name, []))


if __name__ == "__main__":
    main()
