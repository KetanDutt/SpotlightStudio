from __future__ import annotations

import io

import pytest
from PIL import Image

from src.hashing import (
    CHUNKS,
    HASH_HEX_LEN,
    chunk_keys,
    dhash_hex,
    hamming_hex,
    is_valid_phash,
)
from tests.fake_site import make_picture


def _img(seed: int, w: int = 640, h: int = 360) -> Image.Image:
    return Image.open(io.BytesIO(make_picture(seed, w, h)))


def test_hash_shape_and_determinism():
    h = dhash_hex(_img(1))
    assert len(h) == HASH_HEX_LEN == 64
    assert is_valid_phash(h)
    assert h == dhash_hex(_img(1))


def test_golden_value_is_stable():
    """Guards the algorithm: changing it would invalidate every stored hash."""
    flat = Image.new("RGB", (200, 100), (10, 20, 30))
    assert dhash_hex(flat) == "0" * 64
    # Horizontal ramp, dark → bright: every comparison pixel[x+1] > pixel[x] is True.
    ramp = Image.frombytes("L", (256, 16), bytes(range(256)) * 16).convert("RGB")
    assert dhash_hex(ramp) == "f" * 64
    # Mirrored ramp (bright → dark): every comparison is False.
    assert dhash_hex(ramp.transpose(Image.Transpose.FLIP_LEFT_RIGHT)) == "0" * 64


def test_matches_imagehash_reference():
    imagehash = pytest.importorskip("imagehash")
    for seed in (1, 2, 3):
        img = _img(seed, 1280, 720)
        assert dhash_hex(img) == str(imagehash.dhash(img, hash_size=16))


def test_same_picture_at_other_resolution_is_near_duplicate():
    big, small = dhash_hex(_img(7, 1280, 720)), dhash_hex(_img(7, 640, 360))
    other = dhash_hex(_img(8, 640, 360))
    assert hamming_hex(big, small) <= 4
    assert hamming_hex(big, other) > 40


def test_hamming_and_chunks():
    a = "0" * 64
    b = "0" * 63 + "f"
    assert hamming_hex(a, b) == 4
    assert hamming_hex(a, a) == 0
    keys = chunk_keys(b)
    assert len(keys) == CHUNKS and all(len(k) == 8 for k in keys)
    assert keys[-1] == "0000000f"


def test_pigeonhole_chunk_property():
    """Any two hashes within distance <= 4 share at least 4 identical chunks."""
    import random

    rng = random.Random(0)
    for _ in range(200):
        value = rng.getrandbits(256)
        flipped = value
        for bit in rng.sample(range(256), rng.randint(0, 4)):
            flipped ^= 1 << bit
        a, b = f"{value:064x}", f"{flipped:064x}"
        assert hamming_hex(a, b) <= 4
        shared = sum(x == y for x, y in zip(chunk_keys(a), chunk_keys(b), strict=True))
        assert shared >= 4


@pytest.mark.parametrize("value", [None, "", "xyz", "G" * 64, "a" * 63, "A" * 64])
def test_invalid_hashes(value):
    assert not is_valid_phash(value)
