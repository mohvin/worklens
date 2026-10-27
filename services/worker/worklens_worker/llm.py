"""Meta model client: OpenAI-compatible chat endpoint with image input.

Works against OpenRouter (meta/muse-spark-1.3) today and the Meta Model API
later; only WORKLENS_LLM_BASE_URL, WORKLENS_LLM_MODEL and the key change.

Every call is cached on disk by a content hash so a run can be replayed with
zero API calls, and every call is recorded as a ModelCall for the cost log.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .imageops import fingerprint
from .models import ModelCall

PROMPT_VERSION = "v3"  # v3: cache key uses the frame fingerprint, not the JPEG bytes


@dataclass
class LLMConfig:
    base_url: str
    model: str
    api_key: str
    reasoning_effort: str = "low"  # Muse Spark always reasons; keep it short
    max_tokens: int = 1500
    timeout_s: float = 120.0

    @classmethod
    def from_env(cls) -> "LLMConfig":
        key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("WORKLENS_LLM_API_KEY") or ""
        if not key:
            raise RuntimeError("Set OPENROUTER_API_KEY (or WORKLENS_LLM_API_KEY) in .env")
        return cls(
            base_url=os.environ.get("WORKLENS_LLM_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/"),
            model=os.environ.get("WORKLENS_LLM_MODEL", "meta/muse-spark-1.3"),
            api_key=key,
        )


def image_part(path: Path) -> dict[str, Any]:
    b64 = base64.b64encode(path.read_bytes()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}


def prompt_key(model: str, system: str, user_text: str, schema_name: str) -> str:
    return hashlib.sha256(f"{PROMPT_VERSION}|{model}|{schema_name}|{system}|{user_text}".encode()).hexdigest()[:24]


def cache_key(model: str, system: str, user_text: str, images: list[Path], schema_name: str) -> str:
    h = hashlib.sha256()
    h.update(prompt_key(model, system, user_text, schema_name).encode())
    for p in images:
        h.update(fingerprint(p).encode())
    return h.hexdigest()[:24]


NEAR_BITS = 3  # per hash, per frame: a different JPEG encoder flips at most a bit or two


def _hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def fingerprints_match(a: str, b: str, bits: int = NEAR_BITS) -> bool:
    """Same size and both perceptual hashes within `bits` of each other."""
    sa, pa, da = a.split(":")
    sb, pb, db = b.split(":")
    return sa == sb and _hamming(pa, pb) <= bits and _hamming(da, db) <= bits


class LLMClient:
    def __init__(self, cfg: LLMConfig, cache_dir: Path, stage: str = "label"):
        self.cfg = cfg
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.stage = stage
        self.calls: list[ModelCall] = []
        self._http = httpx.Client(
            base_url=cfg.base_url,
            headers={
                "Authorization": f"Bearer {cfg.api_key}",
                "HTTP-Referer": "https://github.com/purplelab/worklens",
                "X-Title": "WorkLens",
            },
            timeout=cfg.timeout_s,
        )

    def _near_hit(self, pkey: str, fps: list[str]) -> str | None:
        """Cache entry for the same prompt whose frames look the same (re-extracted video)."""
        for side in self.cache_dir.glob("*.fp.json"):
            try:
                meta = json.loads(side.read_text())
            except json.JSONDecodeError:
                continue
            if meta.get("prompt") != pkey or len(meta.get("fps", [])) != len(fps):
                continue
            if all(fingerprints_match(a, b) for a, b in zip(fps, meta["fps"])):
                key = side.name[: -len(".fp.json")]
                if (self.cache_dir / f"{key}.json").exists():
                    return key
        return None

    def structured(
        self,
        system: str,
        user_text: str,
        images: list[Path],
        schema: dict[str, Any],
        schema_name: str,
        retries: int = 1,
    ) -> tuple[dict[str, Any] | None, ModelCall]:
        """Return (parsed JSON or None, call record). Cached by content."""
        key = cache_key(self.cfg.model, system, user_text, images, schema_name)
        pkey = prompt_key(self.cfg.model, system, user_text, schema_name)
        fps = [fingerprint(p) for p in images]
        hit = key if (self.cache_dir / f"{key}.json").exists() else self._near_hit(pkey, fps)
        if hit:
            data = json.loads((self.cache_dir / f"{hit}.json").read_text())
            call = ModelCall(stage=self.stage, model=self.cfg.model, cache_key=hit, cached=True, latency_s=0.0)
            self.calls.append(call)
            return data, call
        cached = self.cache_dir / f"{key}.json"
        sidecar = self.cache_dir / f"{key}.fp.json"

        body = {
            "model": self.cfg.model,
            "temperature": 0,
            "max_tokens": self.cfg.max_tokens,
            "reasoning": {"effort": self.cfg.reasoning_effort},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": [{"type": "text", "text": user_text}, *[image_part(p) for p in images]]},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
            "usage": {"include": True},
        }

        last_err = "no attempt"
        for attempt in range(retries + 1):
            t0 = time.time()
            try:
                r = self._http.post("/chat/completions", json=body)
                latency = time.time() - t0
                j = r.json()
                if r.status_code != 200 or "choices" not in j:
                    last_err = f"http {r.status_code}: {json.dumps(j)[:300]}"
                    continue
                choice = j["choices"][0]
                content = choice["message"].get("content") or ""
                usage = j.get("usage") or {}
                if not content.strip():
                    # Muse Spark spent the whole budget reasoning; give the retry more room.
                    finish = choice.get("finish_reason")
                    reasoning = (usage.get("completion_tokens_details") or {}).get("reasoning_tokens")
                    last_err = f"empty content (finish_reason={finish}, reasoning_tokens={reasoning})"
                    body["max_tokens"] = int(body["max_tokens"] * 2)
                    continue
                data = json.loads(content)
                cached.write_text(json.dumps(data))
                sidecar.write_text(json.dumps({"prompt": pkey, "fps": fps}))
                call = ModelCall(
                    stage=self.stage, model=self.cfg.model, cache_key=key, cached=False,
                    latency_s=round(latency, 3),
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    cost_usd=float(usage.get("cost", 0.0)),
                )
                self.calls.append(call)
                return data, call
            except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
                last_err = f"{type(e).__name__}: {e}"[:300]
        call = ModelCall(
            stage=self.stage, model=self.cfg.model, cache_key=key, cached=False,
            latency_s=0.0, ok=False, error=last_err,
        )
        self.calls.append(call)
        return None, call
