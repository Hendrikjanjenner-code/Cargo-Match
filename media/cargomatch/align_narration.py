#!/usr/bin/env python3
"""Locally transcribe and force-align the revised CargoMatch narration."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import sys
import time
import wave
from importlib.metadata import version
from pathlib import Path
from typing import Any

from faster_whisper import WhisperModel


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "media/cargomatch/revised-narration.json"
PRODUCTION = ROOT / "media/cargomatch/production.json"
DEFAULT_OUTPUT = ROOT / "attached_assets/cargomatch/revised/alignment.json"
NORMALIZED_DIR = ROOT / "attached_assets/cargomatch/revised/audio"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_tokens(text: str) -> list[str]:
    # Whisper commonly emits the brand as two words. Treat either spelling alike.
    text = re.sub(r"\bCargoMatch\b", "Cargo Match", text, flags=re.IGNORECASE)
    # The English model writes this spoken quantity either as words or digits.
    text = re.sub(r"\b75\s*,?\s*000\b", "seventy five thousand", text)
    text = text.replace("’", "'")
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return ["ton" if token in {"ton", "tons", "tonne", "tonnes"} else token for token in tokens]


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as stream:
        return stream.getnframes() / stream.getframerate()


def wait_for_inputs(paths: list[Path], timeout: int) -> None:
    deadline = time.monotonic() + timeout
    missing = [path for path in paths if not path.is_file() or path.stat().st_size == 0]
    while missing and time.monotonic() < deadline:
        print("Waiting for normalized WAVs: " + ", ".join(path.name for path in missing), flush=True)
        time.sleep(3)
        missing = [path for path in paths if not path.is_file() or path.stat().st_size == 0]
    if missing:
        raise FileNotFoundError(
            "Normalized narration input(s) not found after "
            f"{timeout}s: " + ", ".join(str(path) for path in missing)
        )


def transcription_words(model: WhisperModel, path: Path) -> tuple[list[dict[str, Any]], str]:
    segments, _ = model.transcribe(
        str(path),
        language="en",
        beam_size=5,
        best_of=5,
        temperature=0,
        condition_on_previous_text=True,
        word_timestamps=True,
        vad_filter=False,
    )
    words: list[dict[str, Any]] = []
    transcript: list[str] = []
    for segment in segments:
        transcript.append(segment.text.strip())
        for word in segment.words or []:
            tokens = normalized_tokens(word.word)
            if not tokens or word.start is None or word.end is None:
                continue
            # A recognizer word can normalize to multiple units (e.g. CargoMatch).
            span = max(0.001, word.end - word.start)
            for index, token in enumerate(tokens):
                words.append(
                    {
                        "token": token,
                        "raw": word.word.strip(),
                        "start": word.start + span * index / len(tokens),
                        "end": word.start + span * (index + 1) / len(tokens),
                        "probability": word.probability,
                    }
                )
    expanded: list[dict[str, Any]] = []
    index = 0
    while index < len(words):
        if (
            words[index]["token"] == "75"
            and index + 1 < len(words)
            and words[index + 1]["token"] == "000"
        ):
            first, second = words[index], words[index + 1]
            start, end = first["start"], second["end"]
            for part, token in enumerate(("seventy", "five", "thousand")):
                expanded.append(
                    {
                        "token": token,
                        "raw": (first["raw"] + second["raw"]).strip(),
                        "start": start + (end - start) * part / 3,
                        "end": start + (end - start) * (part + 1) / 3,
                        "probability": min(first["probability"], second["probability"]),
                    }
                )
            index += 2
            continue
        expanded.append(words[index])
        index += 1
    return expanded, " ".join(transcript)


def script_layout(group: dict[str, Any], narration: dict[int, dict[str, Any]]) -> tuple[list[str], list[dict[str, Any]]]:
    tokens: list[str] = []
    items: list[dict[str, Any]] = []
    for narration_id in group["ids"]:
        entry = narration[narration_id]
        start = len(tokens)
        item_tokens = normalized_tokens(entry["en"])
        tokens.extend(item_tokens)
        english_sentences = split_sentences(entry["en"])
        dutch_sentences = split_sentences(entry["nl"])
        if len(english_sentences) != len(dutch_sentences):
            sentence_pairs = [(entry["en"], entry["nl"])]
        else:
            sentence_pairs = list(zip(english_sentences, dutch_sentences))
        cursor = start
        sentences = []
        for english, dutch in sentence_pairs:
            count = len(normalized_tokens(english))
            sentences.append(
                {"english": english, "dutch": dutch, "tokenStart": cursor, "tokenEnd": cursor + count}
            )
            cursor += count
        items.append(
            {
                "id": narration_id,
                "tokenStart": start,
                "tokenEnd": len(tokens),
                "sentences": sentences,
            }
        )
    return tokens, items


def word_matches(script: list[str], heard: list[dict[str, Any]]) -> tuple[dict[int, int], list[dict[str, Any]]]:
    heard_tokens = [word["token"] for word in heard]
    matcher = difflib.SequenceMatcher(None, script, heard_tokens, autojunk=False)
    matches: dict[int, int] = {}
    evidence = []
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            script_index = block.a + offset
            heard_index = block.b + offset
            matches[script_index] = heard_index
            word = heard[heard_index]
            evidence.append(
                {
                    "scriptIndex": script_index,
                    "script": script[script_index],
                    "heard": word["raw"],
                    "start": round(word["start"], 3),
                    "end": round(word["end"], 3),
                    "match": "exact",
                }
            )
    # Recover close substitutions inside SequenceMatcher's unmatched gaps, such
    # as Duisburg/Duesburg and booking/book. Keep these explicitly marked as
    # fuzzy evidence rather than pretending the recognizer emitted exact text.
    for script_index, script_token in enumerate(script):
        if script_index in matches:
            continue
        lower_heard = matches.get(script_index - 1, -1) + 1
        upper_heard = matches.get(script_index + 1, len(heard))
        candidates = [
            heard_index
            for heard_index in range(lower_heard, upper_heard)
            if heard_index not in matches.values()
        ]
        if not candidates:
            continue
        heard_index = max(
            candidates,
            key=lambda index: difflib.SequenceMatcher(
                None, script_token, heard[index]["token"], autojunk=False
            ).ratio(),
        )
        similarity = difflib.SequenceMatcher(
            None, script_token, heard[heard_index]["token"], autojunk=False
        ).ratio()
        if similarity < 0.72:
            continue
        matches[script_index] = heard_index
        word = heard[heard_index]
        evidence.append(
            {
                "scriptIndex": script_index,
                "script": script_token,
                "heard": word["raw"],
                "start": round(word["start"], 3),
                "end": round(word["end"], 3),
                "match": "fuzzy",
                "similarity": round(similarity, 3),
            }
        )
    evidence.sort(key=lambda entry: entry["scriptIndex"])
    return matches, evidence


def boundary_time(
    boundary: int,
    token_count: int,
    matches: dict[int, int],
    heard: list[dict[str, Any]],
    duration: float,
) -> tuple[float, bool]:
    """Return a script-token boundary time and whether it has direct evidence."""
    if boundary <= 0:
        return 0.0, True
    if boundary >= token_count:
        return duration, True

    left = max((index for index in matches if index < boundary), default=None)
    right = min((index for index in matches if index >= boundary), default=None)
    if left is not None and right is not None:
        left_word = heard[matches[left]]
        right_word = heard[matches[right]]
        if left == boundary - 1 and right == boundary:
            return (left_word["end"] + right_word["start"]) / 2, True
        fraction = (boundary - left) / (right - left)
        return left_word["end"] + fraction * (right_word["start"] - left_word["end"]), False
    if left is not None:
        left_word = heard[matches[left]]
        remaining_tokens = token_count - left - 1
        fraction = (boundary - left - 1) / max(1, remaining_tokens)
        return left_word["end"] + fraction * (duration - left_word["end"]), False
    if right is not None:
        right_word = heard[matches[right]]
        fraction = boundary / max(1, right)
        return fraction * right_word["start"], False
    return duration * boundary / max(1, token_count), False


def align_group(
    group: dict[str, Any],
    narration: dict[int, dict[str, Any]],
    heard: list[dict[str, Any]],
    transcript: str,
    duration: float,
) -> dict[str, Any]:
    script, item_layout = script_layout(group, narration)
    matches, evidence = word_matches(script, heard)
    lexical_confidence = len(matches) / max(1, len(script))
    mean_word_probability = (
        sum(float(word.get("probability") or 0) for word in heard) / len(heard) if heard else 0.0
    )
    warnings: list[str] = []
    unmatched = [token for index, token in enumerate(script) if index not in matches]
    if unmatched:
        warnings.append("Unmatched supplied-script words: " + ", ".join(unmatched) + ".")
    if lexical_confidence < 0.95:
        warnings.append(
            f"Low lexical alignment confidence: {len(matches)}/{len(script)} supplied-script words matched recognition."
        )
    if mean_word_probability < 0.75:
        warnings.append(f"Recognizer mean word probability is low ({mean_word_probability:.3f}).")
    if not heard:
        warnings.append("Recognizer returned no timestamped words; timings are unverified.")

    boundaries: dict[int, float] = {}
    direct: dict[int, bool] = {}
    requested = {0, len(script)}
    for item in item_layout:
        requested.update((item["tokenStart"], item["tokenEnd"]))
        for sentence in item["sentences"]:
            requested.update((sentence["tokenStart"], sentence["tokenEnd"]))
    previous = 0.0
    for boundary in sorted(requested):
        value, is_direct = boundary_time(boundary, len(script), matches, heard, duration)
        value = min(duration, max(previous, value))
        boundaries[boundary] = value
        direct[boundary] = is_direct
        previous = value

    items = []
    for item in item_layout:
        item_start = boundaries[item["tokenStart"]]
        item_end = boundaries[item["tokenEnd"]]
        sentences = []
        for sentence in item["sentences"]:
            sentence_start = boundaries[sentence["tokenStart"]]
            sentence_end = boundaries[sentence["tokenEnd"]]
            sentences.append(
                {
                    "english": sentence["english"],
                    "dutch": sentence["dutch"],
                    "start": round(sentence_start, 3),
                    "end": round(sentence_end, 3),
                }
            )
            if not direct[sentence["tokenStart"]] or not direct[sentence["tokenEnd"]]:
                warnings.append(
                    f"Narration {item['id']} sentence boundary used interpolation around unmatched words."
                )
        items.append(
            {
                "id": item["id"],
                "start": round(item_start, 3),
                "end": round(item_end, 3),
                "sentences": sentences,
            }
        )

    return {
        "id": group["id"],
        "duration": round(duration, 3),
        "items": items,
        "confidence": {
            "matchedScriptWords": len(matches),
            "scriptWords": len(script),
            "lexicalMatchRatio": round(lexical_confidence, 4),
            "meanRecognizerWordProbability": round(mean_word_probability, 4),
        },
        "recognizedText": transcript,
        "evidenceWords": evidence,
        "warnings": sorted(set(warnings)),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base.en", help="faster-whisper model name or local path")
    parser.add_argument("--wait-seconds", type=int, default=180)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text())
    production = json.loads(PRODUCTION.read_text())
    narration = {entry["id"]: entry for entry in production["narration"]}
    wavs = {group["id"]: NORMALIZED_DIR / f"{group['id']}-normalized.wav" for group in manifest["groups"]}
    wait_for_inputs(list(wavs.values()), args.wait_seconds)

    print(f"Loading faster-whisper {args.model} on {args.device}/{args.compute_type}", flush=True)
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    groups = []
    for group in manifest["groups"]:
        path = wavs[group["id"]]
        duration = wav_duration(path)
        print(f"Transcribing {path} ({duration:.2f}s)", flush=True)
        heard, transcript = transcription_words(model, path)
        result = align_group(group, narration, heard, transcript, duration)
        result["normalizedSha256"] = sha256_file(path)
        groups.append(result)
        confidence = result["confidence"]["lexicalMatchRatio"]
        print(f"Aligned {group['id']}: {confidence:.1%} exact lexical match", flush=True)

    payload = {
        "model": args.model,
        "fasterWhisperVersion": version("faster-whisper"),
        "source": "normalized WAV files",
        "manifestSha256": sha256_file(MANIFEST),
        "scriptSha256": sha256_file(PRODUCTION),
        "groups": groups,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    total_matched = sum(group["confidence"]["matchedScriptWords"] for group in groups)
    total_script = sum(group["confidence"]["scriptWords"] for group in groups)
    print(f"Wrote {args.output}; aggregate lexical match {total_matched}/{total_script} ({total_matched / total_script:.1%})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError, wave.Error) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)