import io
import logging
import unittest

from dashboard import logs


class ConfigureTest(unittest.TestCase):
    def setUp(self):
        self._propagate = logging.getLogger("dashboard").propagate

    def tearDown(self):
        root = logging.getLogger("dashboard")
        for handler in list(root.handlers):
            if not isinstance(handler, logging.NullHandler):
                root.removeHandler(handler)
        root.setLevel(logging.NOTSET)
        root.propagate = self._propagate

    def capture(self, level):
        stream = io.StringIO()
        logs.configure(level, stream=stream)
        return stream

    def test_info_level_shows_info_and_hides_debug(self):
        stream = self.capture("info")
        logging.getLogger("dashboard.collect").info("видно")
        logging.getLogger("dashboard.collect").debug("не видно")
        self.assertIn("видно", stream.getvalue())
        self.assertNotIn("не видно", stream.getvalue())

    def test_warning_level_hides_info(self):
        stream = self.capture("warning")
        logging.getLogger("dashboard.collect").info("тихо")
        logging.getLogger("dashboard.collect").warning("громко")
        self.assertNotIn("тихо", stream.getvalue())
        self.assertIn("громко", stream.getvalue())

    def test_logger_name_is_short(self):
        stream = self.capture("info")
        logging.getLogger("dashboard.gitlabclient").info("сообщение")
        # dashboard.gitlabclient → gitlab: длинное имя в каждой строке
        # съедает ширину терминала и ничего не добавляет
        self.assertIn("gitlab: сообщение", stream.getvalue())
        self.assertNotIn("dashboard.gitlabclient", stream.getvalue())

    def test_koji_client_name_is_short_too(self):
        stream = self.capture("info")
        logging.getLogger("dashboard.kojiclient").info("сообщение")
        self.assertIn("koji: сообщение", stream.getvalue())

    def test_plain_module_name_is_kept(self):
        stream = self.capture("info")
        logging.getLogger("dashboard.collect").info("сообщение")
        self.assertIn("collect: сообщение", stream.getvalue())

    def test_debug_format_carries_thread_name(self):
        stream = self.capture("debug")
        logging.getLogger("dashboard.collect").debug("сообщение")
        self.assertIn("MainThread", stream.getvalue())

    def test_info_format_has_no_thread_name(self):
        stream = self.capture("info")
        logging.getLogger("dashboard.collect").info("сообщение")
        self.assertNotIn("MainThread", stream.getvalue())

    def test_level_is_in_the_line(self):
        stream = self.capture("info")
        logging.getLogger("dashboard.collect").warning("сообщение")
        self.assertIn("WARNING", stream.getvalue())

    def test_second_configure_does_not_duplicate_lines(self):
        stream = io.StringIO()
        logs.configure("info", stream=stream)
        logs.configure("info", stream=stream)
        logging.getLogger("dashboard.collect").info("один раз")
        self.assertEqual(stream.getvalue().count("один раз"), 1)

    def test_unknown_level_raises(self):
        with self.assertRaises(ValueError):
            logs.configure("verbose")

    def test_teardown_restores_the_propagate_flag(self):
        # запускаем настоящий тест целиком, вместе с его setUp и tearDown,
        # и смотрим на глобальное состояние после: если tearDown перестанет
        # восстанавливать флаг, этот тест упадёт
        root = logging.getLogger("dashboard")
        before = root.propagate
        case = ConfigureTest("test_info_level_shows_info_and_hides_debug")
        result = unittest.TestResult()
        case.run(result)
        self.assertEqual(result.errors + result.failures, [])
        self.assertEqual(root.propagate, before)

    def test_levels_table_is_complete(self):
        self.assertEqual(sorted(logs.LEVELS),
                         ["debug", "error", "info", "warning"])
        self.assertEqual(logs.DEFAULT_LEVEL, "info")

    def test_package_logger_has_a_null_handler(self):
        # библиотека не должна сыпать в чужой вывод, если её импортировали
        # без настройки логирования
        import dashboard  # noqa: F401 — нужен сам импорт, он вешает NullHandler
        handlers = logging.getLogger("dashboard").handlers
        self.assertTrue(any(isinstance(h, logging.NullHandler)
                            for h in handlers))


if __name__ == "__main__":
    unittest.main()
