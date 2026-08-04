"""Архитектура RPM и порядок пакетов в списках.

Живёт отдельным модулем, потому что порядок нужен в двух местах сразу:
render раскладывает пакеты одного билда, diff — строки «было/стало».
"""
from typing import Iterable, List, Tuple

# Первыми идут src и noarch: это не «ещё одна архитектура», а исходник и
# пакет, которому архитектура не нужна. Остальные — по алфавиту.
LEADING_ARCHES = ("src", "noarch")


def arch_of(nvra: str) -> str:
    """Архитектура из NVRA или из ключа подпакета name.arch.

    Берём хвост после последней точки: точки внутри версии и релиза
    (5.14.0-611.34.1.el9_7) на это не влияют, потому что архитектура в
    имени всегда последняя.
    """
    index = nvra.rfind(".")
    return nvra[index + 1:] if index != -1 else "?"


def arch_key(arch: str) -> Tuple[int, str]:
    if arch in LEADING_ARCHES:
        return (LEADING_ARCHES.index(arch), "")
    return (len(LEADING_ARCHES), arch)


def sort_key(nvra: str) -> Tuple[Tuple[int, str], str]:
    return (arch_key(arch_of(nvra)), nvra)


def sort_rpms(items: Iterable[str]) -> List[str]:
    """Пакеты, сгруппированные по архитектуре, внутри группы — по имени."""
    return sorted(items, key=sort_key)
