import unittest

from kojipatch.kojiclient import KojiClient, KojiError
from tests.fakes import FakeKojiSession

TAGGED = {"os-9.2": [{"build_id": 1, "name": "nginx", "nvr": "nginx-1.24.0-3.el9"},
                     {"build_id": 2, "name": "curl", "nvr": "curl-8.0.1-1.el9"}]}
BUILDS = {
    1: {"build_id": 1, "name": "nginx", "version": "1.24.0", "release": "3.el9",
        "extra": {"source": {"original_url": "git+ssh://git@h/g/nginx?#origin/br"}}},
    2: {"build_id": 2, "name": "curl", "version": "8.0.1", "release": "1.el9",
        "extra": None},
}
RPMS = {
    1: [{"name": "nginx", "version": "1.24.0", "release": "3.el9", "arch": "x86_64"},
        {"name": "nginx-core", "version": "1.24.0", "release": "3.el9", "arch": "x86_64"}],
    2: [],
}


class _BoolMulticallSession(FakeKojiSession):
    """Сессия, где multicall — не метод, а обычный булев атрибут, как на
    хабах koji до версии 1.18."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.multicall = False


class _FailingSession(FakeKojiSession):
    """Сессия, эмулирующая настоящий сбой хаба (не связанный с отсутствием
    multicall) — например таймаут или XML-RPC fault."""

    def getBuild(self, build_id):
        raise RuntimeError("XML-RPC fault: timeout")


class KojiClientTest(unittest.TestCase):
    def setUp(self):
        self.session = FakeKojiSession(tagged=TAGGED, builds=BUILDS, rpms=RPMS)
        self.client = KojiClient(self.session, batch=10)

    def test_tagged_builds_uses_latest_and_inherit(self):
        builds = self.client.tagged_builds("os-9.2")
        self.assertEqual(len(builds), 2)
        self.assertIn(("listTagged", "os-9.2", True, True), self.session.calls)

    def test_build_details_returns_map_with_extra(self):
        details = self.client.build_details([1, 2])
        self.assertEqual(set(details), {1, 2})
        self.assertEqual(
            details[1]["extra"]["source"]["original_url"],
            "git+ssh://git@h/g/nginx?#origin/br")

    def test_build_details_uses_multicall(self):
        self.client.build_details([1, 2])
        self.assertTrue(any(call[0] == "multicall" for call in self.session.calls))

    def test_rpms_are_formatted_and_sorted(self):
        rpms = self.client.rpms_for([1, 2])
        self.assertEqual(rpms[1], ["nginx-1.24.0-3.el9.x86_64",
                                   "nginx-core-1.24.0-3.el9.x86_64"])
        self.assertEqual(rpms[2], [])

    def test_falls_back_when_multicall_missing(self):
        session = FakeKojiSession(tagged=TAGGED, builds=BUILDS, rpms=RPMS,
                                  supports_multicall=False)
        client = KojiClient(session, batch=10)
        details = client.build_details([1, 2])
        self.assertEqual(set(details), {1, 2})
        self.assertFalse(any(call[0] == "multicall" for call in session.calls))

    def test_empty_input_makes_no_calls(self):
        self.assertEqual(self.client.build_details([]), {})
        self.assertEqual(self.client.rpms_for([]), {})
        self.assertEqual(self.session.calls, [])

    def test_missing_build_is_skipped(self):
        details = self.client.build_details([1, 999])
        self.assertEqual(set(details), {1})

    def test_falls_back_when_multicall_is_plain_bool(self):
        session = _BoolMulticallSession(tagged=TAGGED, builds=BUILDS, rpms=RPMS)
        client = KojiClient(session, batch=10)
        details = client.build_details([1, 2])
        self.assertEqual(set(details), {1, 2})
        self.assertFalse(any(call[0] == "multicall" for call in session.calls))

    def test_hub_failure_is_wrapped_in_koji_error(self):
        session = _FailingSession(tagged=TAGGED, builds=BUILDS, rpms=RPMS)
        client = KojiClient(session, batch=10)
        with self.assertRaises(KojiError):
            client.build_details([1, 2])


if __name__ == "__main__":
    unittest.main()
