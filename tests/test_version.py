"""Версия инструмента: одна на всех и названная там, где её ищут.

Номер живёт в одном месте, `dashboard/__init__.py`, и оттуда расходится по
CLI, снапшоту и собранной странице. Тесты здесь сторожат сам номер и два
его выхода наружу — флаг и CHANGELOG; про снапшот сказано в test_model, про
страницу — в test_build.
"""
import io
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout

from dashboard import __version__
from dashboard.build import VERSION_TOKEN, BuildError, build_html
from dashboard.cli import main

ROOT = os.path.join(os.path.dirname(__file__), "..")
CHANGELOG = os.path.join(ROOT, "CHANGELOG.md")


class VersionTest(unittest.TestCase):
    def test_version_is_three_numbers(self):
        # Форма важна не сама по себе: по ней читают обещание о
        # совместимости, и «1.0» или «1.0.0-dev» его не дают.
        self.assertRegex(__version__, r"^\d+\.\d+\.\d+$")

    def test_flag_prints_version_and_exits_zero(self):
        # Подкоманда у CLI обязательна, но версию спрашивают как раз тогда,
        # когда собирать нечего: разбор обязан кончиться на самом флаге.
        out = io.StringIO()
        with self.assertRaises(SystemExit) as caught, redirect_stdout(out):
            main(["--version"])
        self.assertEqual(caught.exception.code, 0)
        self.assertEqual(out.getvalue().strip(), "dashboard " + __version__)

    def test_changelog_names_the_current_version(self):
        # Версия без записи о том, что в ней изменилось, — номер, за которым
        # ничего не стоит. Тест держит эти две вещи вместе.
        with open(CHANGELOG, "r", encoding="utf-8") as handle:
            text = handle.read()
        self.assertIn("## %s " % __version__, text)


class TemplateTokenTest(unittest.TestCase):
    def test_template_without_the_version_token_is_reported(self):
        # Пропавший в шаблоне токен ничего не ломает на глаз: страница
        # соберётся, просто без версии — а узнают об этом у того, кому её
        # прислали.
        room = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, room)
        template = os.path.join(room, "dashboard.html")
        with open(template, "w", encoding="utf-8") as handle:
            handle.write("<html><!--__SCRIPTS__--></html>")
        with self.assertRaises(BuildError):
            build_html(template_path=template)

    def test_stamped_page_keeps_no_token(self):
        self.assertNotIn(VERSION_TOKEN, build_html())
