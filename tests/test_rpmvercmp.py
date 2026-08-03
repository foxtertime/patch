import unittest

from kojipatch.rpmvercmp import compare_evr, rpmvercmp


class RpmVerCmpTest(unittest.TestCase):
    def check(self, a, b, expected):
        self.assertEqual(rpmvercmp(a, b), expected, "%s vs %s" % (a, b))
        self.assertEqual(rpmvercmp(b, a), -expected, "%s vs %s" % (b, a))

    def test_equal(self):
        self.check("1.0", "1.0", 0)
        self.check("1.0-1.el9", "1.0-1.el9", 0)

    def test_numeric_segments(self):
        self.check("1.0.1", "1.0", 1)
        self.check("2.0", "1.9.9", 1)
        self.check("1.10", "1.9", 1)

    def test_leading_zeros_ignored(self):
        self.check("1.007", "1.7", 0)

    def test_digits_beat_letters(self):
        self.check("1.1", "1.a", 1)

    def test_alpha_suffix_is_greater_than_bare(self):
        self.check("1.0a", "1.0", 1)

    def test_separators_are_equivalent(self):
        self.check("1.0.1", "1_0-1", 0)

    def test_tilde_sorts_before_everything(self):
        self.check("1.0", "1.0~rc1", 1)
        self.check("1.0~rc2", "1.0~rc1", 1)
        self.check("1.0~rc1", "0.9", 1)

    def test_caret_sorts_after_bare_but_before_next(self):
        self.check("1.0^20240101", "1.0", 1)
        self.check("1.0.1", "1.0^20240101", 1)

    def test_empty_strings(self):
        self.assertEqual(rpmvercmp("", ""), 0)
        self.assertEqual(rpmvercmp("1", ""), 1)
        self.assertEqual(rpmvercmp("", "1"), -1)


class OddCharactersTest(unittest.TestCase):
    """str.isdigit() шире, чем \\d: «²» первому нравится, второму — нет.
    Раньше на таком входе разбор падал с AttributeError и уносил весь дифф."""

    SUP = "²"   # надстрочная двойка

    def test_pseudo_digit_against_digit(self):
        self.assertIsInstance(rpmvercmp("1." + self.SUP, "1.2"), int)
        self.assertIsInstance(rpmvercmp("1.2", "1." + self.SUP), int)

    def test_pseudo_digit_against_letters(self):
        self.assertIsInstance(rpmvercmp(self.SUP, "a"), int)
        self.assertIsInstance(rpmvercmp("a", self.SUP), int)

    def test_two_pseudo_digits_do_not_hang(self):
        self.assertIsInstance(rpmvercmp(self.SUP, "³"), int)
        self.assertEqual(rpmvercmp(self.SUP, self.SUP), 0)

    def test_comparison_is_antisymmetric(self):
        self.assertEqual(rpmvercmp("1." + self.SUP, "1.2"),
                         -rpmvercmp("1.2", "1." + self.SUP))

    def test_evr_with_a_pseudo_digit_does_not_raise(self):
        self.assertIsInstance(
            compare_evr((None, "1." + self.SUP, "1.el9"),
                        (None, "1.2", "1.el9")), int)


class CompareEvrTest(unittest.TestCase):
    def test_release_breaks_the_tie(self):
        self.assertEqual(compare_evr((None, "1.0", "2.el9"),
                                     (None, "1.0", "1.el9")), 1)

    def test_epoch_dominates(self):
        self.assertEqual(compare_evr((1, "1.0", "1"), (None, "9.0", "1")), 1)

    def test_missing_epoch_equals_zero(self):
        self.assertEqual(compare_evr((None, "1.0", "1"), (0, "1.0", "1")), 0)

    def test_full_equality(self):
        self.assertEqual(compare_evr((0, "1.0", "1.el9"),
                                     (0, "1.0", "1.el9")), 0)


if __name__ == "__main__":
    unittest.main()
