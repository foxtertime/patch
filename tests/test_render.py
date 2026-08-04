import json
import re
import unittest

from kojipatch.classify import Classifier
from kojipatch.diff import diff_chain
from kojipatch.model import Build, Patch, Snapshot, Source
from kojipatch.render import (PLACEHOLDER, build_page_data, render_html,
                              slug, to_msk)

RULES = [("CVE", r"CVE-\d{4}-\d{4,}"), ("SAST", r"(?i)^sast[-_]"),
         ("DAST", r"(?i)^dast[-_]"), ("other", ".*")]


def patch(name, cls):
    return Patch(path="PATCH/" + name, name=name, cls=cls, cves=[],
                 web_url="https://gl/blob/" + name)


def build(name, version="1.0", patches=(), problems=(), present=True,
          ref="main", ref_kind="branch", rpms=("a.x86_64",), tag_name=None,
          tags=()):
    source = None
    if ref is not None:
        source = Source(raw="git+ssh://git@h/g/%s?#origin/%s" % (name, ref),
                        host="h", project="g/" + name, ref=ref,
                        ref_kind=ref_kind, web_url="https://gl/tree")
    return Build(nvr="%s-%s-1.el9" % (name, version), name=name,
                 version=version, release="1.el9", build_id=1, task_id=2,
                 tag_name=tag_name, tags=list(tags),
                 owner="builder", completed="2026-05-14", source=source,
                 patch_dir_present=present, patches=list(patches),
                 rpms=list(rpms), problems=list(problems))


def snap(tag, builds):
    return Snapshot(tag=tag, generated="2026-08-03T13:20:00+03:00",
                    koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                    builds=list(builds))


class PageDataTest(unittest.TestCase):
    def setUp(self):
        self.classifier = Classifier(RULES)
        self.snapshot = snap("os-9.2", [
            build("nginx", patches=[patch("CVE-2024-7347.patch", "CVE"),
                                    patch("sast-x.patch", "SAST")]),
            build("curl", present=False),
            build("vim", ref=None, problems=["no source url"], present=None),
        ])

    def data(self, snapshots=None, pairs=None):
        snapshots = snapshots or [self.snapshot]
        return build_page_data(snapshots, pairs or [], self.classifier)

    def test_patch_classes_come_from_classifier(self):
        self.assertEqual(self.data()["patch_classes"],
                         ["CVE", "SAST", "DAST", "other"])

    def test_snapshot_counts(self):
        counts = self.data()["snapshots"][0]["counts"]
        self.assertEqual(counts["builds"], 3)
        self.assertEqual(counts["with_patches"], 1)
        self.assertEqual(counts["without_patches"], 1)
        self.assertEqual(counts["problems"], 1)
        self.assertEqual(counts["patch_files"], 2)
        self.assertEqual(counts["by_class"]["CVE"], {"builds": 1, "files": 1})
        self.assertEqual(counts["by_class"]["DAST"], {"builds": 0, "files": 0})

    def test_tags_keep_one_order_whatever_the_file_order(self):
        # порядок файлов в каталоге PATCH задаёт GitLab, и он разный от
        # репозитория к репозиторию. Колонка «теги» читается по месту:
        # если у одной строки cve первый, а у соседней второй, читать её
        # глазами невозможно
        forward = build("a", patches=[patch("CVE-2024-7347.patch", "CVE"),
                                      patch("sast-x.patch", "SAST")])
        backward = build("b", patches=[patch("SAST-x.patch", "SAST"),
                                       patch("cve-2024-7347.patch", "CVE")])
        rows = {r["name"]: r for r in
                self.data([snap("t", [forward, backward])])["snapshots"][0]["builds"]}
        self.assertEqual(rows["a"]["tags"], ["cve", "sast"])
        self.assertEqual(rows["b"]["tags"], ["cve", "sast"])

    def test_classes_go_in_classifier_order_not_alphabetically(self):
        # тот же порядок, что у карточек классов: конфиг перечислил
        # CVE, SAST, DAST — значит и в метках он такой
        row = self.data([snap("t", [build("a", patches=[
            patch("dast-x.patch", "DAST"),
            patch("sast-x.patch", "SAST"),
            patch("CVE-2024-7347.patch", "CVE")])])])["snapshots"][0]["builds"][0]
        self.assertEqual(row["tags"], ["cve", "sast", "dast"])

    def test_state_tags_follow_a_fixed_order(self):
        row = self.data([snap("t", [build(
            "a", tag_name="parent", present=False,
            problems=["gitlab: 404", "internal error: boom"],
            patches=[patch("CVE-2024-7347.patch", "CVE")])])]
        )["snapshots"][0]["builds"][0]
        self.assertEqual(row["tags"], ["cve", "inherited", "no-patch",
                                       "gitlab-error", "internal-error"])

    def test_direct_and_inherited_builds_are_told_apart(self):
        rows = self.data([snap("os-9.2", [
            build("nginx", tag_name="os-9.2"),
            build("curl", tag_name="os-9-base"),
            build("vim", tag_name=None)])])["snapshots"][0]["builds"]
        by_name = {r["name"]: r for r in rows}
        self.assertEqual(by_name["nginx"]["tagged_in"], "os-9.2")
        self.assertIs(by_name["nginx"]["inherited"], False)
        self.assertEqual(by_name["curl"]["tagged_in"], "os-9-base")
        self.assertIs(by_name["curl"]["inherited"], True)
        self.assertIn("inherited", by_name["curl"]["tags"])
        self.assertNotIn("inherited", by_name["nginx"]["tags"])
        # неизвестно — это не «прямой»: ни поля, ни метки
        self.assertIsNone(by_name["vim"]["tagged_in"])
        self.assertIsNone(by_name["vim"]["inherited"])
        self.assertNotIn("inherited", by_name["vim"]["tags"])

    def test_row_carries_the_other_koji_tags(self):
        row = self.data([snap("os-9.2", [build(
            "nginx", tag_name="os-9-base",
            tags=["os-9-base", "os-9.2-candidate"])])])["snapshots"][0]["builds"][0]
        self.assertEqual(row["koji_tags"], ["os-9-base", "os-9.2-candidate"])
        self.assertEqual(row["tagged_in"], "os-9-base")

    def test_koji_tags_are_empty_when_the_snapshot_has_none(self):
        row = self.data([snap("os-9.2", [build("nginx", tag_name="os-9.2")])]
                        )["snapshots"][0]["builds"][0]
        self.assertEqual(row["koji_tags"], [])

    def test_inherited_builds_are_counted(self):
        counts = self.data([snap("os-9.2", [
            build("nginx", tag_name="os-9.2"),
            build("curl", tag_name="os-9-base"),
            build("vim", tag_name="os-9-base")])])["snapshots"][0]["counts"]
        self.assertEqual(counts["inherited"], 2)
        self.assertEqual(counts["direct"], 1)

    def test_diff_tags_follow_a_fixed_order(self):
        # та же причина, что и в «Состоянии»: колонку читают по месту.
        # Статус всегда первый, дальше — что именно поехало
        old = snap("os-9.1", [build("nginx", "1.0", ref="a",
                                    tag_name="os-9-base",
                                    patches=[patch("old.patch", "other")],
                                    rpms=["nginx-1.0-1.el9.x86_64"])])
        new = snap("os-9.2", [build("nginx", "1.0", ref="b",
                                    tag_name="os-9.2",
                                    patches=[patch("new.patch", "other")],
                                    rpms=["nginx-1.0-1.el9.aarch64"])])
        row = self.data([old, new], diff_chain([old, new]))["pairs"][0]["rows"][0]
        self.assertEqual(row["tags"],
                         ["unchanged", "repackaged", "patches+", "patches-",
                          "branch-changed", "tag-changed"])

    def test_pair_rows_carry_both_tags(self):
        old = snap("os-9.1", [build("nginx", tag_name="os-9-base")])
        new = snap("os-9.2", [build("nginx", tag_name="os-9.2")])
        row = self.data([old, new], diff_chain([old, new]))["pairs"][0]["rows"][0]
        self.assertEqual(row["old_tagged_in"], "os-9-base")
        self.assertEqual(row["new_tagged_in"], "os-9.2")
        self.assertIs(row["old_inherited"], True)
        self.assertIs(row["new_inherited"], False)
        self.assertIn("tag-changed", row["tags"])

    def test_build_rpms_come_grouped_by_arch(self):
        # дашборд режет список на блоки по смене архитектуры, поэтому
        # порядок задаётся здесь, а не в браузере
        rows = self.data([snap("t", [build("nginx", rpms=[
            "nginx-1.0-1.el9.x86_64", "nginx-1.0-1.el9.src",
            "nginx-doc-1.0-1.el9.noarch", "nginx-core-1.0-1.el9.x86_64"])])])
        self.assertEqual(rows["snapshots"][0]["builds"][0]["rpms"], [
            "nginx-1.0-1.el9.src", "nginx-doc-1.0-1.el9.noarch",
            "nginx-1.0-1.el9.x86_64", "nginx-core-1.0-1.el9.x86_64"])

    def test_builds_are_sorted_by_name(self):
        rows = self.data()["snapshots"][0]["builds"]
        self.assertEqual([r["name"] for r in rows], ["curl", "nginx", "vim"])

    def test_build_row_fields(self):
        row = self.data()["snapshots"][0]["builds"][1]  # curl, nginx, vim
        self.assertEqual(row["name"], "nginx")
        self.assertEqual(row["evr"], "1.0-1.el9")
        self.assertEqual(row["branch"], "main")
        self.assertEqual(row["patch_counts"], {"CVE": 1, "SAST": 1})
        self.assertTrue(row["koji_url"].endswith("nginx-1.0-1.el9"))

    def test_row_tags_for_patch_classes(self):
        rows = {r["name"]: r for r in self.data()["snapshots"][0]["builds"]}
        self.assertEqual(sorted(rows["nginx"]["tags"]), ["cve", "sast"])
        self.assertIn("no-patch", rows["curl"]["tags"])
        self.assertIn("no-source", rows["vim"]["tags"])

    def test_class_tag_uses_the_dashboard_slug_rule(self):
        # ключ фильтра в карточке класса считает slug() из дашборда:
        # /[^a-z0-9]+/g → '-'. Тег строки обязан считаться так же, иначе
        # карточка класса «C++» не нашла бы ни одной строки.
        classifier = Classifier([("C++", r"\.cpp$"), ("other", ".*")])
        rows = build_page_data(
            [snap("t", [build("x", patches=[patch("a.cpp", "C++")])])],
            [], classifier)["snapshots"][0]["builds"]
        self.assertIn("c-", rows[0]["tags"])

    def test_slug_matches_the_javascript_rule(self):
        for name, expected in (("CVE", "cve"), ("C++", "c-"),
                               ("Fix_it now", "fix-it-now"), ("DAST", "dast")):
            self.assertEqual(slug(name), expected, name)

    def test_gitlab_error_tag(self):
        broken = build("bad", problems=["gitlab: 403 Forbidden"], present=None)
        rows = self.data([snap("t", [broken])])["snapshots"][0]["builds"]
        self.assertIn("gitlab-error", rows[0]["tags"])

    def test_from_commit_tag(self):
        commit = build("c", ref="a1b2c3d", ref_kind="commit")
        rows = self.data([snap("t", [commit])])["snapshots"][0]["builds"]
        self.assertIn("from-commit", rows[0]["tags"])

    def test_internal_error_tag(self):
        broken = build("bad", problems=["internal error: boom"], present=None)
        rows = self.data([snap("t", [broken])])["snapshots"][0]["builds"]
        self.assertIn("internal-error", rows[0]["tags"])

    def test_gitlab_error_does_not_imply_internal_error(self):
        broken = build("bad", problems=["gitlab: 403 Forbidden"], present=None)
        rows = self.data([snap("t", [broken])])["snapshots"][0]["builds"]
        self.assertNotIn("internal-error", rows[0]["tags"])

    def test_pairs_are_rendered(self):
        old = snap("os-9.1", [build("nginx", "1.0"), build("gone")])
        new = snap("os-9.2", [build("nginx", "1.1"), build("fresh")])
        data = self.data([old, new], diff_chain([old, new]))
        pair = data["pairs"][0]
        self.assertEqual((pair["old"], pair["new"]), ("os-9.1", "os-9.2"))
        rows = {r["name"]: r for r in pair["rows"]}
        self.assertEqual(rows["nginx"]["old_evr"], "1.0-1.el9")
        self.assertEqual(rows["nginx"]["new_evr"], "1.1-1.el9")
        self.assertIn("upgraded", rows["nginx"]["tags"])
        self.assertEqual(rows["gone"]["status"], "removed")
        self.assertEqual(pair["counts"]["added"], 1)

    def test_pair_rows_carry_aligned_rpm_rows(self):
        # фронтенду отдаются готовые строки «было/стало», а не два списка:
        # выравнивание считается один раз здесь и покрыто тестами diff
        old = snap("os-9.1", [build("nginx", "1.0",
                                    rpms=["nginx-1.0-1.el9.x86_64",
                                          "nginx-mod-1.0-1.el9.x86_64"])])
        new = snap("os-9.2", [build("nginx", "1.1",
                                    rpms=["nginx-1.1-1.el9.x86_64"])])
        row = self.data([old, new], diff_chain([old, new]))["pairs"][0]["rows"][0]
        self.assertEqual(row["rpm_rows"],
                         [["nginx-1.0-1.el9.x86_64", "nginx-1.1-1.el9.x86_64"],
                          ["nginx-mod-1.0-1.el9.x86_64", None]])
        self.assertNotIn("old_rpms", row)
        self.assertNotIn("new_rpms", row)

    def test_summary_pair_is_marked(self):
        snaps = [snap("a", []), snap("b", []), snap("c", [])]
        data = self.data(snaps, diff_chain(snaps))
        self.assertTrue(data["pairs"][-1]["summary"])


class MoscowTimeTest(unittest.TestCase):
    """UTC из снапшота показывается в московском времени."""

    def test_utc_becomes_msk(self):
        self.assertEqual(to_msk("2026-05-14 10:11:12"), "2026-05-14 13:11:12")

    def test_conversion_crosses_midnight(self):
        # ровно за этим и нужен перевод даты, а не одного часа
        self.assertEqual(to_msk("2026-05-14 22:30:00"), "2026-05-15 01:30:00")

    def test_conversion_crosses_a_month(self):
        self.assertEqual(to_msk("2026-05-31 23:00:00"), "2026-06-01 02:00:00")

    def test_date_without_time_is_left_alone(self):
        # снапшот прежней версии: часа нет, и придумывать его нельзя —
        # прибавив три часа к полуночи, мы бы утверждали то, чего не знаем
        self.assertEqual(to_msk("2026-05-14"), "2026-05-14")

    def test_unparsable_value_survives_as_is(self):
        self.assertEqual(to_msk("когда-то давно"), "когда-то давно")

    def test_empty_values(self):
        self.assertIsNone(to_msk(None))
        self.assertEqual(to_msk(""), "")

    def test_build_row_carries_moscow_time(self):
        rows = build_page_data(
            [snap("t", [build("nginx")])], [], Classifier(RULES)
        )["snapshots"][0]["builds"]
        # фикстура собрана в 2026-05-14 без времени — остаётся как есть
        self.assertEqual(rows[0]["completed"], "2026-05-14")

    def test_build_row_shifts_a_full_timestamp(self):
        one = build("nginx")
        one.completed = "2026-05-14 22:30:00"
        rows = build_page_data([snap("t", [one])], [], Classifier(RULES)
                               )["snapshots"][0]["builds"]
        self.assertEqual(rows[0]["completed"], "2026-05-15 01:30:00")


class RenderHtmlTest(unittest.TestCase):
    def setUp(self):
        self.classifier = Classifier(RULES)
        self.snapshots = [snap("os-9.2", [build("nginx")])]

    def html(self, snapshots=None):
        return render_html(snapshots or self.snapshots, [], self.classifier)

    def test_no_placeholder_remains(self):
        self.assertNotIn(PLACEHOLDER, self.html())

    def test_embedded_json_parses(self):
        match = re.search(r"var DATA = (.*?);\n", self.html(), re.S)
        self.assertIsNotNone(match)
        data = json.loads(match.group(1))
        self.assertEqual(data["snapshots"][0]["tag"], "os-9.2")

    def test_script_close_tag_is_escaped(self):
        nasty = build("evil</script><script>alert(1)</script>")
        html = self.html([snap("t", [nasty])])
        self.assertNotIn("</script><script>alert(1)", html)
        self.assertIn("<\\/script>", html)

    def test_line_separators_are_escaped(self):
        # U+2028/U+2029 внутри <script> — переводы строк для JS, а JSON их
        # не экранирует: литерал развалился бы прямо по данным.
        nasty = build("evil" + chr(0x2028) + "x" + chr(0x2029) + "y")
        html = self.html([snap("t", [nasty])])
        self.assertNotIn(chr(0x2028), html)
        self.assertNotIn(chr(0x2029), html)
        self.assertIn("\\u2028", html)
        self.assertIn("\\u2029", html)
        match = re.search(r"var DATA = (.*?);\n", html, re.S)
        self.assertEqual(json.loads(match.group(1))["snapshots"][0]["tag"], "t")

    def test_html_has_both_tab_containers(self):
        html = self.html()
        self.assertIn('id="tab-state"', html)
        self.assertIn('id="tab-diff"', html)


class TemplateContractTest(unittest.TestCase):
    def setUp(self):
        self.classifier = Classifier(RULES)
        old = snap("os-9.1", [build("nginx", "1.0")])
        new = snap("os-9.2", [build("nginx", "1.1",
                                    patches=[patch("CVE-2024-7347.patch", "CVE")])])
        from kojipatch.diff import diff_chain as chain
        self.html = render_html([old, new], chain([old, new]), self.classifier)

    def test_has_tab_navigation(self):
        self.assertIn('data-tab="state"', self.html)
        self.assertIn('data-tab="diff"', self.html)

    def test_has_search_and_expand_controls(self):
        self.assertIn('id="q"', self.html)
        self.assertIn('id="expand"', self.html)

    def test_has_active_filter_chip_bar(self):
        self.assertIn('id="chips"', self.html)

    def test_has_copy_nvr_button(self):
        self.assertIn('id="copy-nvr"', self.html)

    def test_reuses_ref_html_css_variables(self):
        for name in ("--bg", "--fg", "--muted", "--line", "--card",
                     "--accent", "--added", "--removed", "--hit"):
            self.assertIn(name, self.html, name)

    def test_supports_dark_theme(self):
        self.assertIn("prefers-color-scheme: dark", self.html)

    def test_diff_tab_starts_filtered_to_changed_rows(self):
        # обещание спеки и README: «Изменения» открываются на изменившихся
        self.assertIn("diff: { 'changed': 1 }", self.html)

    def test_search_is_debounced(self):
        self.assertIn("SEARCH_DELAY", self.html)

    def test_pair_lives_in_the_hash_by_tag_names(self):
        self.assertIn("function pairKey(", self.html)
        self.assertNotIn("'pair=' + st.pair", self.html)

    def test_version_sort_is_documented_as_lexicographic(self):
        self.assertIn("Сортировка лексикографическая", self.html)

    def test_tooltip_container_present(self):
        self.assertIn('id="tip"', self.html)

    def test_no_external_resources(self):
        for marker in ("<script src=", "<link rel=\"stylesheet\"", "https://cdn",
                       "@import"):
            self.assertNotIn(marker, self.html, marker)


class LoggingTest(unittest.TestCase):
    def test_page_size_is_logged_at_debug(self):
        classifier = Classifier(RULES)
        old = snap("os-9.1", [build("nginx", "1.0")])
        new = snap("os-9.2", [build("nginx", "1.1")])
        from kojipatch.diff import diff_chain as chain
        with self.assertLogs("kojipatch", level="DEBUG") as caught:
            render_html([old, new], chain([old, new]), classifier)
        line = "\n".join(caught.output)
        self.assertIn("kojipatch.render", line)
        self.assertIn("kojipatch.diff", line)


if __name__ == "__main__":
    unittest.main()
