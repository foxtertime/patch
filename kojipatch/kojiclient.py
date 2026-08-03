"""Тонкая обёртка над koji.ClientSession с пакетными вызовами."""
import logging
import time
from typing import Dict, List

logger = logging.getLogger(__name__)


class KojiError(Exception):
    """Хаб недоступен или ответил ошибкой."""


class KojiClient:
    def __init__(self, session, batch: int = 100):
        self._session = session
        self._batch = max(1, int(batch))
        self._multicall_warned = False

    def tagged_builds(self, tag: str) -> List[dict]:
        """Последние билды тега с учётом наследования."""
        started = time.monotonic()
        try:
            builds = self._session.listTagged(tag, latest=True, inherit=True)
        except Exception as exc:
            raise KojiError("не получить билды тега %s: %s" % (tag, exc))
        logger.debug("listTagged %s → %d билдов за %.2f с", tag, len(builds),
                     time.monotonic() - started)
        return builds

    def build_details(self, build_ids: List[int]) -> Dict[int, dict]:
        results = self._call_batched("getBuild", build_ids)
        return {bid: info for bid, info in results.items() if info}

    def rpms_for(self, build_ids: List[int]) -> Dict[int, List[str]]:
        raw = self._call_batched("listRPMs", build_ids, keyword="buildID")
        out = {}
        for bid, rpms in raw.items():
            names = ["%s-%s-%s.%s" % (r["name"], r["version"], r["release"],
                                      r["arch"])
                     for r in rpms or []]
            out[bid] = sorted(names)
        return out

    def _call_batched(self, method: str, build_ids: List[int],
                      keyword: str = None) -> Dict[int, object]:
        ids = list(build_ids)
        if not ids:
            return {}
        results = {}
        for start in range(0, len(ids), self._batch):
            chunk = ids[start:start + self._batch]
            results.update(self._call_chunk(method, chunk, keyword))
        return results

    def _call_chunk(self, method: str, chunk: List[int],
                    keyword: str) -> Dict[int, object]:
        """Один пакет: сперва multicall, при его отсутствии — последовательные
        вызовы; любая иная ошибка хаба оборачивается в KojiError с контекстом."""
        started = time.monotonic()
        try:
            try:
                result = self._multicall_chunk(method, chunk, keyword)
            except (AttributeError, NotImplementedError, TypeError):
                # AttributeError/NotImplementedError — на хабе нет multicall
                # (старый клиент) или он не вернул VirtualCall; TypeError —
                # multicall на хабе до koji 1.18 был обычным булевым
                # атрибутом, а не вызываемым методом. Во всех случаях —
                # фолбэк на последовательные вызовы.
                if self._multicall_warned:
                    # свойство хаба, а не пачки: на 800 билдах пачками по 100
                    # одно и то же предупреждение вышло бы шестнадцать раз
                    logger.debug("%s ×%d — последовательными вызовами",
                                 method, len(chunk))
                else:
                    self._multicall_warned = True
                    logger.warning("хаб не поддерживает multicall, %s ×%d "
                                   "и остальные вызовы пойдут "
                                   "последовательными", method, len(chunk))
                result = self._sequential_chunk(method, chunk, keyword)
        except KojiError:
            raise
        except Exception as exc:
            raise KojiError("%s: ошибка хаба на %d билд(ах): %s"
                            % (method, len(chunk), exc))
        logger.debug("%s ×%d за %.2f с", method, len(chunk),
                     time.monotonic() - started)
        return result

    def _invoke(self, target, method: str, build_id: int, keyword: str):
        call = getattr(target, method)
        if keyword:
            return call(**{keyword: build_id})
        return call(build_id)

    def _multicall_chunk(self, method, chunk, keyword) -> Dict[int, object]:
        multicall = getattr(self._session, "multicall", None)
        if multicall is None:
            raise AttributeError("multicall")
        with multicall(batch=len(chunk)) as batch:
            # каждый вызов возвращает VirtualCall, результат появляется на выходе
            calls = [self._invoke(batch, method, build_id, keyword)
                     for build_id in chunk]
        if any(call is None for call in calls):
            raise NotImplementedError("multicall не вернул VirtualCall")
        return dict(zip(chunk, [call.result for call in calls]))

    def _sequential_chunk(self, method, chunk, keyword) -> Dict[int, object]:
        return {build_id: self._invoke(self._session, method, build_id, keyword)
                for build_id in chunk}


def connect(hub: str, batch: int = 100) -> KojiClient:
    """Анонимная сессия к хабу; чтение аутентификации не требует."""
    import koji  # импорт внутри, чтобы тесты не зависели от библиотеки
    try:
        session = koji.ClientSession(hub)
    except Exception as exc:
        raise KojiError("не подключиться к koji %s: %s" % (hub, exc))
    return KojiClient(session, batch=batch)
