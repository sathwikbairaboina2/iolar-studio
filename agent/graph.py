"""The propose-preview-revise loop.

This loop is the reason the service exists. A single chat completion would need
no graph and no container; what earns them is that the agent sees its own plan
simulated against the real reel and gets to correct it before a human is shown
anything.

The agent never writes. `/preview` is a dry run, and applying is a separate,
human-initiated call back in the studio.
"""

from __future__ import annotations

import json
from typing import Any, TypedDict

import httpx
from langgraph.graph import END, StateGraph


class Rejection(TypedDict):
    index: int
    op: str
    error: str


class State(TypedDict, total=False):
    prompt: str
    slug: str
    reel: dict[str, Any]
    tools: list[dict[str, Any]]
    model: str
    ollama_url: str
    studio_url: str
    num_predict: int
    max_revisions: int
    commands: list[dict[str, Any]]
    rejected: list[Rejection]
    revisions: int
    note: str
    raw: str


SYSTEM = (
    "You edit a short-form vertical video reel by calling tools. "
    "You are given the reel's clips and caption cues with their ids and timings. "
    "Call only the tools needed to satisfy the request, using the ids exactly as given. "
    "Negative deltaSec means earlier or shorter; positive means later or longer. "
    "If nothing should change, call nothing."
)


def tool_name_to_op(name: str) -> str:
    """`clip_trim` -> `clip.trim`. Every op has exactly one dot."""
    return name.replace("_", ".", 1)


def _summarise(reel: dict[str, Any]) -> dict[str, Any]:
    """Only what an editing decision needs. Word-level VO timings would swamp a small model."""
    timeline = reel.get("timeline", {})
    return {
        "title": reel.get("title"),
        "durationSec": (reel.get("vo") or {}).get("durationSec", 0),
        "clips": [
            {
                "id": c["id"],
                "start": c["start"],
                "end": c["end"],
                "lengthSec": round(c["end"] - c["start"], 3),
                "motion": c.get("motion", {}).get("type"),
                "fit": c.get("fit"),
                "transition": c.get("transition"),
            }
            for c in timeline.get("clips", [])
        ],
        "captions": [
            {"id": c["id"], "start": c["start"], "end": c["end"], "text": c.get("text", "")}
            for c in timeline.get("captions", [])
        ],
    }


def _extract(message: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    """Reads tool calls, tolerating a model that puts them in content instead.

    qwen2.5-coder returned a JSON array in `content` with no tool_calls at all,
    and its values were correct. The same tolerance lives on the TypeScript side;
    it is needed in both places because each parses a different hop.
    """
    calls = message.get("tool_calls") or []
    raw = message.get("content") or ""

    if not calls and raw:
        text = raw
        if "```" in text:
            parts = text.split("```")
            text = max((p for p in parts), key=len)
            text = text.removeprefix("json").strip()
        start, end = text.find("["), text.rfind("]")
        if 0 <= start < end:
            try:
                parsed = json.loads(text[start : end + 1])
                if isinstance(parsed, list):
                    calls = [{"function": c} for c in parsed]
            except json.JSONDecodeError:
                # Truncated output — a thinking model starved of num_predict looks
                # exactly like this. Proposing nothing is the honest answer.
                calls = []

    commands: list[dict[str, Any]] = []
    for call in calls:
        fn = call.get("function") or {}
        name = fn.get("name")
        args = fn.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                continue
        if not name or not isinstance(args, dict):
            continue
        commands.append({"op": tool_name_to_op(name), "args": args})
    return commands, raw


async def plan(state: State) -> State:
    """Ask the model for a plan, telling it about any rejections from last time."""
    user = [f"The reel:\n{json.dumps(_summarise(state['reel']), indent=1)}", f"\nThe request:\n{state['prompt']}"]
    if state.get("rejected"):
        lines = "\n".join(f"- {r['op']}: {r['error']}" for r in state["rejected"])
        user.append(f"\nYour previous attempt was rejected. Fix these and try again:\n{lines}")

    payload = {
        "model": state["model"],
        "stream": False,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "\n".join(user)}],
        "tools": state["tools"],
        # A thinking model cut off mid-thought produces nothing at all, which is
        # indistinguishable from a model that cannot tool-call. Give it room.
        "options": {"num_predict": state["num_predict"], "temperature": 0},
    }

    async with httpx.AsyncClient(timeout=300) as client:
        res = await client.post(f"{state['ollama_url']}/api/chat", json=payload)
        res.raise_for_status()
        message = res.json().get("message", {})

    commands, raw = _extract(message)
    return {**state, "commands": commands, "raw": raw}


async def simulate(state: State) -> State:
    """Dry-run the plan against the real reel. Nothing is written."""
    if not state["commands"]:
        return {**state, "rejected": []}

    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            f"{state['studio_url']}/api/reel/{state['slug']}/preview",
            json={"commands": state["commands"]},
        )
        res.raise_for_status()
        out = res.json()

    return {**state, "rejected": out.get("rejected", [])}


def decide(state: State) -> str:
    if not state.get("rejected"):
        return END
    if state.get("revisions", 0) >= state["max_revisions"]:
        return END
    return "revise"


async def revise(state: State) -> State:
    return {**state, "revisions": state.get("revisions", 0) + 1}


def build_graph():
    g = StateGraph(State)
    g.add_node("plan", plan)
    g.add_node("simulate", simulate)
    g.add_node("revise", revise)
    g.set_entry_point("plan")
    g.add_edge("plan", "simulate")
    g.add_conditional_edges("simulate", decide, {"revise": "revise", END: END})
    g.add_edge("revise", "plan")
    return g.compile()
