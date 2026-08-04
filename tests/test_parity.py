"""Эталон страницы: с ним сверяется порт представления в JS.

Пока представление считает Python, этот тест сторожит эталон от
незамеченного дрейфа. После переноса вычислений в браузер файл удаляется, а
эталон остаётся — по нему сверяется viewmodel.js.

Обновить эталон осознанно:  python3 -m tests.test_parity --update
"""
import json
import os
import sys
import unittest

from kojipatch.classify import Classifier
from kojipatch.config import load_config
from kojipatch.diff import diff_chain
from kojipatch.model import load_snapshots
from kojipatch.render import build_page_data

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = [os.path.join(ROOT, "tests", "fixtures", "rich-old.json"),
            os.path.join(ROOT, "tests", "fixtures", "rich-new.json")]
GOLDEN = os.path.join(ROOT, "tests", "js", "fixtures", "page-data.golden.json")


def page_data():
    snapshots = []
    for path in FIXTURES:
        snapshots.extend(load_snapshots(path))
    cfg = load_config(None, require_hub=False)
    return build_page_data(snapshots, diff_chain(snapshots),
                           Classifier.from_config(cfg))


def write_golden():
    os.makedirs(os.path.dirname(GOLDEN), exist_ok=True)
    with open(GOLDEN, "w", encoding="utf-8") as handle:
        json.dump(page_data(), handle, ensure_ascii=False, indent=1,
                  sort_keys=True)
        handle.write("\n")


class ParityGolden(unittest.TestCase):
    def test_golden_matches_the_current_render(self):
        with open(GOLDEN, "r", encoding="utf-8") as handle:
            golden = json.load(handle)
        self.assertEqual(page_data(), golden)

    def test_golden_covers_the_interesting_cases(self):
        """Эталон бесполезен, если в нём нет случаев, на которых порт
        ломается. Проверяем, что фикстуры их действительно несут."""
        data = page_data()
        pair = data["pairs"][0]
        statuses = set(row["status"] for row in pair["rows"])
        self.assertEqual(statuses,
                         {"added", "removed", "upgraded", "downgraded",
                          "unchanged"})
        self.assertTrue(pair["counts"]["tag_changed"])
        self.assertTrue(pair["counts"]["repackaged"])
        self.assertTrue(pair["counts"]["branch_changed"])
        rows = data["snapshots"][0]["builds"]
        self.assertIn(None, [row["tagged_in"] for row in rows])
        self.assertIn(True, [row["inherited"] for row in rows])


if __name__ == "__main__":
    if "--update" in sys.argv:
        write_golden()
        print("эталон обновлён:", GOLDEN)
    else:
        unittest.main()
