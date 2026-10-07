"""Bound run-long diagnostic memory while preserving the final QA report."""
from __future__ import annotations

import json
import os
from tempfile import TemporaryFile


class StageReportSpool:
    """Fsynced per-territory JSONL channels for adapter and runner diagnostics.

    The temporary streams keep only the current territory's report rows in
    memory while production runs. ``read`` materializes the original ordered
    QA rows after rendering has finished, preserving the public report shape.
    """

    _CHANNELS = ("adapter", "identity")

    def __init__(self):
        self._streams = {name: TemporaryFile(mode="w+t", encoding="utf-8", newline="\n")
            for name in self._CHANNELS}

    def append(self, channel: str, events) -> None:
        try:
            stream = self._streams[channel]
        except KeyError as error:
            raise ValueError(f"unknown stage-report channel: {channel}") from error
        for event in events:
            stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")))
            stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())

    def read(self, channel: str) -> list[dict]:
        try:
            stream = self._streams[channel]
        except KeyError as error:
            raise ValueError(f"unknown stage-report channel: {channel}") from error
        stream.flush()
        stream.seek(0)
        return [json.loads(line) for line in stream]

    def close(self) -> None:
        for stream in self._streams.values():
            stream.close()

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass
