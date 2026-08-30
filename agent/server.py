"""HTTP face of the agent. One endpoint that proposes, one that reports health."""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from graph import build_graph

app = FastAPI(title="iolar reel agent")
GRAPH = build_graph()

DEFAULT_OLLAMA = os.environ.get("OLLAMA_URL", "http://host.docker.internal:11436")
STUDIO_URL = os.environ.get("STUDIO_URL", "http://host.docker.internal:3120")


class ProposeIn(BaseModel):
    slug: str
    prompt: str
    reel: dict[str, Any]
    tools: list[dict[str, Any]]
    model: str = "lfm2.5"
    ollamaUrl: str | None = None
    numPredict: int = 1200
    maxRevisions: int = Field(default=3, ge=0, le=10)


def _ollama(url: str | None) -> str:
    """The studio addresses Ollama on the host; from in here that is a different name."""
    if not url:
        return DEFAULT_OLLAMA
    return url.replace("127.0.0.1", "host.docker.internal").replace("localhost", "host.docker.internal")


@app.get("/health")
async def health() -> dict[str, Any]:
    """Distinguishes 'container down' from 'model not pulled' for the studio."""
    out: dict[str, Any] = {"ok": True, "studioUrl": STUDIO_URL, "ollamaUrl": DEFAULT_OLLAMA}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(f"{DEFAULT_OLLAMA}/api/tags")
            res.raise_for_status()
            out["models"] = [m["name"] for m in res.json().get("models", [])]
            out["ollama"] = "up"
    except Exception as err:  # noqa: BLE001 - health must never raise
        out["ollama"] = f"unreachable: {err}"
    return out


@app.post("/propose")
async def propose(body: ProposeIn) -> JSONResponse:
    ollama_url = _ollama(body.ollamaUrl)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            tags = (await client.get(f"{ollama_url}/api/tags")).json()
        names = {m["name"] for m in tags.get("models", [])}
        # Ollama reports "lfm2.5:latest" for a model pulled as "lfm2.5".
        if body.model not in names and f"{body.model}:latest" not in names:
            return JSONResponse(
                {"error": f'model "{body.model}" not found on {ollama_url}. Pull it with `ollama pull {body.model}`.'},
                status_code=503,
            )
    except Exception as err:  # noqa: BLE001
        return JSONResponse({"error": f"Ollama at {ollama_url} is not reachable: {err}"}, status_code=503)

    state = {
        "prompt": body.prompt,
        "slug": body.slug,
        "reel": body.reel,
        "tools": body.tools,
        "model": body.model,
        "ollama_url": ollama_url,
        "studio_url": STUDIO_URL,
        "num_predict": body.numPredict,
        "max_revisions": body.maxRevisions,
        "revisions": 0,
    }

    try:
        final = await GRAPH.ainvoke(state)
    except Exception as err:  # noqa: BLE001
        return JSONResponse({"error": f"agent run failed: {err}"}, status_code=502)

    note = None
    if final.get("rejected"):
        note = f"Gave up after {final.get('revisions', 0)} revision(s); {len(final['rejected'])} command(s) still rejected."
    elif not final.get("commands"):
        note = "The agent proposed no changes."

    return JSONResponse(
        {"commands": final.get("commands", []), "note": note, "raw": final.get("raw", ""), "revisions": final.get("revisions", 0)}
    )
