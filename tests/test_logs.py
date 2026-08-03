import io
import logging
import unittest

from kojipatch import logs


class ConfigureTest(unittest.TestCase):
    def tearDown(self):
        root = logging.getLogger("kojipatch")
        for handler in list(root.handlers):
            if not isinstance(handler, logging.NullHandler):
                root.removeHandler(handler)
        root.setLevel(logging.NOTSET)

    def capture(self, level):
        stream = io.StringIO()
        logs.configure(level, stream=stream)
        return stream

    def test_info_level_shows_info_and_hides_debug(self):
        stream = self.capture("info")
        logging.getLogger("kojipatch.collect").info("видно")
        logging.getLogger("kojipatch.collect").debug("не видно")
        self.assertIn("видно", stream.getvalue())
        self.assertNotIn("не видно", stream.getvalue())

    def test_warning_level_hides_info(self):
        stream = self.capture("warning")
        logging.getLogger("kojipatch.collect").info("тихо")
        logging.getLogger("kojipatch.collect").warning("громко")
        self.assertNotIn("тихо", stream.getvalue())
        self.assertIn("громко", stream.getvalue())

    def test_logger_name_is_short(self):
        stream = self.capture("info")
        logging.getLogger("kojipatch.gitlabclient").info("сообщение")
        # kojipatch.gitlabclient → gitlab: длинное имя в каждой строке
        # съедает ширину терминала и ничего не добавляет
        self.assertIn("gitlab: сообщение", stream.getvalue())
        self.assertNotIn("kojipatch.gitlabclient", stream.getvalue())

    def test_koji_client_name_is_short_too(self):
        stream = self.capture("info")
        logging.getLogger("kojipatch.kojiclient").info("сообщение")
        self.assertIn("koji: сообщение", stream.getvalue())

    def test_plain_module_name_is_kept(self):
        stream = self.capture("info")
        logging.getLogger("kojipatch.collect").info("сообщение")
        self.assertIn("collect: сообщение", stream.getvalue())

    def test_debug_format_carries_thread_name(self):
        stream = self.capture("debug")
        logging.getLogger("kojipatch.collect").debug("сообщение")
        self.assertIn("MainThread", stream.getvalue())

    def test_info_format_has_no_thread_name(self):
        stream = self.capture("info")
        logging.getLogger("kojipatch.collect").info("сообщение")
        self.assertNotIn("MainThread", stream.getvalue())

    def test_level_is_in_the_line(self):
        stream = self.capture("info")
        logging.getLogger("kojipatch.collect").warning("сообщение")
        self.assertIn("WARNING", stream.getvalue())

    def test_second_configure_does_not_duplicate_lines(self):
        stream = io.StringIO()
        logs.configure("info", stream=stream)
        logs.configure("info", stream=stream)
        logging.getLogger("kojipatch.collect").info("один раз")
        self.assertEqual(stream.getvalue().count("один раз"), 1)

    def test_unknown_level_raises(self):
        with self.assertRaises(ValueError):
            logs.configure("verbose")

    def test_levels_table_is_complete(self):
        self.assertEqual(sorted(logs.LEVELS),
                         ["debug", "error", "info", "warning"])
        self.assertEqual(logs.DEFAULT_LEVEL, "info")

    def test_package_logger_has_a_null_handler(self):
        # библиотека не должна сыпать в чужой вывод, если её импортировали
        # без настройки логирования
        import kojipatch  # noqa: F401 — нужен сам импорт, он вешает NullHandler
        handlers = logging.getLogger("kojipatch").handlers
        self.assertTrue(any(isinstance(h, logging.NullHandler)
                            for h in handlers))


if __name__ == "__main__":
    unittest.main()
