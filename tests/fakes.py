"""Подделки внешних систем для тестов. Сети здесь нет."""
from collections import namedtuple


class _VirtualCall:
    """Отложенный результат, как koji.VirtualCall: .result заполняется на выходе."""

    def __init__(self):
        self.result = None


class _MultiCallProxy:
    def __init__(self, recorder, name):
        self._recorder = recorder
        self._name = name

    def __call__(self, *args, **kwargs):
        call = _VirtualCall()
        self._recorder.append((self._name, args, kwargs, call))
        return call


class _MultiCall:
    """Имитация koji.ClientSession.multicall как контекстного менеджера."""

    def __init__(self, session):
        self._session = session
        self._calls = []

    def __getattr__(self, name):
        return _MultiCallProxy(self._calls, name)

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        for name, args, kwargs, call in self._calls:
            call.result = getattr(self._session, name)(*args, **kwargs)
        return False


class FakeKojiSession:
    """Считает вызовы и отдаёт заранее заданные ответы."""

    def __init__(self, tagged=None, builds=None, rpms=None, tags=None,
                 supports_multicall=True):
        self.tagged = tagged or {}
        self.builds = builds or {}
        self.rpms = rpms or {}
        self.tags = tags or {}
        self.supports_multicall = supports_multicall
        self.calls = []

    def listTagged(self, tag, latest=False, inherit=False):
        self.calls.append(("listTagged", tag, latest, inherit))
        if tag not in self.tagged:
            raise ValueError("no such tag: %s" % tag)
        return list(self.tagged[tag])

    def getBuild(self, build_id):
        self.calls.append(("getBuild", build_id))
        return self.builds.get(build_id)

    def listRPMs(self, buildID=None):
        self.calls.append(("listRPMs", buildID))
        return list(self.rpms.get(buildID, []))

    def listTags(self, build=None):
        # koji отдаёт словари тегов, а не строки: имя лежит в ключе name
        self.calls.append(("listTags", build))
        return [{"id": i, "name": name}
                for i, name in enumerate(self.tags.get(build, []))]

    def multicall(self, batch=None, strict=False):
        if not self.supports_multicall:
            raise AttributeError("multicall")
        self.calls.append(("multicall", batch))
        return _MultiCall(self)


Response = namedtuple("Response", "status body headers")


class FakeTransport:
    """HTTP-транспорт для GitlabClient: очередь ответов на каждый URL."""

    def __init__(self, routes=None):
        self.routes = routes or {}
        self.requests = []

    def get(self, url, headers=None, params=None):
        self.requests.append((url, dict(params or {}), dict(headers or {})))
        key = (url, tuple(sorted((params or {}).items())))
        if key in self.routes:
            queue = self.routes[key]
        elif url in self.routes:
            queue = self.routes[url]
        else:
            return Response(404, {"message": "404 Project Not Found"}, {})
        if isinstance(queue, list):
            return queue.pop(0) if len(queue) > 1 else queue[0]
        return queue
