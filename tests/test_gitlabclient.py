import logging
import unittest

from kojipatch.config import GitlabHost
from kojipatch.gitlabclient import GitlabClient
from tests.fakes import FakeTransport, Response

HOSTS = {"gitlab.example.com": GitlabHost(api="https://gitlab.example.com/api/v4",
                                          web="https://gitlab.example.com")}
TREE_URL = "https://gitlab.example.com/api/v4/projects/g%2Fr/repository/tree"
COMMITS_URL = "https://gitlab.example.com/api/v4/projects/g%2Fr/repository/commits/br"
# токен в тестах непременно должен быть похож на настоящий: односимвольный
# затирался бы очисткой в любом постороннем тексте и прятал бы её ошибки
TOKEN = "glpat-t0ken"
SECRET = "glpat-SECRET123"

TWO_FILES = Response(200, [
    {"id": "1", "name": "CVE-2024-7347.patch", "type": "blob",
     "path": "PATCH/CVE-2024-7347.patch"},
    {"id": "2", "name": "sub", "type": "tree", "path": "PATCH/sub"},
    {"id": "3", "name": "sast-x.patch", "type": "blob",
     "path": "PATCH/sub/sast-x.patch"},
], {})


def client(routes, **kwargs):
    transport = FakeTransport(routes)
    return GitlabClient(HOSTS, token=TOKEN, transport=transport,
                        sleeper=lambda _s: None, **kwargs), transport


class PatchFilesTest(unittest.TestCase):
    def test_blobs_are_returned_trees_are_not(self):
        cli, _ = client({TREE_URL: TWO_FILES})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertTrue(result.present)
        self.assertEqual(result.paths,
                         ["PATCH/CVE-2024-7347.patch", "PATCH/sub/sast-x.patch"])
        self.assertIsNone(result.problem)

    def test_project_is_url_encoded_and_params_are_set(self):
        cli, transport = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "feat/x")
        url, params, headers = transport.requests[0]
        self.assertEqual(url, TREE_URL)
        self.assertEqual(params["ref"], "feat/x")
        self.assertEqual(params["path"], "PATCH")
        self.assertTrue(params["recursive"])
        self.assertEqual(headers["PRIVATE-TOKEN"], TOKEN)

    def test_tree_not_found_means_no_patch_dir(self):
        cli, transport = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(200, {"id": "abc123"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIs(result.present, False)
        self.assertEqual(result.paths, [])
        self.assertIsNone(result.problem)
        self.assertEqual(len(transport.requests), 2)

    def test_missing_ref_after_tree_not_found_is_a_problem(self):
        cli, transport = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(404, {"message": "404 Commit Not Found"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("ref not found", result.problem)
        self.assertEqual(len(transport.requests), 2)

    def test_disambiguation_failure_is_a_problem_not_a_missing_ref(self):
        cli, transport = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(403, {"message": "403 Forbidden"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("403", result.problem)
        self.assertNotIn("ref not found", result.problem)
        self.assertEqual(len(transport.requests), 2)

    def test_missing_tree_disambiguation_is_memoized(self):
        cli, transport = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(200, {"id": "abc123"}, {}),
        })
        cli.patch_files("gitlab.example.com", "g/r", "br")
        cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(len(transport.requests), 2)

    def test_invalid_revision_or_path_means_no_patch_dir(self):
        # так отвечает GitLab на отсутствующий путь в существующей ветке:
        # формулировка отличается от «404 Tree Not Found», а смысл тот же
        cli, transport = client({
            TREE_URL: Response(
                404, {"message": "404 invalid revision or path Not Found"}, {}),
            COMMITS_URL: Response(200, {"id": "abc123"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIs(result.present, False)
        self.assertEqual(result.paths, [])
        self.assertIsNone(result.problem)
        self.assertEqual(len(transport.requests), 2)

    def test_invalid_revision_or_path_with_missing_ref_is_a_problem(self):
        cli, _ = client({
            TREE_URL: Response(
                404, {"message": "404 invalid revision or path Not Found"}, {}),
            COMMITS_URL: Response(404, {"message": "404 Commit Not Found"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("ref not found", result.problem)

    def test_error_key_404_is_disambiguated_too(self):
        # часть версий кладёт причину в error, а не в message
        cli, _ = client({
            TREE_URL: Response(404, {"error": "invalid revision or path"}, {}),
            COMMITS_URL: Response(200, {"id": "abc123"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIs(result.present, False)
        self.assertIsNone(result.problem)

    def test_404_without_a_body_is_disambiguated_too(self):
        cli, _ = client({
            TREE_URL: Response(404, None, {}),
            COMMITS_URL: Response(200, {"id": "abc123"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIs(result.present, False)
        self.assertIsNone(result.problem)

    def test_project_not_found_is_a_problem(self):
        cli, _ = client({TREE_URL: Response(404, {"message": "404 Project Not Found"}, {})})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("project", result.problem.lower())

    def test_project_not_found_makes_no_second_request(self):
        # проект недоступен — уточнять ветку бессмысленно, лишний запрос
        # на большом теге умножился бы на число сборок
        cli, transport = client(
            {TREE_URL: Response(404, {"message": "404 Project Not Found"}, {})})
        cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(len(transport.requests), 1)

    def test_unknown_host_is_a_problem(self):
        cli, _ = client({})
        result = cli.patch_files("other.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("unknown host", result.problem)

    def test_substituted_host_is_noted_but_still_read(self):
        # хост не описан в конфиге: спрашиваем сервер по умолчанию, но
        # помечаем, что данные, возможно, из чужого репозитория
        cli, transport = client({TREE_URL: TWO_FILES},
                                default_host="gitlab.example.com")
        result = cli.patch_files("other.example.com", "g/r", "br")
        self.assertIs(result.present, True)
        self.assertEqual(result.paths,
                         ["PATCH/CVE-2024-7347.patch", "PATCH/sub/sast-x.patch"])
        self.assertIn("other.example.com", result.problem)
        self.assertIn("gitlab.example.com", result.problem)
        self.assertIn("не описан в конфиге", result.problem)

    def test_substitution_note_keeps_the_real_problem(self):
        cli, _ = client({TREE_URL: Response(403, {"message": "403 Forbidden"}, {})},
                        default_host="gitlab.example.com")
        result = cli.patch_files("other.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("не описан в конфиге", result.problem)
        self.assertIn("403", result.problem)

    def test_known_host_is_not_noted(self):
        cli, _ = client({TREE_URL: TWO_FILES},
                        default_host="gitlab.example.com")
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.problem)

    def test_wildcard_host_is_not_noted(self):
        # «*» ставит --gitlab-api: это сознательное «ходить сюда за всем»
        transport = FakeTransport({TREE_URL: TWO_FILES})
        cli = GitlabClient({"*": HOSTS["gitlab.example.com"]}, token=TOKEN,
                           transport=transport, sleeper=lambda _s: None,
                           default_host="*")
        result = cli.patch_files("whatever.example.com", "g/r", "br")
        self.assertIs(result.present, True)
        self.assertIsNone(result.problem)

    def test_forbidden_is_a_problem(self):
        cli, _ = client({TREE_URL: Response(403, {"message": "403 Forbidden"}, {})})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("403", result.problem)

    def test_pagination_follows_next_page(self):
        page1 = Response(200, [{"id": "1", "name": "a.patch", "type": "blob",
                                "path": "PATCH/a.patch"}], {"x-next-page": "2"})
        page2 = Response(200, [{"id": "2", "name": "b.patch", "type": "blob",
                                "path": "PATCH/b.patch"}], {"x-next-page": ""})
        cli, transport = client({TREE_URL: [page1, page2]})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(result.paths, ["PATCH/a.patch", "PATCH/b.patch"])
        self.assertEqual(transport.requests[1][1]["page"], "2")

    def test_retries_on_429_then_succeeds(self):
        cli, transport = client({TREE_URL: [Response(429, {}, {"Retry-After": "0"}),
                                            TWO_FILES]})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertTrue(result.present)
        self.assertEqual(len(transport.requests), 2)

    def test_gives_up_after_retries(self):
        cli, transport = client({TREE_URL: Response(500, {}, {})}, retries=3)
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("500", result.problem)
        self.assertEqual(len(transport.requests), 3)

    def test_same_triple_is_requested_once(self):
        cli, transport = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "br")
        cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(len(transport.requests), 1)

    def test_different_ref_is_requested_again(self):
        cli, transport = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "br")
        cli.patch_files("gitlab.example.com", "g/r", "other")
        self.assertEqual(len(transport.requests), 2)

    def test_missing_ref_is_a_problem(self):
        cli, _ = client({TREE_URL: TWO_FILES})
        result = cli.patch_files("gitlab.example.com", "g/r", None)
        self.assertIsNone(result.present)
        self.assertIn("ref", result.problem)


class RetrySleepTest(unittest.TestCase):
    def sleeps_for(self, transport, **kwargs):
        slept = []
        cli = GitlabClient(HOSTS, token=TOKEN, transport=transport,
                           sleeper=slept.append, **kwargs)
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        return result, slept

    def test_no_backoff_after_the_last_failed_attempt(self):
        # три попытки — две паузы: ждать после последней нечего, а с
        # --jobs 8 против приболевшего GitLab это секунды на каждый билд
        result, slept = self.sleeps_for(_BrokenTransport(), retries=3)
        self.assertIsNone(result.present)
        self.assertIn("connection reset", result.problem)
        self.assertEqual(len(slept), 2)

    def test_no_backoff_after_the_last_bad_status(self):
        transport = FakeTransport({TREE_URL: Response(500, {}, {})})
        _, slept = self.sleeps_for(transport, retries=3)
        self.assertEqual(len(slept), 2)

    def test_single_attempt_never_sleeps(self):
        _, slept = self.sleeps_for(_BrokenTransport(), retries=1)
        self.assertEqual(slept, [])


class _BrokenTransport:
    """Транспорт, у которого каждый запрос падает сетевой ошибкой."""

    def __init__(self):
        self.requests = []

    def get(self, url, headers=None, params=None):
        self.requests.append(url)
        raise IOError("connection reset")



class _TokenLeakingTransport:
    """Транспорт, повторяющий поведение requests на кривом заголовке: значение
    PRIVATE-TOKEN попадает в текст исключения."""

    def __init__(self, token):
        self._token = token
        self.requests = []

    def get(self, url, headers=None, params=None):
        self.requests.append(url)
        raise ValueError("Invalid header value b'%s\\n'" % self._token)


class UrlTest(unittest.TestCase):
    def test_urls_are_percent_encoded(self):
        # пробел или «#» в имени ветки без кодирования ломают ссылку
        cli, _ = client({})
        self.assertEqual(cli.tree_url("gitlab.example.com", "g/r", "feat/a b#c"),
                         "https://gitlab.example.com/g/r/-/tree/feat/a%20b%23c")
        self.assertEqual(
            cli.blob_url("gitlab.example.com", "g r/r", "b#1",
                         "PATCH/a b.patch"),
            "https://gitlab.example.com/g%20r/r/-/blob/b%231/PATCH/a%20b.patch")

    def test_tree_and_blob_urls(self):
        cli, _ = client({})
        self.assertEqual(cli.tree_url("gitlab.example.com", "g/r", "feat/x"),
                         "https://gitlab.example.com/g/r/-/tree/feat/x")
        self.assertEqual(
            cli.blob_url("gitlab.example.com", "g/r", "br", "PATCH/a.patch"),
            "https://gitlab.example.com/g/r/-/blob/br/PATCH/a.patch")

    def test_urls_are_none_for_unknown_host(self):
        cli, _ = client({})
        self.assertIsNone(cli.tree_url("nope", "g/r", "br"))


class LoggingTest(unittest.TestCase):
    def test_request_is_logged_at_debug(self):
        cli, _ = client({TREE_URL: TWO_FILES})
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        line = "\n".join(caught.output)
        self.assertIn("GET", line)
        self.assertIn(TREE_URL, line)
        self.assertIn("ref=br", line)
        self.assertIn("200", line)

    def test_token_never_reaches_the_log(self):
        # утечка секрета в лог происходит молча, поэтому проверяем машиной
        transport = FakeTransport({TREE_URL: TWO_FILES})
        cli = GitlabClient(HOSTS, token=SECRET, transport=transport,
                           sleeper=lambda _s: None)
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        line = "\n".join(caught.output)
        self.assertNotIn(SECRET, line)
        self.assertNotIn("PRIVATE-TOKEN", line)

    def test_token_is_scrubbed_from_a_transport_exception(self):
        # requests кладёт ЗНАЧЕНИЕ заголовка в текст исключения, если заголовок
        # неправильный, а токен с завершающим переводом строки (классическое
        # GITLAB_TOKEN=$(cat token.txt)) — именно такой. Текст исключения
        # уходит и в лог, и в проблемы билда, то есть в снапшот и в HTML.
        transport = _TokenLeakingTransport(SECRET)
        cli = GitlabClient(HOSTS, token=SECRET, transport=transport,
                           sleeper=lambda _s: None, retries=3)
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertNotIn(SECRET, "\n".join(caught.output))
        self.assertNotIn(SECRET, result.problem)
        self.assertIn("Invalid header value", result.problem)

    def test_token_is_scrubbed_after_the_retries_are_exhausted(self):
        # последняя попытка формирует итоговый problem — он тоже без токена
        transport = _TokenLeakingTransport(SECRET)
        cli = GitlabClient(HOSTS, token=SECRET, transport=transport,
                           sleeper=lambda _s: None, retries=3)
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(len(transport.requests), 3)
        self.assertIsNone(result.present)
        self.assertNotIn(SECRET, result.problem)

    def test_token_is_scrubbed_on_the_substituted_host_path(self):
        # заметка о подмене хоста склеивается с проблемой запроса: склейка
        # не должна протащить токен мимо очистки
        transport = _TokenLeakingTransport(SECRET)
        cli = GitlabClient(HOSTS, token=SECRET, transport=transport,
                           sleeper=lambda _s: None, retries=3,
                           default_host="gitlab.example.com")
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            result = cli.patch_files("other.example.com", "g/r", "br")
        self.assertIn("не описан в конфиге", result.problem)
        self.assertNotIn(SECRET, result.problem)
        self.assertNotIn(SECRET, "\n".join(caught.output))

    def test_error_body_is_logged_at_debug(self):
        cli, _ = client({TREE_URL: Response(403, {"message": "403 Forbidden"}, {})})
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIn("403 Forbidden", "\n".join(caught.output))

    def test_retry_is_logged_as_warning(self):
        cli, _ = client({TREE_URL: [Response(429, {}, {"Retry-After": "0"}),
                                    TWO_FILES]})
        with self.assertLogs("kojipatch.gitlabclient", level="WARNING") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        line = "\n".join(caught.output)
        self.assertIn("429", line)
        self.assertIn("повтор", line)

    def test_retry_warning_is_written_before_the_pause(self):
        # «повтор через 60 с» после самой паузы — рассказ о прошлом: при
        # Retry-After 60 и --jobs 8 оператор видит минуту тишины, а потом
        # строку о том, что пауза уже была
        transport = FakeTransport({TREE_URL: [Response(429, {}, {"Retry-After": "0"}),
                                              TWO_FILES]})
        seen = []
        with self.assertLogs("kojipatch.gitlabclient", level="WARNING") as caught:
            cli = GitlabClient(HOSTS, token=TOKEN, transport=transport,
                               sleeper=lambda _s: seen.append(list(caught.output)))
            cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertTrue(seen[0], "пауза началась раньше строки о ней")
        self.assertIn("повтор", seen[0][-1])

    def test_retry_warning_carries_ref_and_path(self):
        # это единственная строка GitLab, видимая на уровне по умолчанию:
        # без ref и path непонятно, какую именно ветку он не отдаёт
        cli, _ = client({TREE_URL: [Response(429, {}, {"Retry-After": "0"}),
                                    TWO_FILES]})
        with self.assertLogs("kojipatch.gitlabclient", level="WARNING") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        line = "\n".join(caught.output)
        self.assertIn("ref=br", line)
        self.assertIn("path=PATCH", line)

    def test_final_transport_failure_is_not_warned_about(self):
        # об окончательной неудаче один раз и с именем компонента напишет
        # collect; здесь предупреждение только пообещало бы новую попытку
        cli = GitlabClient(HOSTS, token=TOKEN, transport=_BrokenTransport(),
                           sleeper=lambda _s: None, retries=1)
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual([r.levelname for r in caught.records], ["DEBUG"])

    def test_transport_failures_warn_only_while_attempts_remain(self):
        cli = GitlabClient(HOSTS, token=TOKEN, transport=_BrokenTransport(),
                           sleeper=lambda _s: None, retries=3)
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        warnings = [r for r in caught.records if r.levelno == logging.WARNING]
        self.assertEqual(len(warnings), 2)

    def test_disambiguation_line_has_no_double_space(self):
        # у запроса к commits параметров нет, и пустая заметка о них
        # оставляла в строке дырку: «commits/br  → 200»
        cli, _ = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(200, {"id": "abc123"}, {}),
        })
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        for line in caught.output:
            self.assertNotIn("  ", line)

    def test_missing_patch_dir_verdict_is_logged_at_debug(self):
        # ради этого случая всё и затевалось: 404 на дереве и 200 на ветке
        # читаются как «всё в порядке» только если знать про доразбор
        cli, _ = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(200, {"id": "abc123"}, {}),
        })
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        line = "\n".join(caught.output)
        self.assertIn("ветка br есть", line)
        self.assertIn("PATCH", line)
        self.assertIn("не ошибка", line)

    def test_missing_ref_verdict_is_logged_at_debug(self):
        cli, _ = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(404, {"message": "404 Commit Not Found"}, {}),
        })
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIn("ветки br нет", "\n".join(caught.output))

    def test_undecided_verdict_is_logged_at_debug(self):
        cli, _ = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(403, {"message": "403 Forbidden"}, {}),
        })
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIn("не удалось выяснить", "\n".join(caught.output))

    def test_cache_hit_is_logged_at_debug(self):
        cli, _ = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "br")
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIn("кэш", "\n".join(caught.output))

    def test_successful_request_logs_only_at_debug(self):
        # обычный успешный запрос не должен шуметь на уровне по умолчанию:
        # ни одной записи выше DEBUG он порождать не вправе
        cli, _ = client({TREE_URL: TWO_FILES})
        with self.assertLogs("kojipatch.gitlabclient", level="DEBUG") as caught:
            cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertTrue(caught.records)
        for record in caught.records:
            self.assertEqual(record.levelno, logging.DEBUG,
                             "лишняя запись уровня %s: %s"
                             % (record.levelname, record.getMessage()))


if __name__ == "__main__":
    unittest.main()
