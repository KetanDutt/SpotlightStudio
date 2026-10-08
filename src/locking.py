"""Single-process ownership of a library, enforced with an OS advisory file lock.

SQLite serialises database writes, not the surrounding image writes or queue claim
recovery. A second server/CLI writer must therefore fail *before* startup tasks.
The sidecar is deliberately never unlinked: deleting a locked inode would let
another process lock a different file at the same path. The OS releases ownership
on exit (including a hard kill); a leftover ``.lock`` file is not a stale lock.

Use a local filesystem. These locks do not coordinate separate machines, different
DBs sharing an image directory, or tools that bypass this application entirely.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import BinaryIO

_held: set[Path] = set()
_guard = threading.Lock()


class LibraryBusy(RuntimeError):
    """Another application instance already owns this database."""


class LibraryLock:
    """Non-blocking, cross-platform exclusive ownership for a server/CLI lifetime."""

    def __init__(self, database: Path) -> None:
        self.path = Path(str(database.resolve()) + ".lock")
        self._file: BinaryIO | None = None

    def __enter__(self) -> LibraryLock:
        with _guard:
            if self.path in _held:
                raise self._busy()
            self.path.parent.mkdir(parents=True, exist_ok=True)
            flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(self.path, flags, 0o600)
            file = os.fdopen(fd, "r+b")
            try:
                # Windows byte-range locks need a byte even for a brand-new file.
                if self.path.stat().st_size == 0:
                    file.write(b"\0")
                    file.flush()
                file.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                file.close()
                raise self._busy() from exc
            self._file = file
            _held.add(self.path)
        return self

    def _busy(self) -> LibraryBusy:
        return LibraryBusy(
            f"The library is already in use ({self.path.name}). Stop the other server/crawl "
            "before running a CLI operation, or use the running server's API. "
            "Only one server worker is supported; do not delete the lock file."
        )

    def __exit__(self, *_exc) -> None:
        with _guard:
            file, self._file = self._file, None
            if file is None:
                return
            try:
                if os.name == "nt":
                    import msvcrt

                    file.seek(0)
                    msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(file.fileno(), fcntl.LOCK_UN)
            finally:
                file.close()
                _held.discard(self.path)
