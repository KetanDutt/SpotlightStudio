"""
Parity guard for the Roku channel's Daily Spotlight hash.

``roku/source/catalog.brs`` reimplements :func:`src.utils.daily_score` in
BrightScript, a language with neither an XOR operator nor an unsigned 32-bit
integer type (the hash is built from ``(a or b) - (a and b)`` and Double
arithmetic in ``Mul32``).  If the two implementations ever disagree, the TV
shows a different Daily Spotlight than the web, desktop and mobile clients -
silently.

This test re-executes the BrightScript algorithm with exact int32/uint32
semantics and compares it against the Python reference for a spread of days
and ids, plus the argmax over the packaged catalog.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from src.utils import daily_score

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "roku" / "assets" / "catalog.json"

FNV_OFFSET = 2166136261 - (1 << 32)
FNV_PRIME = 16777619
AVALANCHE_A = 0x7FEB352D
AVALANCHE_B = 0x846CA68B - (1 << 32)


def _unsigned(value: int) -> int:
    return value + (1 << 32) if value < 0 else value


def _signed(value: int) -> int:
    return value - (1 << 32) if value >= (1 << 31) else value


def _xor32(a: int, b: int) -> int:
    """BrightScript ``Xor32``: ``(a or b) - (a and b)``."""
    return _signed(((a | b) - (a & b)) & 0xFFFFFFFF)


def _mul32(a: int, b: int) -> int:
    """BrightScript ``Mul32``: 16-bit half decomposition, high half dropped."""
    au, bu = _unsigned(a), _unsigned(b)
    ah, al = au // 65536, au % 65536
    bh, bl = bu // 65536, bu % 65536
    low = al * bl
    carry, low_word = low // 65536, low % 65536
    mid = ah * bl + al * bh + carry
    mid_word = mid % 65536
    return _signed(mid_word * 65536 + low_word)


def _fnv(text: str, seed: int) -> int:
    h = seed
    for char in text:
        h = _mul32(_xor32(h, ord(char)), FNV_PRIME)
    return h


def _avalanche(h: int) -> int:
    x = _mul32(_xor32(h, (h >> 16) & 0xFFFF), AVALANCHE_A)
    x = _mul32(_xor32(x, (x >> 15) & 0x1FFFF), AVALANCHE_B)
    return _unsigned(_xor32(x, (x >> 16) & 0xFFFF))


def brightscript_score(day: str, wallpaper_id: int) -> int:
    """Mirror of catalog.brs: DailyScore(day, id)."""
    seed = _fnv(day + "|", FNV_OFFSET)
    return _avalanche(_fnv(str(wallpaper_id), seed))


def test_hash_matches_python_reference() -> None:
    rng = random.Random(20261021)
    ids = [1, 2, 3, 42, 100, 7493] + [rng.randint(1, 7492) for _ in range(80)]
    days = ["2026-10-21", "2025-12-25", "2024-02-29", "2027-01-01"]
    for day in days:
        for wallpaper_id in ids:
            assert brightscript_score(day, wallpaper_id) == daily_score(
                day, wallpaper_id
            ), f"hash drift for {day} id={wallpaper_id}"


def test_daily_winner_matches_python_reference() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="ascii"))
    assert catalog, "roku/assets/catalog.json is empty"
    for day in ("2026-10-21", "2026-01-15"):
        from_brs = max(catalog, key=lambda row: (brightscript_score(day, row["id"]), -row["id"]))
        from_py = max(catalog, key=lambda row: (daily_score(day, row["id"]), -row["id"]))
        assert from_brs["id"] == from_py["id"], f"winner drift on {day}"
