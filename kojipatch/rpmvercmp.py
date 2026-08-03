"""Сравнение версий по алгоритму RPM, без зависимости от python-rpm."""
import re
from typing import Optional, Tuple

_DIGITS = re.compile(r"^(\d+)")
_ALPHA = re.compile(r"^([A-Za-z]+)")


def _strip_separators(text: str) -> str:
    index = 0
    while index < len(text) and not (text[index].isalnum()
                                     or text[index] in "~^"):
        index += 1
    return text[index:]


def rpmvercmp(a: str, b: str) -> int:
    """Возвращает -1, 0 или 1, как rpmvercmp(3)."""
    a = a or ""
    b = b or ""
    if a == b:
        return 0

    while a or b:
        a = _strip_separators(a)
        b = _strip_separators(b)

        if a[:1] == "~" or b[:1] == "~":
            if a[:1] != "~":
                return 1
            if b[:1] != "~":
                return -1
            a, b = a[1:], b[1:]
            continue

        if a[:1] == "^" or b[:1] == "^":
            if not a:
                return -1
            if not b:
                return 1
            if a[:1] != "^":
                return 1
            if b[:1] != "^":
                return -1
            a, b = a[1:], b[1:]
            continue

        if not a or not b:
            break

        if a[0].isdigit():
            match_a, match_b, numeric = _DIGITS.match(a), _DIGITS.match(b), True
        else:
            match_a, match_b, numeric = _ALPHA.match(a), _ALPHA.match(b), False

        if match_b is None:
            # цифры «весомее» букв
            return 1 if numeric else -1

        seg_a, seg_b = match_a.group(1), match_b.group(1)
        a, b = a[len(seg_a):], b[len(seg_b):]

        if numeric:
            seg_a = seg_a.lstrip("0") or "0"
            seg_b = seg_b.lstrip("0") or "0"
            if len(seg_a) != len(seg_b):
                return 1 if len(seg_a) > len(seg_b) else -1

        if seg_a != seg_b:
            return 1 if seg_a > seg_b else -1

    if not a and not b:
        return 0
    return 1 if a else -1


def compare_evr(a: Tuple[Optional[int], str, str],
                b: Tuple[Optional[int], str, str]) -> int:
    """Сравнивает (epoch, version, release); epoch None считается нулём."""
    epoch_a = int(a[0] or 0)
    epoch_b = int(b[0] or 0)
    if epoch_a != epoch_b:
        return 1 if epoch_a > epoch_b else -1
    result = rpmvercmp(a[1], b[1])
    if result:
        return result
    return rpmvercmp(a[2], b[2])
