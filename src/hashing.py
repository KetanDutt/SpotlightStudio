"""
hashing.py – perceptual hashing without NumPy/SciPy.

Spotlight Studio de-duplicates wallpapers with a **256-bit difference hash**
(dHash, 16×16).  The previous implementation delegated to ``imagehash`` which
drags in NumPy *and* SciPy (≈50 MB) just to compare 272 grey pixels.  The
algorithm is tiny, so it lives here – producing **bit-identical** hashes to
``str(imagehash.dhash(img, hash_size=16))`` (verified by the test-suite against
golden values), which keeps every hash already stored in the database valid.

Algorithm
---------
1. Convert to greyscale and resize to 17 × 16 (Lanczos).
2. For every row compare each pixel with its right neighbour → 16 bits per row.
3. Concatenate the 256 bits (row-major, MSB first) and hex-encode (64 chars).

Near-duplicates are found with the Hamming distance; the 64 hex characters are
split into 8 chunks of 8 characters so that candidate look-ups can use the
*pigeonhole principle*: two hashes within distance ≤ 7 must share at least one
identical chunk.
"""
from __future__ import annotations

import re

from PIL import Image

HASH_SIZE = 16
HASH_BITS = HASH_SIZE * HASH_SIZE  # 256
HASH_HEX_LEN = HASH_BITS // 4  # 64
CHUNKS = 8
CHUNK_HEX_LEN = HASH_HEX_LEN // CHUNKS  # 8 hex chars == 32 bits
DEFAULT_MAX_DISTANCE = 4

_LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS")  # noqa: B009
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def dhash_hex(image: Image.Image) -> str:
    """Return the 64-character hexadecimal dHash of ``image``."""
    small = image.convert("L").resize((HASH_SIZE + 1, HASH_SIZE), _LANCZOS)
    pixels = small.tobytes()  # 1 byte per pixel, row-major (``getdata`` is deprecated in Pillow 12)
    row_len = HASH_SIZE + 1
    bits = 0
    for row in range(HASH_SIZE):
        base = row * row_len
        for col in range(HASH_SIZE):
            bits = (bits << 1) | (1 if pixels[base + col + 1] > pixels[base + col] else 0)
    return f"{bits:0{HASH_HEX_LEN}x}"


def is_valid_phash(value: str | None) -> bool:
    """True for a well-formed 64-character lowercase hex hash."""
    return bool(value) and bool(_HEX64.match(value))  # type: ignore[arg-type]


def hamming_hex(a: str, b: str) -> int:
    """Hamming distance between two equal-length hex hashes."""
    return (int(a, 16) ^ int(b, 16)).bit_count()


def chunk_keys(phash: str) -> list[str]:
    """Split a hash into its 8 index chunks (used for candidate look-up)."""
    return [phash[i * CHUNK_HEX_LEN : (i + 1) * CHUNK_HEX_LEN] for i in range(CHUNKS)]
