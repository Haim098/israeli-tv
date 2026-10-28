"""One-off check of Gemini TTS for Hebrew narration.

Reads GEMINI_API_KEY from the environment, makes at most two speech
requests (one via the Interactions API, one via generateContent) and
writes WAV files plus a report.json to the output folder. The key is
never printed, and project numbers are redacted from error bodies.
"""
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import wave

MODEL = os.environ.get("TTS_MODEL", "gemini-3.8-flash-tts")
BASE = "https://generativelanguage.googleapis.com/v1beta"
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"

TEXT = (
    "בלילה ההוא, כשכולם ברחו מהאש, הוא רץ פנימה. "
    "שלוש פעמים חזר אל הבניין הבוער, ובכל פעם יצא עם ילד בזרועותיו. "
    "עד היום, אף אחד מהם לא שוכח את שמו."
)
STYLE = "dramatic, emotional storyteller, slow and steady pace"


def redact(text):
    text = re.sub(r"AIza[0-9A-Za-z_\-]{20,}", "[key]", text)
    return re.sub(r"projects/\d+", "projects/[redacted]", text)


def call(method, url, key, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("x-goog-api-key", key)
    req.add_header("Content-Type", "application/json")
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as err:
        raw = err.read()
        status = err.code
    elapsed = round(time.time() - started, 2)
    try:
        payload = json.loads(raw)
    except ValueError:
        payload = {"non_json_body": redact(raw[:2000].decode("utf-8", "replace"))}
    return status, payload, elapsed


def save_audio(b64, mime, path):
    audio = base64.b64decode(b64)
    if audio[:4] == b"RIFF":
        with open(path, "wb") as f:
            f.write(audio)
    else:
        rate = 24000
        m = re.search(r"rate=(\d+)", mime or "")
        if m:
            rate = int(m.group(1))
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(audio)
    with wave.open(path, "rb") as w:
        info = {
            "file": os.path.basename(path),
            "bytes": os.path.getsize(path),
            "sample_rate": w.getframerate(),
            "channels": w.getnchannels(),
            "bits": w.getsampwidth() * 8,
            "seconds": round(w.getnframes() / float(w.getframerate()), 2),
            "mime_from_api": mime,
        }
    return info


def strip_audio(obj):
    """Drop base64 audio from a response so the rest can be logged."""
    if isinstance(obj, dict):
        return {k: ("[audio omitted]" if k == "data" and isinstance(v, str) and len(v) > 200
                    else strip_audio(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [strip_audio(v) for v in obj]
    return obj


def find_audio_interactions(payload):
    found = None
    for step in payload.get("steps", []) or []:
        for part in step.get("content", []) or []:
            if isinstance(part, dict) and part.get("type") == "audio" and part.get("data"):
                found = (part["data"], part.get("mime_type") or part.get("mimeType"))
    if not found:
        for part in payload.get("outputs", []) or []:
            if isinstance(part, dict) and part.get("type") == "audio" and part.get("data"):
                found = (part["data"], part.get("mime_type") or part.get("mimeType"))
    return found


def find_audio_generate(payload):
    for cand in payload.get("candidates", []) or []:
        for part in (cand.get("content") or {}).get("parts", []) or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return inline["data"], inline.get("mimeType") or inline.get("mime_type")
    return None


def main():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    os.makedirs(OUT, exist_ok=True)
    report = {"model": MODEL, "text": TEXT, "requests": []}

    if not key:
        print("GEMINI_API_KEY secret is not set yet; nothing to do.")
        report["skipped"] = "no GEMINI_API_KEY secret"
        with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        return 0

    # 1) Model metadata (not a generation request).
    status, payload, _ = call("GET", f"{BASE}/models/{MODEL}", key)
    report["model_info"] = {"status": status, "body": json.loads(redact(json.dumps(payload)))}
    print(f"model lookup: HTTP {status}")

    attempts = [
        ("interactions", "Kore", f"{BASE}/interactions", {
            "model": MODEL,
            "input": [{
                "type": "user_input",
                "content": [{
                    "type": "text",
                    "text": TEXT,
                    "annotations": [{"type": "speech_metadata", "style": STYLE}],
                }],
            }],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": "Kore"}]},
        }, find_audio_interactions),
        ("generateContent", "Charon", f"{BASE}/models/{MODEL}:generateContent", {
            "contents": [{"parts": [{"text": TEXT}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Charon"}}},
            },
        }, find_audio_generate),
    ]

    for api, voice, url, body, finder in attempts:
        status, payload, elapsed = call("POST", url, key, body)
        entry = {"api": api, "voice": voice, "http_status": status, "seconds": elapsed}
        audio = finder(payload) if status == 200 else None
        if audio:
            entry["audio"] = save_audio(audio[0], audio[1], os.path.join(OUT, f"hebrew_{voice}_{api}.wav"))
        entry["response"] = json.loads(redact(json.dumps(strip_audio(payload), ensure_ascii=False)))
        report["requests"].append(entry)

        usage = payload.get("usageMetadata") or payload.get("usage")
        print(f"{api} / {voice}: HTTP {status} in {elapsed}s")
        if usage:
            print("  usage:", json.dumps(usage))
        if audio:
            a = entry["audio"]
            print(f"  audio: {a['seconds']}s, {a['bytes']} bytes, {a['sample_rate']} Hz")
        elif status == 200:
            print("  no audio found in the response")
        if status != 200:
            err = payload.get("error", payload)
            print("  error:", redact(json.dumps(err, ensure_ascii=False))[:3000])
        if status == 429:
            print("  quota hit; stopping so no more requests count against it")
            break

    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
