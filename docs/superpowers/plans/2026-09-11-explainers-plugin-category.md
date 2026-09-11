# Explainers Plugin Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `explainer` category to the templates service so a hand-written JSON document of
seven animation ops renders to a deterministic mp4, without generalising or disturbing the
existing `tools` category.

**Architecture:** `explainer` is a category-local stack — its own contract, pydantic model, timing,
props and Remotion composition — sharing only section-agnostic plumbing (`jobs.py`, `worker.py`,
`renderer.py`, `assets.py`, `capture.py`). Two dispatch points move so a second category can exist
at all: `ReelDoc.template: Literal["tools"]` becomes a discriminated union over a category
registry, and `Root.tsx` becomes a registry of `${category}-${theme}` composition ids. Nothing
else in the tools stack is touched, and the existing `api/tests/` suite runs unedited as the proof.

**Tech Stack:** Python 3.12, pydantic v2, FastAPI, pytest (`timeout = 300`), Node 20+, Remotion,
TypeScript, zod.

**Spec:** `docs/superpowers/specs/2026-09-11-explainers-design.md` (in the instastudio repo,
worktree `iolar-reels`). The plan argues from the spec; read both.

**Repository:** `C:\Users\sathwik\projects\plugins\main-reels-templates-plugin`. This is a
different repository from the one holding this plan. All paths below are relative to the plugin
repo unless marked otherwise.

## Global Constraints

- Category name is exactly `explainer`. The user's word is **category**, not "family" — use it in
  code, comments and commit messages.
- Themes are the existing four ids, values copied verbatim: `glass-bento`, `kinetic`,
  `dashboard-bento`, `sticker-board`.
- The seven ops, exactly: `stage`, `send`, `mark`, `meter`, `race`, `reveal`, `panel`.
- Beat roles, exactly: `hook`, `step`, `payoff`, `cta`.
- Contract limits, copied verbatim from the spec: `steps` 12, `nodes` 6, `label` 28, `line` 90.
- Contract defaults, copied verbatim from the spec: `hook` 3, `step` 2, `payoff` 4, `cta` 3.
- **No new dependencies** in `api/pyproject.toml` or `render/package.json`.
- **Do not edit any file under `api/tests/` that already exists.** Those tests are the proof the
  tools stack is unchanged. A pre-existing test that needs modifying to keep passing means the
  change was not minimal — stop and report rather than editing the test.
- Frames are the truth; seconds derive from them. Rounding is `max(1, math.floor(sec * fps + 0.5))`
  to match `render/src/timing.ts`.
- Test commands, from the plugin repo root:
  - Python: `cd api && .venv/Scripts/python -m pytest`
  - A single test: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_models.py -v`
  - Render bundle: `cd render && npm run build:preview`

---

### Task 1: The explainer contract appears in GET /templates

Proves the claim the spec rests on — `GET /templates` scans the templates directory and needs no
Python change to serve a new category.

**Files:**
- Create: `templates/explainer/template.json`
- Test: `api/tests/test_explainer_contract.py`

**Interfaces:**
- Consumes: nothing.
- Produces: the contract document served at `GET /templates`, with `name` `"explainer"` and an
  `ops` object whose keys are the seven op names and whose values are `{"requires": [...]}`.

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_explainer_contract.py
OPS = {"stage", "send", "mark", "meter", "race", "reveal", "panel"}


def _explainer(client):
    body = client.get("/templates").json()["templates"]
    return next(t for t in body if t["name"] == "explainer")


def test_explainer_is_listed_without_python_changes(client):
    assert _explainer(client)["displayName"] == "Explainer"


def test_contract_declares_the_seven_ops_with_required_keys(client):
    ops = _explainer(client)["ops"]
    assert set(ops) == OPS
    assert ops["send"]["requires"] == ["from", "to", "label"]
    assert ops["panel"]["requires"] == ["title", "lines"]


def test_contract_carries_limits_defaults_and_the_four_themes(client):
    t = _explainer(client)
    assert t["limits"] == {"steps": 12, "nodes": 6, "label": 28, "line": 90}
    assert t["defaults"] == {"hook": 3, "step": 2, "payoff": 4, "cta": 3}
    assert t["themes"] == ["glass-bento", "kinetic", "dashboard-bento", "sticker-board"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_contract.py -v`
Expected: FAIL with `StopIteration` — no template named `explainer` is listed.

- [ ] **Step 3: Write the contract**

```json
{
  "name": "explainer",
  "displayName": "Explainer",
  "sections": ["hook", "steps", "payoff", "cta"],
  "required": ["hook", "steps", "payoff"],
  "ops": {
    "stage":  { "requires": ["nodes"] },
    "send":   { "requires": ["from", "to", "label"] },
    "mark":   { "requires": ["node", "state"] },
    "meter":  { "requires": ["label", "to"] },
    "race":   { "requires": ["lanes"] },
    "reveal": { "requires": ["text"] },
    "panel":  { "requires": ["title", "lines"] }
  },
  "defaults": { "hook": 3, "step": 2, "payoff": 4, "cta": 3 },
  "limits": { "steps": 12, "nodes": 6, "label": 28, "line": 90 },
  "themes": ["glass-bento", "kinetic", "dashboard-bento", "sticker-board"]
}
```

`load_template` also globs `samples/*.json`; the directory does not exist yet and an absent glob
yields an empty dict, so `samples` comes back `{}` until Task 7. That is expected here.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_contract.py -v`
Expected: 3 passed.

- [ ] **Step 5: Run the whole suite to prove tools is untouched**

Run: `cd api && .venv/Scripts/python -m pytest`
Expected: all pre-existing tests pass, plus the 3 new ones. No pre-existing test was edited.

- [ ] **Step 6: Commit**

```bash
git add templates/explainer/template.json api/tests/test_explainer_contract.py
git commit -m "feat(explainer): declare the explainer category contract

GET /templates already scans the templates directory, so the category is
served with no Python change. Seven ops, each naming the data keys it
requires, plus the limits and defaults the studio authors against."
```

---

### Task 2: The ExplainerDoc model

The document, with per-op data validated by a discriminated union so a bad beat produces a 422
whose `loc` names the beat index and the offending field.

**Files:**
- Create: `api/reels_api/models_explainer.py`
- Test: `api/tests/test_explainer_models.py`

**Interfaces:**
- Consumes: `Brand`, `Music`, `ThemeId`, `Ratio` from `reels_api.models`.
- Produces: `ExplainerDoc` with fields `template: Literal["explainer"]`, `theme`, `ratio`, `fps`,
  `brand`, `beats: list[Beat]`, `music`; the beat models `StageBeat`, `SendBeat`, `MarkBeat`,
  `MeterBeat`, `RaceBeat`, `RevealBeat`, `PanelBeat`; and `ExplainerDoc.beats_of(role)` returning
  the beats with that role in document order.

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_explainer_models.py
import pytest
from pydantic import ValidationError

from reels_api.models_explainer import ExplainerDoc

BRAND = {"handle": "@stackframe", "name": "Stack Frame"}


def doc(**over):
    body = {
        "template": "explainer",
        "theme": "kinetic",
        "brand": BRAND,
        "beats": [
            {"id": "b1", "role": "hook", "line": "Why is the second request faster?",
             "op": "panel", "data": {"title": "Cache", "lines": ["Two requests"]}},
            {"id": "b2", "role": "step", "line": "It asks the database",
             "op": "send", "data": {"from": "app", "to": "db", "label": "SELECT"}},
            {"id": "b3", "role": "payoff", "line": "200 ms becomes 2 ms",
             "op": "reveal", "data": {"text": "200 ms -> 2 ms"}},
        ],
    }
    body.update(over)
    return body


def test_a_minimal_document_validates():
    d = ExplainerDoc.model_validate(doc())
    assert d.fps == 30 and d.ratio == "9:16"
    assert [b.op for b in d.beats] == ["panel", "send", "reveal"]


def test_send_keeps_the_json_key_from():
    d = ExplainerDoc.model_validate(doc())
    assert d.beats[1].data.src == "app"


def test_an_unknown_op_is_rejected():
    body = doc()
    body["beats"][1]["op"] = "teleport"
    with pytest.raises(ValidationError):
        ExplainerDoc.model_validate(body)


def test_a_missing_required_key_names_the_beat_and_the_field():
    body = doc()
    del body["beats"][1]["data"]["label"]
    with pytest.raises(ValidationError) as e:
        ExplainerDoc.model_validate(body)
    loc = e.value.errors()[0]["loc"]
    assert "beats" in loc and 1 in loc and "label" in loc


def test_hook_and_payoff_are_required_and_ordered():
    body = doc()
    body["beats"] = [body["beats"][2], body["beats"][0]]
    with pytest.raises(ValidationError, match="order"):
        ExplainerDoc.model_validate(body)


def test_a_line_over_ninety_characters_is_rejected():
    body = doc()
    body["beats"][0]["line"] = "x" * 91
    with pytest.raises(ValidationError):
        ExplainerDoc.model_validate(body)


def test_more_than_twelve_steps_is_rejected():
    body = doc()
    step = body["beats"][1]
    body["beats"] = [body["beats"][0], *[{**step, "id": f"s{i}"} for i in range(13)], body["beats"][2]]
    with pytest.raises(ValidationError, match="steps"):
        ExplainerDoc.model_validate(body)


def test_beats_of_returns_document_order():
    d = ExplainerDoc.model_validate(doc())
    assert [b.id for b in d.beats_of("step")] == ["b2"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_models.py -v`
Expected: FAIL at import — `No module named 'reels_api.models_explainer'`.

- [ ] **Step 3: Write the model**

```python
# api/reels_api/models_explainer.py
"""The explainer category's document. Category-local: nothing here is shared with tools."""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import Brand, Music, Ratio, ThemeId

ROLE_ORDER = ("hook", "step", "payoff", "cta")
MAX_STEPS = 12
MAX_NODES = 6
MAX_LABEL = 28
MAX_LINE = 90

Label = Annotated[str, Field(min_length=1, max_length=MAX_LABEL)]


class Node(BaseModel):
    id: str = Field(min_length=1, max_length=24)
    label: Label


class StageData(BaseModel):
    nodes: list[Node] = Field(min_length=2, max_length=MAX_NODES)


class SendData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    # `from` is a Python keyword, so the field is `src` and the JSON key is the alias.
    src: str = Field(alias="from", min_length=1)
    to: str = Field(min_length=1)
    label: Label


class MarkData(BaseModel):
    node: str = Field(min_length=1)
    state: Literal["on", "dim", "dead"]


class MeterData(BaseModel):
    label: Label
    to: float
    unit: str = Field(default="ms", max_length=8)


class Lane(BaseModel):
    label: Label
    value: float
    unit: str = Field(default="ms", max_length=8)


class RaceData(BaseModel):
    lanes: list[Lane] = Field(min_length=2, max_length=2)


class RevealData(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_LINE)


class PanelData(BaseModel):
    title: Label
    lines: list[str] = Field(min_length=1, max_length=4)
    mono: bool = False


class _Beat(BaseModel):
    id: str = Field(min_length=1, max_length=24)
    role: Literal["hook", "step", "payoff", "cta"]
    line: str = Field(min_length=1, max_length=MAX_LINE)
    # Seconds default from the contract per role; a document may override one beat.
    sec: float | None = Field(default=None, gt=0, le=30)


class StageBeat(_Beat):
    op: Literal["stage"]
    data: StageData


class SendBeat(_Beat):
    op: Literal["send"]
    data: SendData


class MarkBeat(_Beat):
    op: Literal["mark"]
    data: MarkData


class MeterBeat(_Beat):
    op: Literal["meter"]
    data: MeterData


class RaceBeat(_Beat):
    op: Literal["race"]
    data: RaceData


class RevealBeat(_Beat):
    op: Literal["reveal"]
    data: RevealData


class PanelBeat(_Beat):
    op: Literal["panel"]
    data: PanelData


Beat = Annotated[
    Union[StageBeat, SendBeat, MarkBeat, MeterBeat, RaceBeat, RevealBeat, PanelBeat],
    Field(discriminator="op"),
]


class ExplainerDoc(BaseModel):
    template: Literal["explainer"]
    theme: ThemeId
    ratio: Ratio = "9:16"
    fps: Literal[24, 30, 60] = 30
    brand: Brand
    beats: list[Beat] = Field(min_length=2, max_length=16)
    music: Music = Field(default_factory=Music)

    @model_validator(mode="after")
    def _beat_rules(self):
        roles = [b.role for b in self.beats]
        if roles.count("hook") != 1:
            raise ValueError("exactly one hook beat is required")
        if roles.count("payoff") != 1:
            raise ValueError("exactly one payoff beat is required")
        if roles.count("cta") > 1:
            raise ValueError("at most one cta beat is allowed")
        if roles.count("step") > MAX_STEPS:
            raise ValueError(f"at most {MAX_STEPS} steps are allowed")
        rank = [ROLE_ORDER.index(r) for r in roles]
        if rank != sorted(rank):
            raise ValueError("beats must be in the order hook, steps, payoff, cta")
        ids = [b.id for b in self.beats]
        if len(set(ids)) != len(ids):
            raise ValueError("each beat id may appear once")
        return self

    def beats_of(self, role: str) -> list[Beat]:
        return [b for b in self.beats if b.role == role]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_models.py -v`
Expected: 8 passed.

- [ ] **Step 5: Run the whole suite**

Run: `cd api && .venv/Scripts/python -m pytest`
Expected: all pass. `models_explainer.py` imports from `models.py` but nothing imports it yet, so
the tools stack cannot have changed behaviour.

- [ ] **Step 6: Commit**

```bash
git add api/reels_api/models_explainer.py api/tests/test_explainer_models.py
git commit -m "feat(explainer): the document model and its seven op payloads

A discriminated union on op, so a malformed beat produces a 422 whose loc
names the beat index and the field rather than a blob. Role ordering,
step ceiling and unique ids are enforced on the document."
```

---

### Task 3: Explainer timing

Beats become frame-exact segments. Same rounding rule as tools, so Node and Python agree.

**Files:**
- Create: `api/reels_api/timing_explainer.py`
- Test: `api/tests/test_explainer_timing.py`

**Interfaces:**
- Consumes: `ExplainerDoc` from Task 2; `Segment` from `reels_api.timing`.
- Produces: `beat_secs(doc, defaults) -> list[float]`, `build_timeline(doc, defaults) -> list[Segment]`
  where `Segment.kind` is the beat's `op` and `Segment.index` is its position in `doc.beats`;
  `total_frames(doc, defaults) -> int`; `timeline_json(doc, segments) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_explainer_timing.py
from reels_api.models_explainer import ExplainerDoc
from reels_api.timing_explainer import DEFAULTS, beat_secs, build_timeline, timeline_json, total_frames

BRAND = {"handle": "@stackframe", "name": "Stack Frame"}


def doc(beats=None, **over):
    body = {
        "template": "explainer", "theme": "kinetic", "brand": BRAND,
        "beats": beats or [
            {"id": "b1", "role": "hook", "line": "Hook", "op": "panel",
             "data": {"title": "Cache", "lines": ["Two requests"]}},
            {"id": "b2", "role": "step", "line": "Step", "op": "send",
             "data": {"from": "app", "to": "db", "label": "SELECT"}},
            {"id": "b3", "role": "payoff", "line": "Payoff", "op": "reveal",
             "data": {"text": "200 ms -> 2 ms"}},
        ],
    }
    body.update(over)
    return ExplainerDoc.model_validate(body)


def test_seconds_come_from_the_contract_defaults_per_role():
    assert beat_secs(doc(), DEFAULTS) == [3, 2, 4]


def test_a_beat_may_override_its_own_seconds():
    d = doc()
    d.beats[1].sec = 5.5
    assert beat_secs(d, DEFAULTS) == [3, 5.5, 4]


def test_segments_are_frame_exact_and_contiguous():
    segs = build_timeline(doc(), DEFAULTS)
    assert [s.duration_frames for s in segs] == [90, 60, 120]
    assert [s.start_frame for s in segs] == [0, 90, 150]
    assert segs[-1].end_sec == 270 / 30


def test_segment_kind_is_the_op_and_index_is_the_beat_position():
    segs = build_timeline(doc(), DEFAULTS)
    assert [(s.kind, s.index) for s in segs] == [("panel", 0), ("send", 1), ("reveal", 2)]


def test_half_frames_round_up_like_the_renderer():
    d = doc()
    d.beats[0].sec = 0.05  # 1.5 frames at 30fps
    assert build_timeline(d, DEFAULTS)[0].duration_frames == 2


def test_total_frames_is_the_sum():
    assert total_frames(doc(), DEFAULTS) == 270


def test_timeline_json_carries_beat_ids_and_total():
    tl = timeline_json(doc(), build_timeline(doc(), DEFAULTS))
    assert tl["template"] == "explainer"
    assert tl["totalFrames"] == 270
    assert [s["id"] for s in tl["segments"]] == ["b1", "b2", "b3"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_timing.py -v`
Expected: FAIL at import — `No module named 'reels_api.timing_explainer'`.

- [ ] **Step 3: Write the timing module**

```python
# api/reels_api/timing_explainer.py
"""Explainer timing. Frames are the truth; seconds derive from them, so Node and Python agree."""
from __future__ import annotations

import math

from .models_explainer import ExplainerDoc
from .timing import Segment

# The contract's defaults, per beat role, in seconds.
DEFAULTS: dict[str, float] = {"hook": 3, "step": 2, "payoff": 4, "cta": 3}


def beat_secs(doc: ExplainerDoc, defaults: dict[str, float]) -> list[float]:
    """A beat's own seconds when it sets them, otherwise the default for its role."""
    return [b.sec if b.sec is not None else defaults[b.role] for b in doc.beats]


def build_timeline(doc: ExplainerDoc, defaults: dict[str, float]) -> list[Segment]:
    fps = doc.fps
    cursor = 0
    out: list[Segment] = []
    for i, (beat, sec) in enumerate(zip(doc.beats, beat_secs(doc, defaults))):
        # half rounds up, like Math.round in render/src/timing.ts
        frames = max(1, math.floor(sec * fps + 0.5))
        out.append(Segment(beat.op, i, cursor, frames, cursor / fps, (cursor + frames) / fps))
        cursor += frames
    return out


def total_frames(doc: ExplainerDoc, defaults: dict[str, float]) -> int:
    return sum(s.duration_frames for s in build_timeline(doc, defaults))


def timeline_json(doc: ExplainerDoc, segments: list[Segment]) -> dict:
    """The handoff file, one entry per beat. Beat ids travel so a caller can map back to its script."""
    return {
        "template": "explainer",
        "theme": doc.theme,
        "fps": doc.fps,
        "totalFrames": sum(s.duration_frames for s in segments),
        "segments": [
            {
                "id": doc.beats[s.index].id,
                "role": doc.beats[s.index].role,
                "op": s.kind,
                "index": s.index,
                "startFrame": s.start_frame,
                "durationFrames": s.duration_frames,
                "startSec": s.start_sec,
                "endSec": s.end_sec,
            }
            for s in segments
        ],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_timing.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add api/reels_api/timing_explainer.py api/tests/test_explainer_timing.py
git commit -m "feat(explainer): frame-exact timing from beat roles

Seconds come from the contract defaults per role unless a beat overrides
its own. Same half-rounds-up rule as tools so Node and Python agree on
every frame boundary."
```

---

### Task 4: Explainer props

The document becomes the props the Remotion composition receives. Category-local; `props.py` is
not touched.

**Files:**
- Create: `api/reels_api/props_explainer.py`
- Test: `api/tests/test_explainer_props.py`

**Interfaces:**
- Consumes: `ExplainerDoc` (Task 2), `DEFAULTS` and `build_timeline` (Task 3).
- Produces: `build_props(doc, defaults=DEFAULTS) -> dict` with keys `template`, `theme`, `fps`,
  `width`, `height`, `brand`, `totalFrames`, `beats` — each beat carrying `id`, `role`, `line`,
  `op`, `data`, `startFrame`, `durationFrames`.

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_explainer_props.py
from reels_api.models_explainer import ExplainerDoc
from reels_api.props_explainer import build_props

BRAND = {"handle": "@stackframe", "name": "Stack Frame"}
BEATS = [
    {"id": "b1", "role": "hook", "line": "Hook", "op": "panel",
     "data": {"title": "Cache", "lines": ["Two requests"]}},
    {"id": "b2", "role": "step", "line": "Step", "op": "send",
     "data": {"from": "app", "to": "db", "label": "SELECT"}},
    {"id": "b3", "role": "payoff", "line": "Payoff", "op": "reveal",
     "data": {"text": "200 ms -> 2 ms"}},
]


def doc(**over):
    body = {"template": "explainer", "theme": "kinetic", "brand": BRAND, "beats": BEATS}
    body.update(over)
    return ExplainerDoc.model_validate(body)


def test_props_carry_the_ratio_as_pixels():
    p = build_props(doc())
    assert (p["width"], p["height"]) == (1080, 1920)


def test_props_carry_frame_positions_per_beat():
    beats = build_props(doc())["beats"]
    assert [(b["startFrame"], b["durationFrames"]) for b in beats] == [(0, 90), (90, 60), (150, 120)]
    assert build_props(doc())["totalFrames"] == 270


def test_send_data_reaches_the_renderer_under_its_json_key():
    beats = build_props(doc())["beats"]
    assert beats[1]["data"]["from"] == "app"
    assert "src" not in beats[1]["data"]


def test_theme_and_brand_travel_unchanged():
    p = build_props(doc(theme="glass-bento"))
    assert p["theme"] == "glass-bento"
    assert p["brand"] == BRAND
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_props.py -v`
Expected: FAIL at import — `No module named 'reels_api.props_explainer'`.

- [ ] **Step 3: Write the props builder**

```python
# api/reels_api/props_explainer.py
"""Document to Remotion props for the explainer category."""
from __future__ import annotations

from .models_explainer import ExplainerDoc
from .timing_explainer import DEFAULTS, build_timeline

RATIOS: dict[str, tuple[int, int]] = {"9:16": (1080, 1920), "4:5": (1080, 1350), "1:1": (1080, 1080)}


def build_props(doc: ExplainerDoc, defaults: dict[str, float] | None = None) -> dict:
    defaults = defaults or DEFAULTS
    segs = build_timeline(doc, defaults)
    width, height = RATIOS[doc.ratio]
    return {
        "template": "explainer",
        "theme": doc.theme,
        "fps": doc.fps,
        "width": width,
        "height": height,
        "brand": doc.brand.model_dump(),
        "totalFrames": sum(s.duration_frames for s in segs),
        "beats": [
            {
                "id": b.id,
                "role": b.role,
                "line": b.line,
                "op": b.op,
                # by_alias so `from` reaches the renderer under its JSON key, not `src`
                "data": b.data.model_dump(by_alias=True),
                "startFrame": s.start_frame,
                "durationFrames": s.duration_frames,
            }
            for b, s in zip(doc.beats, segs)
        ],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_props.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add api/reels_api/props_explainer.py api/tests/test_explainer_props.py
git commit -m "feat(explainer): document to Remotion props

Beats carry their frame positions so the composition never recomputes
timing, and data is dumped by alias so `from` survives the trip."
```

---

### Task 5: The category registry and the discriminated document

The first of the two dispatch points. After this task an explainer document can reach
`POST /validate` and `POST /jobs`. The pre-existing tools tests are the proof nothing else moved.

**Files:**
- Create: `api/reels_api/categories.py`
- Modify: `api/reels_api/models.py` (add the union next to `ReelDoc`; do not change `ReelDoc`)
- Modify: `api/reels_api/routes/jobs.py:44` (`create_job` signature)
- Modify: `api/reels_api/routes/templates.py:28` (`validate` body and dispatch)
- Modify: `api/reels_api/jobs.py:45,55` (`create` and `input_doc` accept the union)
- Test: `api/tests/test_categories.py`

**Interfaces:**
- Consumes: `ReelDoc` from `models`, `ExplainerDoc` from `models_explainer`, the explainer
  `build_timeline`/`timeline_json` from Task 3.
- Produces: `AnyDoc` (the annotated union), `DOC_ADAPTER: TypeAdapter[AnyDoc]`, and
  `timeline_for(doc) -> dict` dispatching on `doc.template`.

- [ ] **Step 1: Write the failing test**

```python
# api/tests/test_categories.py
import pytest

from reels_api.categories import DOC_ADAPTER, timeline_for

BRAND = {"handle": "@stackframe", "name": "Stack Frame"}
EXPLAINER = {
    "template": "explainer", "theme": "kinetic", "brand": BRAND,
    "beats": [
        {"id": "b1", "role": "hook", "line": "Hook", "op": "panel",
         "data": {"title": "Cache", "lines": ["Two requests"]}},
        {"id": "b2", "role": "payoff", "line": "Payoff", "op": "reveal",
         "data": {"text": "200 ms -> 2 ms"}},
    ],
}


def test_the_union_picks_the_model_from_the_template_field():
    assert type(DOC_ADAPTER.validate_python(EXPLAINER)).__name__ == "ExplainerDoc"


def test_an_unknown_category_is_rejected_by_the_discriminator():
    with pytest.raises(Exception):
        DOC_ADAPTER.validate_python({**EXPLAINER, "template": "nope"})


def test_timeline_for_dispatches_on_the_category():
    tl = timeline_for(DOC_ADAPTER.validate_python(EXPLAINER))
    assert tl["template"] == "explainer"
    assert [s["id"] for s in tl["segments"]] == ["b1", "b2"]


def test_validate_accepts_an_explainer_document(client):
    r = client.post("/validate", json=EXPLAINER)
    assert r.status_code == 200, r.text
    assert r.json()["template"] == "explainer"


def test_validate_reports_a_bad_beat_with_a_usable_loc(client):
    bad = {**EXPLAINER, "beats": [EXPLAINER["beats"][0],
                                  {"id": "b2", "role": "payoff", "line": "x", "op": "reveal", "data": {}}]}
    r = client.post("/validate", json=bad)
    assert r.status_code == 422
    assert any("text" in str(d["loc"]) for d in r.json()["detail"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_categories.py -v`
Expected: FAIL at import — `No module named 'reels_api.categories'`.

- [ ] **Step 3: Write the registry**

```python
# api/reels_api/categories.py
"""The category registry: the one place that knows more than one category exists.

Categories do not mix. Each brings its own document model and its own timeline; this module
only chooses between them on the document's `template` field.
"""
from __future__ import annotations

from typing import Annotated, Union

from pydantic import Field, TypeAdapter

from .models import ReelDoc
from .models_explainer import ExplainerDoc
from . import timing as tools_timing
from . import timing_explainer
from .fit import resolve as tools_fit_resolve

AnyDoc = Annotated[Union[ReelDoc, ExplainerDoc], Field(discriminator="template")]
DOC_ADAPTER: TypeAdapter = TypeAdapter(AnyDoc)


def timeline_for(doc) -> dict:
    """The timeline a job would get, for whichever category the document belongs to."""
    if doc.template == "explainer":
        segs = timing_explainer.build_timeline(doc, timing_explainer.DEFAULTS)
        return timing_explainer.timeline_json(doc, segs)
    fit = tools_fit_resolve(doc, doc.vo.words if doc.vo else None, None)
    segs = tools_timing.build_timeline(doc, fit.secs)
    return tools_timing.timeline_json(
        doc, segs, {}, [f"pages/{i}.mp4" for i in range(len(doc.pages))],
        "assets/vo" if doc.vo else None, fit.cues, fit.voiced,
    )
```

- [ ] **Step 4: Move the two dispatch points**

In `api/reels_api/routes/templates.py`, replace the `validate` endpoint and drop the now-unused
tools-only imports:

```python
from ..categories import AnyDoc, timeline_for


@router.post("/validate")
def validate(doc: AnyDoc):
    """The timeline a job would get. A voiced tools document is cut to its words here too; the
    voice file is not fetched, so its end is the last word plus a pad rather than the probed length."""
    return timeline_for(doc)
```

In `api/reels_api/routes/jobs.py`, change only the signature:

```python
from ..categories import AnyDoc

@router.post("/jobs", status_code=202)
def create_job(doc: AnyDoc, request: Request):
```

In `api/reels_api/jobs.py`, widen the two annotations so a stored explainer document reloads as
one:

```python
from .categories import DOC_ADAPTER

    def create(self, doc) -> str:          # was doc: ReelDoc
        ...

    def input_doc(self, jid: str):         # was -> ReelDoc
        return DOC_ADAPTER.validate_json((self.path(jid) / "input.json").read_text(encoding="utf-8"))
```

`jobs.py` no longer needs `from .models import ReelDoc`; remove that import only if nothing else
in the file uses it.

- [ ] **Step 5: Run the new tests**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_categories.py -v`
Expected: 5 passed.

- [ ] **Step 6: Run the whole suite — the tools regression gate**

Run: `cd api && .venv/Scripts/python -m pytest`
Expected: every pre-existing test passes, unedited. If any pre-existing test fails or seems to
need editing, STOP: the dispatch change was not minimal. Report what failed rather than changing
the test.

- [ ] **Step 7: Commit**

```bash
git add api/reels_api/categories.py api/reels_api/models.py api/reels_api/jobs.py \
        api/reels_api/routes/jobs.py api/reels_api/routes/templates.py api/tests/test_categories.py
git commit -m "feat: dispatch documents on their category

Literal[\"tools\"] admitted exactly one category by type, so a second one
could not be accepted at all. The routes now take a discriminated union
and the registry chooses the model and the timeline. Categories still do
not mix: this is the only module that knows both exist.

The tools suite runs unedited and green."
```

---

### Task 6: Props schema, theme contract, and the two static ops

Pixels begin. `panel` and `reveal` draw no motion between elements, so they prove the wiring with
the least surface. The five moving ops follow in Task 7.

**Files:**
- Create: `render/src/templates/explainer/schema.ts`
- Create: `render/src/templates/explainer/types.ts`
- Create: `render/src/templates/explainer/ops/Panel.tsx`
- Create: `render/src/templates/explainer/ops/Reveal.tsx`
- Create: `render/src/templates/explainer/themes/kinetic/tokens.ts`
- Test: `render/src/templates/explainer/schema.test.ts`

**Interfaces:**
- Consumes: the props shape `props_explainer.build_props` produces (Task 4).
- Produces: `ExplainerPropsSchema`, `ExplainerProps`, `Beat`, `BeatOf<K>`, `ExplainerThemeId`,
  `EXPLAINER_THEME_IDS` from `schema.ts`; `ExplainerTokens`, `OpProps<K>`, `ExplainerTheme` from
  `types.ts`; the components `Panel` and `Reveal`.

- [ ] **Step 1: Write the failing test**

```ts
// render/src/templates/explainer/schema.test.ts
import { describe, expect, it } from 'vitest';
import { ExplainerPropsSchema } from './schema';

const props = {
  template: 'explainer', theme: 'kinetic', fps: 30, width: 1080, height: 1920,
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  totalFrames: 270,
  beats: [
    { id: 'b1', role: 'hook', line: 'Hook', op: 'panel',
      data: { title: 'Cache', lines: ['Two requests'], mono: false }, startFrame: 0, durationFrames: 90 },
    { id: 'b2', role: 'step', line: 'Step', op: 'send',
      data: { from: 'app', to: 'db', label: 'SELECT' }, startFrame: 90, durationFrames: 60 },
  ],
};

describe('explainer props schema', () => {
  it('accepts what the API builds', () => {
    expect(ExplainerPropsSchema.parse(props).beats).toHaveLength(2);
  });

  it('discriminates beat data on op', () => {
    const beat = ExplainerPropsSchema.parse(props).beats[1];
    if (beat.op !== 'send') throw new Error('expected a send beat');
    expect(beat.data.from).toBe('app');
  });

  it('rejects a beat whose data does not match its op', () => {
    const bad = { ...props, beats: [{ ...props.beats[1], data: { title: 'x', lines: ['y'] } }] };
    expect(() => ExplainerPropsSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd render && npx vitest run src/templates/explainer/schema.test.ts`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write the schema**

```ts
// render/src/templates/explainer/schema.ts
import { z } from 'zod';

export const EXPLAINER_OPS = ['stage', 'send', 'mark', 'meter', 'race', 'reveal', 'panel'] as const;

/** Category-local, so explainer never imports a type from the tools stack. */
export const EXPLAINER_THEME_IDS = ['glass-bento', 'kinetic', 'dashboard-bento', 'sticker-board'] as const;

const node = z.object({ id: z.string(), label: z.string() });
const lane = z.object({ label: z.string(), value: z.number(), unit: z.string() });

const base = {
  id: z.string(),
  role: z.enum(['hook', 'step', 'payoff', 'cta']),
  line: z.string(),
  startFrame: z.number().int().min(0),
  durationFrames: z.number().int().min(1),
};

export const BeatSchema = z.discriminatedUnion('op', [
  z.object({ ...base, op: z.literal('stage'), data: z.object({ nodes: z.array(node).min(2).max(6) }) }),
  z.object({ ...base, op: z.literal('send'), data: z.object({ from: z.string(), to: z.string(), label: z.string() }) }),
  z.object({ ...base, op: z.literal('mark'), data: z.object({ node: z.string(), state: z.enum(['on', 'dim', 'dead']) }) }),
  z.object({ ...base, op: z.literal('meter'), data: z.object({ label: z.string(), to: z.number(), unit: z.string() }) }),
  z.object({ ...base, op: z.literal('race'), data: z.object({ lanes: z.array(lane).length(2) }) }),
  z.object({ ...base, op: z.literal('reveal'), data: z.object({ text: z.string() }) }),
  z.object({ ...base, op: z.literal('panel'), data: z.object({ title: z.string(), lines: z.array(z.string()).min(1).max(4), mono: z.boolean().default(false) }) }),
]);

export const ExplainerPropsSchema = z.object({
  template: z.literal('explainer'),
  theme: z.enum(EXPLAINER_THEME_IDS),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  brand: z.object({ handle: z.string(), name: z.string() }),
  totalFrames: z.number().int().min(1),
  beats: z.array(BeatSchema).min(1),
});

export type ExplainerProps = z.infer<typeof ExplainerPropsSchema>;
export type ExplainerThemeId = (typeof EXPLAINER_THEME_IDS)[number];
export type Beat = z.infer<typeof BeatSchema>;
export type BeatOf<K extends Beat['op']> = Extract<Beat, { op: K }>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd render && npx vitest run src/templates/explainer/schema.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Write the theme contract and the kinetic tokens**

```ts
// render/src/templates/explainer/types.ts
import type React from 'react';
import type { Beat, BeatOf } from './schema';

/**
 * Category-local, and deliberately NOT the tools `ThemeComponents`: categories do not mix.
 * A theme owns its palette and may override any op; in v1 every theme shares the op components
 * and differs only by tokens.
 */
export type ExplainerTokens = {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  accentFg: string;
  danger: string;
  font: string;
  mono: string;
};

export type OpProps<K extends Beat['op']> = {
  beat: BeatOf<K>;
  tokens: ExplainerTokens;
  /** Frames since THIS beat started, not since the reel started. */
  frame: number;
  durationInFrames: number;
};

export type ExplainerTheme = {
  tokens: ExplainerTokens;
  Background?: React.FC<{ tokens: ExplainerTokens }>;
  Stage: React.FC<OpProps<'stage'>>;
  Send: React.FC<OpProps<'send'>>;
  Mark: React.FC<OpProps<'mark'>>;
  Meter: React.FC<OpProps<'meter'>>;
  Race: React.FC<OpProps<'race'>>;
  Reveal: React.FC<OpProps<'reveal'>>;
  Panel: React.FC<OpProps<'panel'>>;
};
```

```ts
// render/src/templates/explainer/themes/kinetic/tokens.ts
import type { ExplainerTokens } from '../../types';

export const tokens: ExplainerTokens = {
  bg: '#0B0B0F',
  fg: '#F5F5F7',
  muted: '#8A8A94',
  accent: '#FF4D2E',
  accentFg: '#FFFFFF',
  danger: '#FF3B30',
  font: 'Inter, system-ui, sans-serif',
  mono: 'JetBrains Mono, ui-monospace, monospace',
};
```

- [ ] **Step 6: Write the two static ops**

```tsx
// render/src/templates/explainer/ops/Panel.tsx
import React from 'react';
import { interpolate } from 'remotion';
import type { OpProps } from '../types';

export const Panel: React.FC<OpProps<'panel'>> = ({ beat, tokens, frame }) => {
  const enter = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const { title, lines, mono } = beat.data;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 96, gap: 28 }}>
      <div style={{ color: tokens.accent, fontSize: 40, fontWeight: 700, letterSpacing: -0.5, opacity: enter, transform: `translateY(${(1 - enter) * 20}px)` }}>
        {title}
      </div>
      {lines.map((line, i) => {
        const t = interpolate(frame, [6 + i * 5, 20 + i * 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <div key={i} style={{ color: tokens.fg, fontSize: 52, lineHeight: 1.25, fontFamily: mono ? tokens.mono : tokens.font, opacity: t, transform: `translateY(${(1 - t) * 16}px)` }}>
            {line}
          </div>
        );
      })}
    </div>
  );
};
```

```tsx
// render/src/templates/explainer/ops/Reveal.tsx
import React from 'react';
import { interpolate } from 'remotion';
import type { OpProps } from '../types';

export const Reveal: React.FC<OpProps<'reveal'>> = ({ beat, tokens, frame }) => {
  const t = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
      <div style={{ color: tokens.fg, fontSize: 92, fontWeight: 800, textAlign: 'center', lineHeight: 1.1, opacity: t, transform: `scale(${0.92 + 0.08 * t})` }}>
        {beat.data.text}
      </div>
    </div>
  );
};
```

- [ ] **Step 7: Typecheck**

Run: `cd render && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add render/src/templates/explainer
git commit -m "feat(explainer): props schema, theme contract, panel and reveal

Its own zod schema and its own theme type - not the tools
ThemeComponents, because categories do not mix. Theme ids are redeclared
locally so explainer imports nothing from the tools stack."
```

---

### Task 7: The five moving ops and the composition

**Files:**
- Create: `render/src/templates/explainer/ops/Meter.tsx`
- Create: `render/src/templates/explainer/ops/Mark.tsx`
- Create: `render/src/templates/explainer/ops/Stage.tsx`
- Create: `render/src/templates/explainer/ops/Send.tsx`
- Create: `render/src/templates/explainer/ops/Race.tsx`
- Create: `render/src/templates/explainer/themes/kinetic/index.ts`
- Create: `render/src/templates/explainer/themes/index.ts`
- Create: `render/src/templates/explainer/index.tsx`

**Interfaces:**
- Consumes: `OpProps`, `ExplainerTheme`, `ExplainerTokens` (Task 6).
- Produces: `EXPLAINER_THEMES: Record<ExplainerThemeId, ExplainerTheme>` from `themes/index.ts`,
  and `ExplainerReel: React.FC<ExplainerProps>` from `index.tsx`.

Each beat is its own `Sequence`, so an op sees only its own data. `send` and `mark` therefore draw
the nodes they name rather than reading a stage laid out by an earlier beat. Continuity across
beats is not modelled in v1 — that is the first thing to judge by eye once this renders.

- [ ] **Step 1: Write Meter and Mark**

```tsx
// render/src/templates/explainer/ops/Meter.tsx
import React from 'react';
import { interpolate } from 'remotion';
import type { OpProps } from '../types';

export const Meter: React.FC<OpProps<'meter'>> = ({ beat, tokens, frame, durationInFrames }) => {
  const settle = Math.max(1, durationInFrames - 10);
  const t = interpolate(frame, [0, settle], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const value = beat.data.to * t;
  const shown = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
      <div style={{ color: tokens.muted, fontSize: 38, fontWeight: 600 }}>{beat.data.label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ color: tokens.accent, fontSize: 150, fontWeight: 800, fontFamily: tokens.mono, lineHeight: 1 }}>{shown}</div>
        <div style={{ color: tokens.fg, fontSize: 54, fontWeight: 700 }}>{beat.data.unit}</div>
      </div>
    </div>
  );
};
```

```tsx
// render/src/templates/explainer/ops/Mark.tsx
import React from 'react';
import { interpolate } from 'remotion';
import type { ExplainerTokens, OpProps } from '../types';

const colorFor = (state: 'on' | 'dim' | 'dead', tokens: ExplainerTokens) =>
  state === 'on' ? tokens.accent : state === 'dead' ? tokens.danger : tokens.muted;

export const Mark: React.FC<OpProps<'mark'>> = ({ beat, tokens, frame }) => {
  const { node, state } = beat.data;
  const color = colorFor(state, tokens);
  const pulse = state === 'on' ? interpolate(frame % 30, [0, 15, 30], [1, 1.05, 1]) : 1;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          padding: '34px 64px', borderRadius: 28, border: `4px solid ${color}`,
          color: state === 'dim' ? tokens.muted : tokens.fg,
          background: state === 'on' ? `${color}22` : 'transparent',
          fontSize: 64, fontWeight: 700, transform: `scale(${pulse})`,
          textDecoration: state === 'dead' ? 'line-through' : 'none',
          opacity: state === 'dim' ? 0.55 : 1,
        }}
      >
        {node}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Write Stage, Send and Race**

```tsx
// render/src/templates/explainer/ops/Stage.tsx
import React from 'react';
import { interpolate } from 'remotion';
import type { OpProps } from '../types';

export const Stage: React.FC<OpProps<'stage'>> = ({ beat, tokens, frame }) => (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26, padding: 72 }}>
    {beat.data.nodes.map((node, i) => {
      const t = interpolate(frame, [i * 6, i * 6 + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      return (
        <div
          key={node.id}
          style={{
            width: '100%', padding: '30px 40px', borderRadius: 24,
            border: `3px solid ${tokens.muted}`, color: tokens.fg,
            fontSize: 52, fontWeight: 700, textAlign: 'center',
            opacity: t, transform: `translateY(${(1 - t) * 28}px)`,
          }}
        >
          {node.label}
        </div>
      );
    })}
  </div>
);
```

```tsx
// render/src/templates/explainer/ops/Send.tsx
import React from 'react';
import { interpolate } from 'remotion';
import type { ExplainerTokens, OpProps } from '../types';

const box = (tokens: ExplainerTokens) => ({
  padding: '28px 44px', borderRadius: 22, border: `3px solid ${tokens.muted}`,
  color: tokens.fg, fontSize: 48, fontWeight: 700,
});

export const Send: React.FC<OpProps<'send'>> = ({ beat, tokens, frame, durationInFrames }) => {
  const travel = interpolate(frame, [8, Math.max(12, durationInFrames - 8)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40 }}>
      <div style={box(tokens)}>{beat.data.from}</div>
      <div style={{ position: 'relative', height: 220, width: 8, background: `${tokens.muted}55`, borderRadius: 4 }}>
        <div style={{ position: 'absolute', left: -16, top: `${travel * 100}%`, width: 40, height: 40, marginTop: -20, borderRadius: 20, background: tokens.accent }} />
        <div style={{ position: 'absolute', left: 42, top: `${travel * 100}%`, marginTop: -18, whiteSpace: 'nowrap', color: tokens.accent, fontSize: 34, fontWeight: 700, fontFamily: tokens.mono }}>
          {beat.data.label}
        </div>
      </div>
      <div style={box(tokens)}>{beat.data.to}</div>
    </div>
  );
};
```

```tsx
// render/src/templates/explainer/ops/Race.tsx
import React from 'react';
import { interpolate } from 'remotion';
import type { OpProps } from '../types';

export const Race: React.FC<OpProps<'race'>> = ({ beat, tokens, frame, durationInFrames }) => {
  const lanes = beat.data.lanes;
  const worst = Math.max(...lanes.map((l) => l.value)) || 1;
  const best = Math.min(...lanes.map((l) => l.value));
  const grow = interpolate(frame, [6, Math.max(10, durationInFrames - 10)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 56, padding: 80 }}>
      {lanes.map((lane, i) => {
        const winner = lane.value === best;
        const width = (lane.value / worst) * grow * 100;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ color: tokens.fg, fontSize: 44, fontWeight: 700 }}>{lane.label}</span>
              <span style={{ color: winner ? tokens.accent : tokens.muted, fontSize: 52, fontWeight: 800, fontFamily: tokens.mono }}>
                {Math.round(lane.value * grow)}{lane.unit}
              </span>
            </div>
            <div style={{ height: 34, borderRadius: 17, background: `${tokens.muted}33`, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${width}%`, background: winner ? tokens.accent : tokens.muted, borderRadius: 17 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 3: Assemble the theme and the registry**

```ts
// render/src/templates/explainer/themes/kinetic/index.ts
import type { ExplainerTheme } from '../../types';
import { Mark } from '../../ops/Mark';
import { Meter } from '../../ops/Meter';
import { Panel } from '../../ops/Panel';
import { Race } from '../../ops/Race';
import { Reveal } from '../../ops/Reveal';
import { Send } from '../../ops/Send';
import { Stage } from '../../ops/Stage';
import { tokens } from './tokens';

export const kinetic: ExplainerTheme = { tokens, Stage, Send, Mark, Meter, Race, Reveal, Panel };
```

```ts
// render/src/templates/explainer/themes/index.ts
import type { ExplainerThemeId } from '../schema';
import type { ExplainerTheme, ExplainerTokens } from '../types';
import { kinetic } from './kinetic';

/**
 * v1: every theme shares the op components and differs only by tokens. A theme may override any
 * op later by supplying its own component here.
 */
const withTokens = (base: ExplainerTheme, tokens: ExplainerTokens): ExplainerTheme => ({ ...base, tokens });

export const EXPLAINER_THEMES: Record<ExplainerThemeId, ExplainerTheme> = {
  kinetic,
  'glass-bento': withTokens(kinetic, { ...kinetic.tokens, bg: '#0E1116', accent: '#5AC8FA' }),
  'dashboard-bento': withTokens(kinetic, { ...kinetic.tokens, bg: '#101418', accent: '#34C759', muted: '#7A8290' }),
  'sticker-board': withTokens(kinetic, { ...kinetic.tokens, bg: '#FFF8E7', fg: '#15151A', muted: '#8A7F66', accent: '#FF375F' }),
};
```

- [ ] **Step 4: Write the composition**

```tsx
// render/src/templates/explainer/index.tsx
import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import type { Beat, ExplainerProps } from './schema';
import type { ExplainerTheme, ExplainerTokens } from './types';
import { EXPLAINER_THEMES } from './themes';

type AnyOp = React.FC<{ beat: Beat; tokens: ExplainerTokens; frame: number; durationInFrames: number }>;

const pick = (theme: ExplainerTheme, op: Beat['op']): AnyOp =>
  ({
    stage: theme.Stage, send: theme.Send, mark: theme.Mark, meter: theme.Meter,
    race: theme.Race, reveal: theme.Reveal, panel: theme.Panel,
  }[op]) as AnyOp;

export const ExplainerReel: React.FC<ExplainerProps> = ({ theme, beats }) => {
  const t = EXPLAINER_THEMES[theme];
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: t.tokens.bg, fontFamily: t.tokens.font }}>
      {t.Background ? <t.Background tokens={t.tokens} /> : null}
      {beats.map((beat) => {
        const Op = pick(t, beat.op);
        return (
          <Sequence key={beat.id} from={beat.startFrame} durationInFrames={beat.durationFrames}>
            <Op beat={beat} tokens={t.tokens} frame={frame - beat.startFrame} durationInFrames={beat.durationFrames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 5: Typecheck and build**

Run: `cd render && npx tsc --noEmit`
Expected: no errors.

Run: `cd render && npm run build:preview`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add render/src/templates/explainer
git commit -m "feat(explainer): the five moving ops and the composition

Each beat is its own Sequence, so send and mark draw the nodes they name
rather than reading a stage an earlier beat laid out. Continuity across
beats is not modelled yet; that is the first thing to judge on screen."
```

---

### Task 8: Root registry, samples, and preview

The second dispatch point, plus a sample per theme so `GET /preview/explainer/{theme}` serves.

**Files:**
- Create: `render/src/templates/explainer/doc.ts`
- Create: `render/src/templates/explainer/doc.test.ts`
- Create: `templates/explainer/samples/glass-bento.json`
- Create: `templates/explainer/samples/kinetic.json`
- Create: `templates/explainer/samples/dashboard-bento.json`
- Create: `templates/explainer/samples/sticker-board.json`
- Modify: `render/src/Root.tsx`
- Modify: `api/reels_api/routes/preview.py`
- Test: `api/tests/test_explainer_preview.py`

**Interfaces:**
- Consumes: `ExplainerReel`, `ExplainerPropsSchema`, `EXPLAINER_THEME_IDS` (Tasks 6-7),
  `DOC_ADAPTER` (Task 5), `props_explainer.build_props` (Task 4).
- Produces: `sampleDocToProps(doc: unknown): ExplainerProps` from `doc.ts`; compositions registered
  as `explainer-${theme}`.

- [ ] **Step 1: Write the failing tests**

```python
# api/tests/test_explainer_preview.py
THEMES = ["glass-bento", "kinetic", "dashboard-bento", "sticker-board"]


def test_every_theme_ships_a_sample(client):
    samples = next(t for t in client.get("/templates").json()["templates"] if t["name"] == "explainer")["samples"]
    assert sorted(samples) == sorted(THEMES)


def test_preview_props_are_built_for_each_theme(client):
    for theme in THEMES:
        r = client.get(f"/preview-props/explainer/{theme}")
        assert r.status_code == 200, (theme, r.text)
        body = r.json()
        assert body["template"] == "explainer" and body["theme"] == theme
        assert body["beats"][0]["startFrame"] == 0


def test_an_unknown_theme_is_a_404(client):
    assert client.get("/preview-props/explainer/neon").status_code == 404


def test_tools_preview_still_works(client):
    assert client.get("/preview-props/tools/kinetic").status_code == 200
```

```ts
// render/src/templates/explainer/doc.test.ts
import { describe, expect, it } from 'vitest';
import sample from '../../../../templates/explainer/samples/kinetic.json';
import { sampleDocToProps } from './doc';

describe('sampleDocToProps', () => {
  it('lays beats out contiguously from the role defaults', () => {
    const props = sampleDocToProps(sample);
    let cursor = 0;
    for (const beat of props.beats) {
      expect(beat.startFrame).toBe(cursor);
      cursor += beat.durationFrames;
    }
    expect(props.totalFrames).toBe(cursor);
  });

  it('gives the hook three seconds at thirty fps', () => {
    expect(sampleDocToProps(sample).beats[0].durationFrames).toBe(90);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_preview.py -v`
Expected: FAIL — `samples` is `{}` and `_sample_props` validates through `ReelDoc`.

Run: `cd render && npx vitest run src/templates/explainer/doc.test.ts`
Expected: FAIL — cannot resolve `./doc`.

- [ ] **Step 3: Write one sample per theme**

`templates/explainer/samples/kinetic.json`, exercising six of the seven ops:

```json
{
  "template": "explainer",
  "theme": "kinetic",
  "brand": { "handle": "@stackframe", "name": "Stack Frame" },
  "beats": [
    { "id": "b1", "role": "hook", "line": "Why is the second request 100x faster?",
      "op": "race", "data": { "lanes": [
        { "label": "No cache", "value": 200, "unit": "ms" },
        { "label": "Cached", "value": 2, "unit": "ms" } ] } },
    { "id": "b2", "role": "step", "line": "Three parts, one path",
      "op": "stage", "data": { "nodes": [
        { "id": "app", "label": "App" },
        { "id": "cache", "label": "Cache" },
        { "id": "db", "label": "Database" } ] } },
    { "id": "b3", "role": "step", "line": "The first request misses",
      "op": "send", "data": { "from": "App", "to": "Database", "label": "MISS" } },
    { "id": "b4", "role": "step", "line": "The answer is stored on the way back",
      "op": "mark", "data": { "node": "Cache", "state": "on" } },
    { "id": "b5", "role": "step", "line": "The second never reaches the database",
      "op": "meter", "data": { "label": "Round trip", "to": 2, "unit": "ms" } },
    { "id": "b6", "role": "payoff", "line": "The database is touched once",
      "op": "reveal", "data": { "text": "200 ms -> 2 ms" } }
  ]
}
```

Copy to the other three filenames, changing only the `theme` value so it matches the filename.

- [ ] **Step 4: Write doc.ts**

It must agree with `props_explainer.build_props` frame for frame; the test above is what holds the
two together.

```ts
// render/src/templates/explainer/doc.ts
import { ExplainerPropsSchema, type ExplainerProps } from './schema';

/** The contract's per-role defaults, in seconds. Mirrors timing_explainer.DEFAULTS. */
const DEFAULTS: Record<string, number> = { hook: 3, step: 2, payoff: 4, cta: 3 };
const RATIOS: Record<string, [number, number]> = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080] };

type RawBeat = { id: string; role: string; line: string; op: string; data: unknown; sec?: number | null };
type RawDoc = { theme: string; brand: unknown; beats: RawBeat[]; fps?: number; ratio?: string };

export function sampleDocToProps(input: unknown): ExplainerProps {
  const doc = input as RawDoc;
  const fps = doc.fps ?? 30;
  const [width, height] = RATIOS[doc.ratio ?? '9:16'];
  let cursor = 0;
  const beats = doc.beats.map((b) => {
    const sec = b.sec ?? DEFAULTS[b.role];
    // half rounds up, matching timing_explainer.build_timeline
    const durationFrames = Math.max(1, Math.floor(sec * fps + 0.5));
    const startFrame = cursor;
    cursor += durationFrames;
    return { id: b.id, role: b.role, line: b.line, op: b.op, data: b.data, startFrame, durationFrames };
  });
  return ExplainerPropsSchema.parse({
    template: 'explainer', theme: doc.theme, fps, width, height,
    brand: doc.brand, totalFrames: cursor, beats,
  });
}
```

- [ ] **Step 5: Dispatch the preview props**

In `api/reels_api/routes/preview.py`, replace the body of `_sample_props`:

```python
from ..categories import DOC_ADAPTER
from ..props_explainer import build_props as build_explainer_props


def _sample_props(request: Request, template: str, theme: str) -> dict:
    tdir = request.app.state.settings.templates_dir
    if not (tdir / template / "template.json").exists():
        raise HTTPException(404, f"no template {template}")
    samples = load_template(tdir, template)["samples"]
    if theme not in samples:
        raise HTTPException(404, f"no theme {theme} for template {template}")
    doc = DOC_ADAPTER.validate_python(samples[theme])
    if doc.template == "explainer":
        return build_explainer_props(doc)
    resolve = lambda u: "/fixtures/" + u[len("fixture://"):] if u.startswith("fixture://") else u  # noqa: E731
    return build_props(doc, resolve, ["/fixtures/page.mp4"] * len(doc.pages))
```

- [ ] **Step 6: Register the compositions**

In `render/src/Root.tsx`, leave the existing tools block exactly as it is and add these imports:

```tsx
import { ExplainerReel } from './templates/explainer';
import { sampleDocToProps as explainerDocToProps } from './templates/explainer/doc';
import { EXPLAINER_THEME_IDS, ExplainerPropsSchema, type ExplainerProps } from './templates/explainer/schema';
import explainerGlass from '../../templates/explainer/samples/glass-bento.json';
import explainerKinetic from '../../templates/explainer/samples/kinetic.json';
import explainerDashboard from '../../templates/explainer/samples/dashboard-bento.json';
import explainerSticker from '../../templates/explainer/samples/sticker-board.json';

const EXPLAINER_SAMPLES: Record<string, unknown> = {
  'glass-bento': explainerGlass, kinetic: explainerKinetic,
  'dashboard-bento': explainerDashboard, 'sticker-board': explainerSticker,
};
```

and, inside the returned fragment immediately after the existing `THEME_IDS.map(...)` block:

```tsx
{EXPLAINER_THEME_IDS.map((theme) => (
  <Composition
    key={`explainer-${theme}`}
    id={`explainer-${theme}`}
    component={ExplainerReel}
    schema={ExplainerPropsSchema}
    defaultProps={explainerDocToProps(EXPLAINER_SAMPLES[theme])}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
    calculateMetadata={({ props }: { props: ExplainerProps }) => ({
      durationInFrames: props.totalFrames, fps: props.fps, width: props.width, height: props.height,
    })}
  />
))}
```

- [ ] **Step 7: Run everything**

Run: `cd render && npx vitest run src/templates/explainer/doc.test.ts`
Expected: 2 passed.

Run: `cd render && npm run build:preview`
Expected: build succeeds.

Run: `cd api && .venv/Scripts/python -m pytest`
Expected: all green, including the 4 new preview tests. Confirm with `git status` that no
pre-existing file under `api/tests/` was modified.

- [ ] **Step 8: Commit**

```bash
git add render/src/Root.tsx render/src/templates/explainer templates/explainer/samples \
        api/reels_api/routes/preview.py api/tests/test_explainer_preview.py
git commit -m "feat(explainer): register the compositions and ship a sample per theme

Root.tsx becomes a registry of category-theme ids rather than hardcoding
tools-. Preview props dispatch on the document's category. doc.ts mirrors
the API's props builder and a test holds the two to the same frames."
```

---

### Task 9: All seven ops, the golden timeline, and one real render

The spec's regression net: a fixture exercising every op, a frozen timeline, and proof an mp4
comes out.

**Files:**
- Create: `api/tests/fixtures/explainer-all-ops.json`
- Create: `api/tests/fixtures/explainer-timeline.json`
- Create: `api/tests/test_explainer_golden.py`
- Create: `api/tests/test_explainer_e2e.py`

**Interfaces:**
- Consumes: everything above. Produces nothing new; this task is verification.

- [ ] **Step 1: Write the all-ops fixture**

`api/tests/fixtures/explainer-all-ops.json` — the kinetic sample plus the one op it does not use,
`panel`, so all seven appear exactly once:

```json
{
  "template": "explainer",
  "theme": "kinetic",
  "brand": { "handle": "@stackframe", "name": "Stack Frame" },
  "beats": [
    { "id": "b1", "role": "hook", "line": "Why is the second request 100x faster?",
      "op": "race", "data": { "lanes": [
        { "label": "No cache", "value": 200, "unit": "ms" },
        { "label": "Cached", "value": 2, "unit": "ms" } ] } },
    { "id": "b2", "role": "step", "line": "Three parts, one path",
      "op": "stage", "data": { "nodes": [
        { "id": "app", "label": "App" },
        { "id": "cache", "label": "Cache" },
        { "id": "db", "label": "Database" } ] } },
    { "id": "b3", "role": "step", "line": "The first request misses",
      "op": "send", "data": { "from": "App", "to": "Database", "label": "MISS" } },
    { "id": "b4", "role": "step", "line": "The answer is stored on the way back",
      "op": "mark", "data": { "node": "Cache", "state": "on" } },
    { "id": "b5", "role": "step", "line": "The second never reaches the database",
      "op": "meter", "data": { "label": "Round trip", "to": 2, "unit": "ms" } },
    { "id": "b6", "role": "step", "line": "What the cache actually holds",
      "op": "panel", "data": { "title": "Cache entry", "lines": ["key: user:42", "ttl: 60s"], "mono": true } },
    { "id": "b7", "role": "payoff", "line": "The database is touched once",
      "op": "reveal", "data": { "text": "200 ms -> 2 ms" } }
  ]
}
```

- [ ] **Step 2: Write the golden test**

```python
# api/tests/test_explainer_golden.py
import json
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
ALL_OPS = FIXTURES / "explainer-all-ops.json"
GOLDEN = FIXTURES / "explainer-timeline.json"
OPS = {"stage", "send", "mark", "meter", "race", "reveal", "panel"}
THEMES = ["glass-bento", "kinetic", "dashboard-bento", "sticker-board"]


def test_the_fixture_exercises_every_op():
    doc = json.loads(ALL_OPS.read_text(encoding="utf-8"))
    assert {b["op"] for b in doc["beats"]} == OPS


def test_validate_matches_the_golden_timeline(client):
    doc = json.loads(ALL_OPS.read_text(encoding="utf-8"))
    r = client.post("/validate", json=doc)
    assert r.status_code == 200, r.text
    assert r.json() == json.loads(GOLDEN.read_text(encoding="utf-8"))


def test_the_timeline_is_contiguous(client):
    doc = json.loads(ALL_OPS.read_text(encoding="utf-8"))
    tl = client.post("/validate", json=doc).json()
    cursor = 0
    for seg in tl["segments"]:
        assert seg["startFrame"] == cursor
        cursor += seg["durationFrames"]
    assert tl["totalFrames"] == cursor


def test_every_theme_validates_the_same_document(client):
    doc = json.loads(ALL_OPS.read_text(encoding="utf-8"))
    for theme in THEMES:
        r = client.post("/validate", json={**doc, "theme": theme})
        assert r.status_code == 200, (theme, r.text)
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd api && .venv/Scripts/python -m pytest tests/test_explainer_golden.py -v`
Expected: 3 fail on the missing golden file; `test_the_fixture_exercises_every_op` passes.

- [ ] **Step 4: Record the golden**

```bash
cd api && .venv/Scripts/python -c "
import json, pathlib
from fastapi.testclient import TestClient
from reels_api.config import Settings
from reels_api.main import create_app
root = pathlib.Path('..').resolve()
s = Settings(jobs_dir=root/'.tmp-jobs', render_dir=root/'render', templates_dir=root/'templates', port=26200, public_base='http://127.0.0.1:26200')
doc = json.loads((root/'api/tests/fixtures/explainer-all-ops.json').read_text(encoding='utf-8'))
with TestClient(create_app(s, start_worker=False)) as c:
    r = c.post('/validate', json=doc)
    r.raise_for_status()
out = root/'api/tests/fixtures/explainer-timeline.json'
out.write_text(json.dumps(r.json(), indent=2), encoding='utf-8')
print(out)
"
```

Read the file before committing it. Expect seven segments with ids `b1` through `b7`, `startFrame`
values `0, 90, 150, 210, 270, 330, 390`, and `totalFrames` 510 at the contract defaults. If it
differs, the bug is in `timing_explainer` — fix the code and re-record rather than accepting the
output.

- [ ] **Step 5: Write the render test**

Follows `api/tests/test_e2e.py` exactly: a real uvicorn server, gated on `RUN_E2E=1` so the fast
suite never pays for it.

```python
# api/tests/test_explainer_e2e.py
"""A real explainer render. Slow; set RUN_E2E=1."""
import json
import os
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn

from reels_api.config import Settings
from reels_api.main import create_app

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(os.environ.get("RUN_E2E") != "1", reason="set RUN_E2E=1")


@pytest.fixture
def server(tmp_path):
    port = 26298
    s = Settings(jobs_dir=tmp_path / "jobs", render_dir=ROOT / "render", templates_dir=ROOT / "templates",
                 port=port, public_base=f"http://127.0.0.1:{port}")
    config = uvicorn.Config(create_app(s), host="127.0.0.1", port=port, log_level="warning")
    srv = uvicorn.Server(config)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        try:
            httpx.get(f"http://127.0.0.1:{port}/health", timeout=1)
            break
        except httpx.HTTPError:
            time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    t.join(timeout=5)


def test_an_explainer_renders_an_mp4(server, tmp_path):
    doc = json.loads((ROOT / "api/tests/fixtures/explainer-all-ops.json").read_text(encoding="utf-8"))
    r = httpx.post(f"{server}/jobs", json=doc, timeout=30)
    assert r.status_code == 202, r.text
    jid = r.json()["id"]
    state = {}
    for _ in range(600):
        state = httpx.get(f"{server}/jobs/{jid}", timeout=10).json()
        if state["state"] in ("done", "failed"):
            break
        time.sleep(1)
    assert state.get("state") == "done", httpx.get(f"{server}/jobs/{jid}/log", timeout=10).text
    mp4 = httpx.get(f"{server}/jobs/{jid}/reel.mp4", timeout=30)
    assert mp4.status_code == 200 and len(mp4.content) > 10_000
    out = tmp_path / "explainer.mp4"
    out.write_bytes(mp4.content)
    print(f"rendered {out}")
```

- [ ] **Step 6: Run the fast suite, then the render once**

Run: `cd api && .venv/Scripts/python -m pytest`
Expected: all green; the e2e test reports as skipped.

Run: `cd render && npm run build:preview`
Then: `cd api && RUN_E2E=1 .venv/Scripts/python -m pytest tests/test_explainer_e2e.py -v -s`
Expected: 1 passed, with the path of a real mp4 printed. This is the only step in the plan that
costs real CPU time — one render, a few minutes.

- [ ] **Step 7: Commit**

```bash
git add api/tests/fixtures/explainer-all-ops.json api/tests/fixtures/explainer-timeline.json \
        api/tests/test_explainer_golden.py api/tests/test_explainer_e2e.py
git commit -m "test(explainer): all seven ops, a frozen timeline, one real render

The timeline is the contract worth freezing; mp4 bytes are not, because
encoder churn breaks them for no signal. The render is gated on RUN_E2E=1
so the fast suite never pays for it, matching the tools e2e."
```

---

## After this plan

The service renders explainers from hand-written documents. Three things follow, in order:

1. **Watch the mp4 from Task 9, and open `/preview/explainer/{theme}` for all four themes.** The
   question this plan exists to answer is whether the seven ops produce something worth posting.
   Two things to judge specifically: whether `send` and `mark` read as disconnected from the
   `stage` before them, since beats are independent Sequences in v1; and whether four themes that
   differ only by tokens are distinct enough to be worth offering as four. Both are cheap to
   change now and expensive once the studio authors against the contract.
2. **Plan 2, the studio half** — the Explainers tab, the script layer, the fit report and the four
   input paths, written against the contract this plan made real rather than guessed at now. It
   belongs in `docs/superpowers/plans/` in the instastudio repo.
3. **The `algo` category**, if and when the fit report says `panel` is carrying too much.
