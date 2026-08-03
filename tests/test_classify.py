import unittest

from kojipatch.classify import Classifier, find_cves
from kojipatch.config import Config

RULES = [
    ("CVE", r"CVE-\d{4}-\d{4,}"),
    ("SAST", r"(?i)^sast[-_]"),
    ("DAST", r"(?i)^dast[-_]"),
    ("other", ".*"),
]


class FindCvesTest(unittest.TestCase):
    def test_single_cve(self):
        self.assertEqual(find_cves("CVE-2024-7347.patch"), ["CVE-2024-7347"])

    def test_multiple_cves_keep_order_and_dedup(self):
        name = "fix-CVE-2024-1234-and-cve-2023-9999-and-CVE-2024-1234.patch"
        self.assertEqual(find_cves(name),
                         ["CVE-2024-1234", "CVE-2023-9999"])

    def test_lowercase_is_normalised(self):
        self.assertEqual(find_cves("cve-2021-44228.patch"), ["CVE-2021-44228"])

    def test_three_digit_tail_is_not_a_cve(self):
        self.assertEqual(find_cves("CVE-2024-123.patch"), [])

    def test_no_cve(self):
        self.assertEqual(find_cves("sast-fix.patch"), [])


class ClassifierTest(unittest.TestCase):
    def setUp(self):
        self.c = Classifier(RULES)

    def test_cve_wins_over_catch_all(self):
        self.assertEqual(self.c.classify("CVE-2024-7347.patch"), "CVE")

    def test_sast_prefix(self):
        self.assertEqual(self.c.classify("sast-null-deref.patch"), "SAST")

    def test_sast_uppercase_prefix(self):
        self.assertEqual(self.c.classify("SAST_overflow.patch"), "SAST")

    def test_dast_prefix(self):
        self.assertEqual(self.c.classify("dast_timeout.patch"), "DAST")

    def test_first_rule_wins(self):
        # имя подходит и под CVE, и под SAST — правило CVE стоит раньше
        self.assertEqual(self.c.classify("sast-CVE-2024-7347.patch"), "CVE")

    def test_unknown_falls_back_to_other(self):
        self.assertEqual(self.c.classify("0001-fix-build.patch"), "other")

    def test_class_names_are_unique_and_ordered(self):
        self.assertEqual(self.c.class_names(), ["CVE", "SAST", "DAST", "other"])

    def test_from_config(self):
        cfg = Config(koji_hub="h", patch_classes=RULES)
        self.assertEqual(Classifier.from_config(cfg).classify("dast_x.patch"),
                         "DAST")


if __name__ == "__main__":
    unittest.main()
