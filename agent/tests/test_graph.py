"""The loop, with Ollama and the studio both stubbed.

Model quality is not testable here and is not the point; what is testable is that
the graph revises when the studio rejects a plan, and that it stops.
"""

from __future__ import annotations

import json

import httpx
import pytest

from graph import _extract, build_graph, tool_name_to_op


def test_tool_name_maps_back_to_op():
    assert tool_name_to_op("clip_trim") == "clip.trim"
    assert tool_name_to_op("caption_nudge") == "caption.nudge"


def test_extract_reads_real_tool_calls():
    commands, _ = _extract(
        {"tool_calls": [{"function": {"name": "clip_trim", "arguments": {"clipId": "c3", "edge": "out", "deltaSec": -0.5}}}]}
    )
    assert commands == [{"op": "clip.trim", "args": {"clipId": "c3", "edge": "out", "deltaSec": -0.5}}]


def test_extract_falls_back_to_json_in_content():
    """What qwen2.5-coder returned when probed: correct values, no tool_calls."""
    commands, _ = _extract({"content": '[{"name": "clip_delete", "arguments": {"clipId": "c1"}}]'})
    assert commands == [{"op": "clip.delete", "args": {"clipId": "c1"}}]


def test_extract_survives_truncated_output():
    """A thinking model starved of num_predict stops mid-sentence."""
    assert _extract({"content": "<think>\nOkay, clip c3 is"}) == ([], "<think>\nOkay, clip c3 is")
    assert _extract({"content": '[{"name":"clip_trim","argum'})[0] == []


def test_extract_returns_nothing_for_prose():
    assert _extract({"content": "You should shorten clip c3."})[0] == []


class FakeTransport(httpx.AsyncBaseTransport):
    """Answers Ollama and the studio, recording what was asked."""

    def __init__(self, chat_replies, preview_replies):
        self.chat_replies = list(chat_replies)
        self.preview_replies = list(preview_replies)
        self.chat_calls = []
        self.preview_calls = []

    async def handle_async_request(self, request):
        body = json.loads(request.content or b"{}")
        if request.url.path == "/api/chat":
            self.chat_calls.append(body)
            reply = self.chat_replies.pop(0)
            return httpx.Response(200, json={"message": reply})
        if request.url.path.endswith("/preview"):
            self.preview_calls.append(body)
            return httpx.Response(200, json=self.preview_replies.pop(0))
        raise AssertionError(f"unexpected request: {request.url}")


@pytest.fixture
def patch_httpx(monkeypatch):
    def install(transport):
        original = httpx.AsyncClient

        def factory(*args, **kwargs):
            kwargs["transport"] = transport
            return original(*args, **kwargs)

        monkeypatch.setattr(httpx, "AsyncClient", factory)
        return transport

    return install


BASE = {
    "prompt": "tighten the hook",
    "slug": "grok",
    "reel": {"title": "Grok", "timeline": {"clips": [{"id": "c1", "start": 0, "end": 4}], "captions": []}},
    "tools": [{"type": "function", "function": {"name": "clip_trim"}}],
    "model": "lfm2.5",
    "ollama_url": "http://ollama",
    "studio_url": "http://studio",
    "num_predict": 1200,
    "max_revisions": 3,
    "revisions": 0,
}


@pytest.mark.asyncio
async def test_a_clean_plan_stops_after_one_pass(patch_httpx):
    transport = patch_httpx(
        FakeTransport(
            chat_replies=[{"tool_calls": [{"function": {"name": "clip_trim", "arguments": {"clipId": "c1", "edge": "out", "deltaSec": -0.5}}}]}],
            preview_replies=[{"applied": [{"op": "clip.trim"}], "rejected": []}],
        )
    )

    out = await build_graph().ainvoke(BASE)

    assert out["commands"] == [{"op": "clip.trim", "args": {"clipId": "c1", "edge": "out", "deltaSec": -0.5}}]
    assert out["revisions"] == 0
    assert len(transport.chat_calls) == 1


@pytest.mark.asyncio
async def test_a_rejected_plan_is_revised_and_the_rejection_is_shown_to_the_model(patch_httpx):
    transport = patch_httpx(
        FakeTransport(
            chat_replies=[
                {"tool_calls": [{"function": {"name": "clip_trim", "arguments": {"clipId": "c99", "edge": "out", "deltaSec": -0.5}}}]},
                {"tool_calls": [{"function": {"name": "clip_trim", "arguments": {"clipId": "c1", "edge": "out", "deltaSec": -0.5}}}]},
            ],
            preview_replies=[
                {"applied": [], "rejected": [{"index": 0, "op": "clip.trim", "error": 'no clip "c99" on this reel'}]},
                {"applied": [{"op": "clip.trim"}], "rejected": []},
            ],
        )
    )

    out = await build_graph().ainvoke(BASE)

    assert out["commands"][0]["args"]["clipId"] == "c1"
    assert out["revisions"] == 1
    # The second prompt must carry the rejection, or the model cannot correct itself.
    assert "c99" in transport.chat_calls[1]["messages"][1]["content"]


@pytest.mark.asyncio
async def test_it_stops_at_the_revision_cap_rather_than_spinning(patch_httpx):
    bad = {"tool_calls": [{"function": {"name": "clip_trim", "arguments": {"clipId": "c99", "edge": "out", "deltaSec": -0.5}}}]}
    rejected = {"applied": [], "rejected": [{"index": 0, "op": "clip.trim", "error": "no clip"}]}
    transport = patch_httpx(FakeTransport(chat_replies=[bad] * 5, preview_replies=[rejected] * 5))

    out = await build_graph().ainvoke({**BASE, "max_revisions": 2})

    assert out["revisions"] == 2
    assert out["rejected"]
    assert len(transport.chat_calls) == 3  # first pass plus two revisions


@pytest.mark.asyncio
async def test_an_empty_plan_is_not_previewed(patch_httpx):
    """Nothing to simulate, so the studio is never called."""
    transport = patch_httpx(FakeTransport(chat_replies=[{"content": "Nothing needs changing."}], preview_replies=[]))

    out = await build_graph().ainvoke(BASE)

    assert out["commands"] == []
    assert transport.preview_calls == []
