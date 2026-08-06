"""Сборка страницы: шаблон, стили и скрипты в одном файле."""
import re
import unittest

from dashboard import __version__
from dashboard.build import STYLES, SCRIPTS, BuildError, build_html
from dashboard.config import DEFAULT_PATCH_CLASSES

RICH = "tests/fixtures/rich-old.json"


class BuildHtml(unittest.TestCase):
    def test_no_placeholder_remains(self):
        html = build_html()
        self.assertNotIn("<!--__SCRIPTS__-->", html)
        self.assertNotIn("<!--__STYLES__-->", html)
        self.assertNotIn("__DASHBOARD_VERSION__", html)

    def test_version_is_stamped_into_the_page(self):
        # Страницу пересылают файлом, и у того, кто её открыл, исходников
        # под рукой нет: чем собрана, должно быть видно в ней самой.
        html = build_html()
        self.assertIn('<meta name="generator" content="dashboard %s">'
                      % __version__, html)
        self.assertIn('<span class="ver">%s</span>' % __version__, html)

    def test_every_script_is_inlined(self):
        html = build_html()
        for name in SCRIPTS:
            self.assertIn("/* %s */" % name, html,
                          "в собранном файле нет %s" % name)

    def test_scripts_go_in_dependency_order(self):
        html = build_html()
        positions = [html.index("/* %s */" % name) for name in SCRIPTS]
        self.assertEqual(positions, sorted(positions))

    def test_every_style_is_inlined(self):
        html = build_html()
        for name in STYLES:
            self.assertIn("/* %s */" % name, html,
                          "в собранном файле нет %s" % name)

    def test_styles_keep_cascade_order(self):
        # При равной специфичности выигрывает то, что ниже: перестановка
        # файлов в STYLES молча меняет вид страницы.
        html = build_html()
        positions = [html.index("/* %s */" % name) for name in STYLES]
        self.assertEqual(positions, sorted(positions))

    def test_styles_go_before_scripts(self):
        # Стили стоят в head, скрипты — в конце body: страница не должна
        # успеть показаться неоформленной.
        html = build_html()
        self.assertLess(html.index("/* base.css */"), html.index("/* ui.js */"))

    def test_no_external_resources(self):
        """Дашборд открывают там, где интернета нет."""
        html = build_html()
        self.assertNotIn("http://", html.split("<script")[0])
        self.assertNotRegex(html, r"<(script|link)[^>]+src=\"https?:")
        for marker in ("<script src=", "<link rel=\"stylesheet\"",
                       "https://cdn", "@import"):
            self.assertNotIn(marker, html, marker)

    def test_empty_dashboard_carries_no_data(self):
        # данные страницы больше не запекает питон: их подгружают в
        # браузере, и имени KP_SNAPSHOTS в собранном файле нет вовсе.
        self.assertNotIn("KP_SNAPSHOTS", build_html())

    def test_missing_template_is_reported(self):
        with self.assertRaises(BuildError):
            build_html(template_path="/nope/dashboard.html")

    def test_template_without_placeholder_is_reported(self):
        # Любого из трёх плейсхолдеров достаточно, чтобы сборка отказалась:
        # страница без стилей или без скриптов открылась бы молча сломанной.
        with self.assertRaises(BuildError):
            build_html(template_path=RICH)


class TemplateContractTest(unittest.TestCase):
    """Разметка, на которую опирается ui.js, и обещания README."""

    def setUp(self):
        self.html = build_html()

    def test_every_default_class_has_its_own_colour(self):
        # Класс, которого страница не знает, красится общим акцентом — и
        # полоска состава начинает показывать два разных класса одним
        # цветом. Заводя класс, легко забыть про цвет: тест об этом скажет.
        for name, _ in DEFAULT_PATCH_CLASSES:
            key = name.lower()
            self.assertIn("--%s:" % key, self.html, name)
            self.assertIn(".meter i.c-%s" % key, self.html, name)
            self.assertIn('"%s": 1' % key, self.html, name)

    def test_html_has_both_tab_containers(self):
        self.assertIn('id="tab-state"', self.html)
        self.assertIn('id="tab-diff"', self.html)

    def test_has_tab_navigation(self):
        self.assertIn('data-tab="state"', self.html)
        self.assertIn('data-tab="diff"', self.html)

    def test_has_search_and_expand_controls(self):
        self.assertIn('id="q"', self.html)
        self.assertIn('id="expand"', self.html)

    def test_has_a_filter_menu(self):
        # Поставленные фильтры больше не стоят строкой чипов под панелью:
        # их показывает и правит меню под кнопкой.
        self.assertIn('id="filters"', self.html)
        self.assertIn('id="filtermenu"', self.html)
        self.assertNotIn('id="chips"', self.html)

    def test_has_copy_nvr_button(self):
        self.assertIn('id="copy-nvr"', self.html)

    def test_tooltip_container_present(self):
        self.assertIn('id="tip"', self.html)

    def test_every_element_the_script_asks_for_exists(self):
        # Расхождение id между шаблоном и скриптом ничего не ломает в
        # тестах, но страница молча перестаёт рисоваться: getElementById
        # вернёт null уже при загрузке.
        wanted = set()
        for call in re.findall(r"getElementById\(([^)]*)\)", self.html):
            # id выбирается тернарником — тогда строка слева от «?» это
            # условие, а не имя элемента
            call = re.sub(r"[=!]==\s*'[^']*'", "", call)
            wanted.update(re.findall(r"'([^']+)'", call))
        self.assertTrue(wanted, "в странице нет ни одного getElementById")
        for name in sorted(wanted):
            self.assertIn('id="%s"' % name, self.html, name)

    def test_has_a_drop_zone(self):
        self.assertIn('id="drop"', self.html)
        self.assertIn("Перетащите снапшоты сюда", self.html)

    def test_has_a_file_picker(self):
        self.assertIn('type="file"', self.html)

    def test_has_a_sources_panel(self):
        # Состав снапшотов весь на рельсе: отдельного списка источников со
        # своими кнопками у страницы нет.
        self.assertIn('id="sources"', self.html)
        self.assertIn('id="chain"', self.html)
        self.assertNotIn('id="sourcelist"', self.html)

    def test_hidden_panels_really_hide(self):
        # display: flex у .tabs сильнее hidden из стилей браузера: без
        # своего правила спрятанная полоса вкладок осталась бы видна.
        # Панели источников это не касается: своего display у неё нет.
        self.assertIn(".tabs[hidden] { display: none; }", self.html)
        self.assertNotIn(".sources { display: flex", self.html)

    def test_toasts_live_outside_the_empty_screen(self):
        # Экран загрузки прячется, как только появились данные. Окошко
        # сообщения внутри него было бы невидимо ровно тогда, когда нужно.
        start = self.html.index('<section id="tab-empty">')
        end = self.html.index("</section>", start)
        at = self.html.index('id="toasts"')
        self.assertFalse(start < at < end)

    def test_marks_wrap_inside_their_cell(self):
        # Меток у строки бывает полтора десятка, и в одну строку они
        # растягивали таблицу за край окна вместе со всей страницей:
        # обёртка таблицы не прокручивается, поэтому уезжала вся страница.
        self.assertIn("td.marks { white-space: normal; }", self.html)
        self.assertNotIn("td.marks { white-space: nowrap", self.html)
        # А сама метка не переносится: разорванная посередине, она
        # перестаёт читаться как метка.
        self.assertRegex(self.html, r"\.mark \{[^}]*white-space: nowrap")

    def test_the_rail_gap_label_holds_its_own_width(self):
        # Подпись над отрезком стояла absolute и ширины ему не добавляла:
        # отрезок сжимался до предела, а подпись, торчащая из него в обе
        # стороны, ложилась на соседние узлы. Теперь она в потоке, и
        # собственного min-width у отрезка нет — его держит содержимое.
        self.assertRegex(self.html, r"\.gap \{[^}]*grid-row: 1")
        self.assertNotRegex(self.html, r"\.gap \{[^}]*position: absolute")
        self.assertNotRegex(self.html, r"\n\.rl \{[^}]*min-width")

    def test_the_rail_has_no_scrollbar(self):
        # Полосу прокрутки под рельсом заменило колесо мыши; обработчик
        # живёт в rail.js, и без него рельс стал бы непрокручиваемым.
        self.assertRegex(self.html, r"\.chain \{[^}]*scrollbar-width: none")
        self.assertIn("box.addEventListener('wheel'", self.html)

    def test_reuses_ref_html_css_variables(self):
        for name in ("--bg", "--fg", "--muted", "--line", "--card",
                     "--accent", "--added", "--removed", "--hit"):
            self.assertIn(name, self.html, name)

    def test_page_is_dark_only(self):
        """Тема одна, и это выбор, а не умолчание.

        color-scheme говорит о нём браузеру: без него полосы прокрутки и
        внутренности поля поиска остаются светлыми. Заодно сторожим, что
        светлая ветка не вернётся половинчато: перекрытие по
        prefers-color-scheme на странице с одной темой означало бы, что
        часть цветов живёт по одним правилам, а часть по другим.
        """
        self.assertIn("color-scheme: dark", self.html)
        self.assertNotIn("prefers-color-scheme", self.html)

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

    def test_page_data_is_counted_in_the_browser(self):
        # смысл всей задачи: данные страницы считает viewmodel.js, а не
        # питон, запёкший готовый DATA в шаблон
        self.assertIn("viewmodel.buildPageData(", self.html)
        self.assertNotIn("/*__DATA__*/", self.html)


class LoggingTest(unittest.TestCase):
    def test_page_size_is_logged_at_debug(self):
        with self.assertLogs("dashboard", level="DEBUG") as caught:
            build_html()
        self.assertIn("dashboard.build", "\n".join(caught.output))


if __name__ == "__main__":
    unittest.main()
