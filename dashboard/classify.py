"""Классификация файлов патчей по имени."""
import re
from typing import List, Tuple

CVE_RE = re.compile(r"CVE-\d{4}-\d{4,}", re.I)


def find_cves(text: str) -> List[str]:
    """Все CVE-идентификаторы из строки: верхний регистр, без повторов."""
    seen = []
    for match in CVE_RE.finditer(text or ""):
        cve = match.group(0).upper()
        if cve not in seen:
            seen.append(cve)
    return seen


class Classifier:
    """Первое совпавшее правило определяет класс патча."""

    def __init__(self, rules: List[Tuple[str, str]]):
        self._rules = [(name, re.compile(pattern)) for name, pattern in rules]

    @classmethod
    def from_config(cls, cfg) -> "Classifier":
        return cls(cfg.patch_classes)

    def classify(self, filename: str) -> str:
        for name, regex in self._rules:
            if regex.search(filename):
                return name
        return "other"

    def class_names(self) -> List[str]:
        names = []
        for name, _ in self._rules:
            if name not in names:
                names.append(name)
        return names
