"""Minimal Supabase client (REST + Storage over httpx) for the hosted worker.

Only the service role key is used, server-side. Tables and buckets are in
services/worker/supabase/migrations (also applied to the live project).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class Supabase:
    url: str
    service_key: str

    @classmethod
    def from_env(cls) -> "Supabase":
        url = os.environ.get("SUPABASE_URL") or ""
        key = os.environ.get("SUPABASE_SERVICE_KEY") or ""
        if not url or not key:
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
        return cls(url.rstrip("/"), key)

    def _client(self, timeout: float = 120.0) -> httpx.Client:
        return httpx.Client(
            base_url=self.url,
            headers={"apikey": self.service_key, "Authorization": f"Bearer {self.service_key}"},
            timeout=timeout,
        )

    # ---- table: runs ----
    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._client() as c:
            r = c.get("/rest/v1/runs", params={"id": f"eq.{run_id}", "select": "*"})
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None

    def update_run(self, run_id: str, **fields: Any) -> None:
        with self._client() as c:
            r = c.patch(
                "/rest/v1/runs",
                params={"id": f"eq.{run_id}"},
                headers={"Prefer": "return=minimal", "Content-Type": "application/json"},
                content=json.dumps(fields),
            )
            r.raise_for_status()

    def list_runs(self, process_id: str) -> list[dict[str, Any]]:
        """The runs of a process in handoff order."""
        with self._client() as c:
            r = c.get("/rest/v1/runs", params={"process_id": f"eq.{process_id}", "select": "*", "order": "position.asc,created_at.asc"})
            r.raise_for_status()
            return r.json()

    # ---- table: processes ----
    def get_process(self, process_id: str) -> dict[str, Any] | None:
        with self._client() as c:
            r = c.get("/rest/v1/processes", params={"id": f"eq.{process_id}", "select": "*"})
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None

    def update_process(self, process_id: str, **fields: Any) -> None:
        with self._client() as c:
            r = c.patch(
                "/rest/v1/processes",
                params={"id": f"eq.{process_id}"},
                headers={"Prefer": "return=minimal", "Content-Type": "application/json"},
                content=json.dumps(fields),
            )
            r.raise_for_status()

    # ---- storage ----
    def download(self, bucket: str, path: str) -> bytes:
        with self._client(timeout=600.0) as c:
            r = c.get(f"/storage/v1/object/{bucket}/{path}")
            r.raise_for_status()
            return r.content

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        with self._client(timeout=120.0) as c:
            r = c.post(
                f"/storage/v1/object/{bucket}/{path}",
                headers={"Content-Type": content_type, "x-upsert": "true"},
                content=data,
            )
            r.raise_for_status()
