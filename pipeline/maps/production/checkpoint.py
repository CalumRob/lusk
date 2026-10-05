"""Append-only, checksummed output checkpoints for crash-safe production runs."""
from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
from uuid import uuid4


class CheckpointContractMismatch(ValueError):
    """An intact journal belongs to a different run contract."""


def _canonical_json(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(",", ":")).encode("utf-8")


def _envelope(payload) -> bytes:
    return _canonical_json({"payload": payload,
        "sha256": sha256(_canonical_json(payload)).hexdigest()}) + b"\n"


class OutputCheckpoint:
    """Persist the expected matrix once and each completed output as one durable row.

    A corrupt/torn tail is truncated to the last verified record. Corruption of
    the header fails closed because the expected matrix can no longer be trusted.
    Record-write and fsync errors propagate to the runner; they must never be
    reported as a successful but unrecoverable output.
    """

    SCHEMA = 1

    def __init__(self, output_dir: str | Path, contract_identity: str,
                 expected_outputs):
        self.output_dir = Path(output_dir)
        self.path = self.output_dir / f".production-checkpoint-{contract_identity}.jsonl"
        self.contract_identity = contract_identity
        self.expected_outputs = json.loads(_canonical_json(list(expected_outputs)))
        self.attempt_id = uuid4().hex
        self.records = []
        self.output_dir.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            try:
                with self.path.open("xb"):
                    pass
            except FileExistsError:
                pass
        if self.path.stat().st_size == 0:
            self._append_record({"kind": "header", "schema": self.SCHEMA,
                "contract_identity": self.contract_identity,
                "expected_outputs": self.expected_outputs})
        self._load_and_repair()
        self._append_record({"kind": "attempt-start", "attempt_id": self.attempt_id})

    def _load_and_repair(self):
        data = self.path.read_bytes()
        valid_end = 0
        records = []
        for line_number, line in enumerate(data.splitlines(keepends=True), 1):
            if not line.endswith(b"\n"):
                break
            try:
                envelope = json.loads(line)
                payload = envelope["payload"]
                if envelope.get("sha256") != sha256(_canonical_json(payload)).hexdigest():
                    break
                if not isinstance(payload, dict):
                    if line_number == 1:
                        raise ValueError("production checkpoint header must be an object")
                    break
                if line_number == 1:
                    if (payload.get("kind") != "header" or payload.get("schema") != self.SCHEMA
                            or payload.get("contract_identity") != self.contract_identity
                            or payload.get("expected_outputs") != self.expected_outputs):
                        raise CheckpointContractMismatch(
                            "production checkpoint contract/header does not match this run")
                elif not isinstance(payload, dict) or payload.get("kind") not in {
                        "attempt-start", "output-success", "output-failure"}:
                    break
            except CheckpointContractMismatch:
                raise
            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                if line_number == 1:
                    raise ValueError("production checkpoint header is corrupt; refusing unsafe recovery")
                break
            records.append(payload)
            valid_end += len(line)
        if not records:
            raise ValueError("production checkpoint has no valid expected-output header")
        if valid_end != len(data):
            with self.path.open("r+b") as stream:
                stream.truncate(valid_end)
                stream.flush()
                os.fsync(stream.fileno())
        self.records = records

    @property
    def success_records(self):
        return [row for row in self.records if row.get("kind") == "output-success"]

    @property
    def failure_records(self):
        return [row for row in self.records if row.get("kind") == "output-failure"]

    def record_success(self, output):
        self._append_record({"kind": "output-success", "attempt_id": self.attempt_id,
            **dict(output)})

    def record_failure(self, failure):
        self._append_record({"kind": "output-failure", "attempt_id": self.attempt_id,
            **dict(failure)})

    def _append_record(self, payload):
        record = _envelope(payload)
        with self.path.open("ab", buffering=0) as stream:
            written = stream.write(record)
            if written != len(record):
                raise OSError("short write while checkpointing production output")
            os.fsync(stream.fileno())
        if payload.get("kind") != "header":
            self.records.append(payload)
