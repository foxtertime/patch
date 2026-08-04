import unittest

from kojipatch.rpms import arch_of, sort_rpms


class ArchOfTest(unittest.TestCase):
    def test_arch_is_the_tail_after_the_last_dot(self):
        self.assertEqual(arch_of("httpd-2.4.62-4.el9.x86_64"), "x86_64")

    def test_version_dots_do_not_confuse_it(self):
        self.assertEqual(arch_of("python3-perf-5.14.0-611.34.1.el9_7.aarch64"),
                         "aarch64")

    def test_source_rpm(self):
        self.assertEqual(arch_of("httpd-2.4.62-4.el9.src"), "src")

    def test_key_without_version_release_also_works(self):
        # ключ подпакета из diff — тот же name.arch
        self.assertEqual(arch_of("httpd-core.noarch"), "noarch")

    def test_string_without_a_dot(self):
        # koji такого не отдаёт, но пустая колонка «архитектура» хуже,
        # чем честный вопросительный знак
        self.assertEqual(arch_of("strange"), "?")


class SortRpmsTest(unittest.TestCase):
    def test_src_then_noarch_then_the_rest(self):
        got = sort_rpms(["a-1-1.x86_64", "a-1-1.noarch", "a-1-1.src"])
        self.assertEqual([arch_of(x) for x in got], ["src", "noarch", "x86_64"])

    def test_other_arches_go_alphabetically(self):
        got = sort_rpms(["a-1-1.x86_64", "a-1-1.aarch64", "a-1-1.ppc64le"])
        self.assertEqual([arch_of(x) for x in got],
                         ["aarch64", "ppc64le", "x86_64"])

    def test_inside_an_arch_packages_are_sorted_by_name(self):
        got = sort_rpms(["zlib-1-1.x86_64", "acl-1-1.x86_64", "mc-1-1.x86_64"])
        self.assertEqual(got, ["acl-1-1.x86_64", "mc-1-1.x86_64",
                               "zlib-1-1.x86_64"])

    def test_grouping_wins_over_the_name(self):
        # «zlib.src» стоит выше «acl.x86_64»: сначала группа, потом имя
        got = sort_rpms(["acl-1-1.x86_64", "zlib-1-1.src"])
        self.assertEqual(got, ["zlib-1-1.src", "acl-1-1.x86_64"])

    def test_empty_list(self):
        self.assertEqual(sort_rpms([]), [])


if __name__ == "__main__":
    unittest.main()
