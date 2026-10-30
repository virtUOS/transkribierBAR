"""Stand-ins for the remote ASR and LLM servers, for end-to-end tests and local runs.

One process serves both:
  - a MurmurAI-compatible ASR API under /v1/transcript  (ASR_BACKEND=murmurai, ASR_URL=<base>)
  - an OpenAI-compatible chat API at /v1/chat/completions (LLM_PROVIDER=openai, LLM_BASE_URL=<base>/v1)

Answers are canned and deterministic; nothing is transcribed or generated. Start with:
  python -m scripts.fake_services --port 8880

An initial prompt containing "fake:fail" makes the ASR job fail, so the failure
path can be exercised from the UI. GET /_fake/requests lists what was received.
"""
import argparse
import json
import re
import uuid

import uvicorn
from fastapi import FastAPI, Form, HTTPException, Request, Response, UploadFile

app = FastAPI(title="Fake ASR/LLM services")

transcripts: dict[str, dict] = {}
requests_log: list[dict] = []

UTTERANCES = [
    (0, 2400, "Welcome to the weekly project meeting."),
    (2400, 5200, "Thanks. Today we look at the test suite."),
    (5200, 8000, "We agreed to add end-to-end tests."),
    (8000, 10500, "Great, let us write them this week."),
]


def _transcript(job_id: str, diarize: bool, language: str | None) -> dict:
    utterances = [
        {
            "start": start,
            "end": end,
            "text": text,
            "speaker": (f"SPEAKER_0{i % 2}" if diarize else None),
        }
        for i, (start, end, text) in enumerate(UTTERANCES)
    ]
    return {
        "id": job_id,
        "status": "completed",
        "language": language or "en",
        "text": " ".join(u["text"] for u in utterances),
        "utterances": utterances,
    }


@app.post("/v1/transcript")
async def submit(
    file: UploadFile,
    speaker_labels: str = Form("false"),
    language_code: str | None = Form(None),
    model: str | None = Form(None),
    initial_prompt: str | None = Form(None),
):
    size = len(await file.read())
    job_id = str(uuid.uuid4())
    requests_log.append({
        "api": "asr", "method": "POST", "id": job_id, "bytes": size,
        "speaker_labels": speaker_labels, "language_code": language_code, "model": model,
    })
    if initial_prompt and "fake:fail" in initial_prompt:
        transcripts[job_id] = {"id": job_id, "status": "error", "error": "Fake ASR failure"}
    else:
        transcripts[job_id] = _transcript(job_id, speaker_labels == "true", language_code)
    return {"id": job_id, "status": "queued"}


@app.get("/v1/transcript/{job_id}")
async def get_transcript(job_id: str):
    if job_id not in transcripts:
        raise HTTPException(404)
    return transcripts[job_id]


@app.delete("/v1/transcript/{job_id}")
async def delete_transcript(job_id: str):
    requests_log.append({"api": "asr", "method": "DELETE", "id": job_id})
    if transcripts.pop(job_id, None) is None:
        raise HTTPException(404)
    return Response(status_code=204)


def _chat_reply(system: str, user: str) -> str:
    """Pick a canned answer from the shape of the prompt the app sent."""
    if system.startswith("Generate a short descriptive title"):
        return "Weekly project meeting"
    if not system:
        # Consolidation of several refinement summaries.
        return "Fixed punctuation."
    try:
        payload = json.loads(user)
    except ValueError:
        payload = None
    if isinstance(payload, list):
        # Translation and refinement both echo every utterance back.
        if system.startswith("You are a subtitle translator"):
            match = re.search(r"translate all text to ([^.\n]+)", system)
            tag = match.group(1) if match else "translated"
            return json.dumps({"utterances": [{**u, "text": f"[{tag}] {u['text']}"} for u in payload]})
        return json.dumps({
            "utterances": [{**u, "text": u["text"].replace("let us", "let's")} for u in payload],
            "changes_summary": "Fixed punctuation.",
        })
    if system.startswith("You are a meeting protocol generator"):
        return json.dumps({
            "title": "Weekly project meeting",
            "participants": ["SPEAKER_00", "SPEAKER_01"],
            "key_points": [{"topic": "Testing", "speaker": "SPEAKER_01", "timestamp": 2400,
                            "content": "The test suite was reviewed."}],
            "decisions": [{"decision": "Add end-to-end tests.", "timestamp": 5200}],
            "action_items": [{"task": "Write the tests", "assignee": "SPEAKER_00", "timestamp": 8000}],
        })
    return json.dumps({
        "summary": "The team agreed to add end-to-end tests.",
        "chapters": [
            {"title": "Opening", "start_time": 0, "end_time": 5200, "summary": "Welcome and agenda."},
            {"title": "Decision", "start_time": 5200, "end_time": 10500, "summary": "Tests get written."},
        ],
    })


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    system = next((m["content"] for m in messages if m["role"] == "system"), "")
    user = next((m["content"] for m in messages if m["role"] == "user"), "")
    requests_log.append({"api": "llm", "method": "POST", "system": system[:80]})
    content = _chat_reply(system, user)
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": 0,
        "model": body.get("model", "fake"),
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": len(user) // 4, "completion_tokens": len(content) // 4,
                  "total_tokens": (len(user) + len(content)) // 4},
    }


@app.get("/_fake/requests")
async def received():
    return requests_log


@app.get("/_fake/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8880)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
