"""Чтение каталога патчей из GitLab через REST v4."""
import logging
import threading
import time
from collections import namedtuple
from typing import Dict, Optional
from urllib.parse import quote

TreeResult = namedtuple("TreeResult", "present paths problem")

_RETRY_STATUSES = (429, 500, 502, 503, 504)

logger = logging.getLogger(__name__)

_BODY_LIMIT = 200

# порог, ниже которого строка не считается токеном и не вычищается
_MIN_TOKEN_LEN = 8


class HttpTransport:
    """requests поверх пула сессий: по одной сессии на поток."""

    def __init__(self, timeout: int = 30):
        self._timeout = timeout
        self._local = threading.local()

    def _session(self):
        session = getattr(self._local, "session", None)
        if session is None:
            import requests
            session = requests.Session()
            self._local.session = session
        return session

    def get(self, url, headers=None, params=None):
        response = self._session().get(url, headers=headers, params=params,
                                       timeout=self._timeout)
        try:
            body = response.json()
        except ValueError:
            body = None
        return _Response(response.status_code, body, response.headers)


class _Response:
    def __init__(self, status, body, headers):
        self.status = status
        self.body = body
        self.headers = headers


class GitlabClient:
    def __init__(self, hosts: Dict[str, object], token: Optional[str] = None,
                 patch_dir: str = "PATCH", transport=None, retries: int = 3,
                 sleeper=time.sleep, default_host: Optional[str] = None):
        self._hosts = hosts or {}
        self._token = token
        self._patch_dir = patch_dir
        self._transport = transport or HttpTransport()
        self._retries = max(1, int(retries))
        self._sleep = sleeper
        self._default_host = default_host
        self._cache = {}
        self._lock = threading.Lock()

    def _scrub(self, text) -> str:
        """Текст исключения транспорта может нести заголовки — там токен.

        Причину кривого заголовка снимает Config.token(), срезая пробелы; эта
        очистка — второй рубеж: секрет может оказаться в тексте исключения и
        по другой причине, а утечка происходит молча.

        Ищем токен во всех видах, в которых он туда попадает. requests
        печатает значение заголовка через repr, и настоящий перевод строки
        превращается в два символа «\\» и «n» — по сырому токену такая замена
        не находит ничего. Поэтому чистим и сырой токен, и его экранированную
        запись, и обрезанный вариант (именно он уходит на провод).
        """
        text = str(text)
        token = self._token or ""
        # ниже порога чистить опаснее, чем не чистить: настоящий PAT GitLab
        # длиной около 26 символов, а слепая замена короткого «токена»
        # превратит «connection reset by peer» в «connec***ion rese*** by
        # peer» — и этот испорченный текст уедет в проблемы билда, в снапшот
        # и в дашборд. Восемь символов — заведомо не секрет.
        if len(token.strip()) < _MIN_TOKEN_LEN:
            return text
        variants = {token, token.strip()}
        variants |= {v.encode("unicode_escape").decode("ascii")
                     for v in list(variants)}
        # длинные варианты первыми: иначе обрезанный съел бы начало полного
        for variant in sorted(variants, key=len, reverse=True):
            text = text.replace(variant, "***")
        return text

    # -- адреса -----------------------------------------------------------
    def _resolve_host(self, host):
        """Конфиг хоста и, если хост подменён, заметка об этой подмене.

        Незнакомый хост спрашиваем у сервера по умолчанию: чаще всего это
        просто другое имя того же GitLab. Но если там окажется одноимённый
        проект (зеркало, переезд), в дашборд уедут патчи чужого репозитория,
        и отличить их от настоящих будет нельзя. Поэтому подстановку
        выполняем, но записываем в проблемы билда.
        """
        if host in self._hosts:
            return self._hosts[host], None
        default = self._default_host
        if default and default in self._hosts:
            # «*» ставит --gitlab-api: это осознанное «ходить сюда за всем»,
            # и заметки оно не заслуживает.
            note = None if default == "*" else (
                "gitlab: host %s не описан в конфиге, запрошен %s"
                % (host, default))
            return self._hosts[default], note
        if "*" in self._hosts:
            return self._hosts["*"], None
        return None, None

    def _host_config(self, host):
        return self._resolve_host(host)[0]

    def tree_url(self, host, project, ref) -> Optional[str]:
        cfg = self._host_config(host)
        if not cfg or not ref:
            return None
        return "%s/%s/-/tree/%s" % (cfg.web.rstrip("/"), _path(project),
                                    _path(ref))

    def blob_url(self, host, project, ref, path) -> Optional[str]:
        cfg = self._host_config(host)
        if not cfg or not ref:
            return None
        return "%s/%s/-/blob/%s/%s" % (cfg.web.rstrip("/"), _path(project),
                                       _path(ref), _path(path))

    # -- дерево патчей ----------------------------------------------------
    def patch_files(self, host, project, ref) -> TreeResult:
        """Пути файлов внутри каталога патчей ветки; результат мемоизируется."""
        if not ref:
            return TreeResult(None, [], "gitlab: no ref in source url")
        key = (host, project, ref)
        with self._lock:
            if key in self._cache:
                logger.debug("кэш: %s %s@%s", host, project, ref)
                return self._cache[key]
        result = self._fetch(host, project, ref)
        with self._lock:
            self._cache[key] = result
        return result

    def _fetch(self, host, project, ref) -> TreeResult:
        cfg, note = self._resolve_host(host)
        if cfg is None:
            return TreeResult(None, [], "gitlab: unknown host %s" % host)
        result = self._fetch_tree(cfg, project, ref)
        if not note:
            return result
        # заметка о подмене хоста не отменяет удачное чтение: present
        # остаётся тем, что вернул сервер, — билд просто получает проблему.
        problem = note if not result.problem else "%s; %s" % (note,
                                                              result.problem)
        return TreeResult(result.present, result.paths, problem)

    def _fetch_tree(self, cfg, project, ref) -> TreeResult:
        url = "%s/projects/%s/repository/tree" % (
            cfg.api.rstrip("/"), quote(project, safe=""))
        headers = {"PRIVATE-TOKEN": self._token} if self._token else {}

        paths = []
        page = None
        while True:
            params = {"ref": ref, "path": self._patch_dir,
                      "recursive": "true", "per_page": "100"}
            if page:
                params["page"] = page
            response = self._get_with_retries(url, headers, params)
            if isinstance(response, str):
                return TreeResult(None, [], response)
            if response.status == 404:
                message = _message(response)
                if "project not found" in message.lower():
                    return TreeResult(None, [], "gitlab: %s" % message)
                # Остальные 404 неоднозначны: «в ветке нет каталога» и «нет
                # самой ветки» приходят одинаковым кодом, а формулировка
                # зависит от версии GitLab — «404 Tree Not Found», «404
                # invalid revision or path Not Found», иногда пустое тело.
                # Поэтому решает не текст, а отдельный запрос к ветке.
                return self._resolve_missing_tree(cfg, project, ref, headers)
            if response.status >= 400:
                return TreeResult(None, [],
                                  "gitlab: %s %s" % (response.status,
                                                     _message(response)))
            for item in response.body or []:
                if item.get("type") == "blob":
                    paths.append(item["path"])
            page = (response.headers or {}).get("x-next-page") or ""
            if not page:
                break
        return TreeResult(True, sorted(paths), None)

    def _resolve_missing_tree(self, cfg, project, ref, headers) -> TreeResult:
        """404 Tree Not Found неоднозначен: либо в ветке просто нет PATCH,
        либо самой ветки уже нет. Уточняем через /repository/commits/<ref>."""
        url = "%s/projects/%s/repository/commits/%s" % (
            cfg.api.rstrip("/"), quote(project, safe=""), quote(ref, safe=""))
        response = self._get_with_retries(url, headers, {})
        # вердикт пишем словами: без него в логе видны только 404 на дереве и
        # 200 на ветке, и прочесть их как «всё в порядке» может лишь тот, кто
        # и так знает про доразбор, — а разбирается в инциденте обычно другой
        if isinstance(response, str):
            logger.debug("%s: ветка %s — не удалось выяснить, есть ли она: %s",
                         project, ref, response)
            return TreeResult(None, [], response)
        if response.status == 404:
            logger.debug("%s: ветки %s нет, поэтому и каталога %s не нашлось",
                         project, ref, self._patch_dir)
            return TreeResult(None, [], "gitlab: ref not found")
        if 200 <= response.status < 300:
            logger.debug("%s: ветка %s есть, каталога %s в ней нет — это не "
                         "ошибка, патчей у сборки просто нет",
                         project, ref, self._patch_dir)
            return TreeResult(False, [], None)
        logger.debug("%s: ветка %s — не удалось выяснить, есть ли она: %s %s",
                     project, ref, response.status, _message(response))
        return TreeResult(None, [],
                          "gitlab: %s %s" % (response.status, _message(response)))

    def _get_with_retries(self, url, headers, params):
        last = None
        for attempt in range(self._retries):
            started = time.monotonic()
            try:
                response = self._transport.get(url, headers=headers,
                                               params=params)
            except Exception as exc:  # сетевые ошибки транспорта
                elapsed = time.monotonic() - started
                # текст исключения идёт и в лог, и в проблемы билда, а оттуда
                # в снапшот и в HTML — очищаем до того, как он куда-то попал
                text = self._scrub(exc)
                last = "gitlab: %s" % text
                if attempt < self._retries - 1:
                    delay = self._delay(attempt, None)
                    logger.warning("GET %s%s → %s за %.2f с, повтор через "
                                   "%.0f с (попытка %d из %d)", url,
                                   _params_note(params), text, elapsed, delay,
                                   attempt + 1, self._retries)
                    self._sleep(delay)
                else:
                    # после последней попытки ждать незачем: с --jobs 8 против
                    # приболевшего GitLab это секунды на каждый билд впустую.
                    # Предупреждать тоже: об окончательной неудаче один раз и
                    # с именем компонента напишет collect, а «попытка 3 из 3»
                    # в WARNING обещала бы несуществующую следующую.
                    logger.debug("GET %s%s → %s за %.2f с (попытка %d из %d, "
                                 "последняя)", url, _params_note(params), text,
                                 elapsed, attempt + 1, self._retries)
                continue

            elapsed = time.monotonic() - started
            if response.status >= 400:
                logger.debug("GET %s%s → %s за %.2f с: %s", url,
                             _params_note(params), response.status, elapsed,
                             _body_note(response))
            else:
                logger.debug("GET %s%s → %s за %.2f с", url,
                             _params_note(params), response.status, elapsed)

            if response.status in _RETRY_STATUSES and attempt < self._retries - 1:
                # сначала строка, потом пауза: при Retry-After 60 обратный
                # порядок дал бы минуту тишины и рассказ о ней в прошедшем
                # времени, а следить за долгим прогоном — половина смысла лога
                delay = self._delay(attempt,
                                    (response.headers or {}).get("Retry-After"))
                logger.warning("GET %s%s → %s, повтор через %.0f с "
                               "(попытка %d из %d)", url,
                               _params_note(params), response.status, delay,
                               attempt + 1, self._retries)
                self._sleep(delay)
                last = "gitlab: %s %s" % (response.status, _message(response))
                continue
            return response
        return last or "gitlab: запрос не удался"

    def _delay(self, attempt, retry_after) -> float:
        """Длительность паузы перед повтором; сон отдельно, чтобы строка о
        паузе успела уйти в лог до самой паузы."""
        delay = 2 ** attempt
        if retry_after:
            try:
                delay = float(retry_after)
            except (TypeError, ValueError):
                pass
        return delay


def _path(value) -> str:
    """Кусок пути веб-ссылки: слэши разделяют сегменты и остаются, а пробел
    или «#» в имени ветки без кодирования ломают ссылку."""
    return quote(str(value), safe="/")


def _message(response) -> str:
    body = getattr(response, "body", None)
    if isinstance(body, dict):
        return str(body.get("message") or body.get("error") or "")
    return ""


def _params_note(params) -> str:
    """Параметры запроса для лога — вместе с ведущим пробелом, чтобы у
    запроса без параметров в строке не оставалось дырки.

    Заголовки не логируем никогда — там токен.
    """
    keep = ("ref", "path", "page")
    note = " ".join("%s=%s" % (k, params[k]) for k in keep if k in (params or {}))
    return " " + note if note else ""


def _body_note(response) -> str:
    body = getattr(response, "body", None)
    if body is None:
        return "пустое тело"
    text = str(body)
    return text if len(text) <= _BODY_LIMIT else text[:_BODY_LIMIT] + "…"
