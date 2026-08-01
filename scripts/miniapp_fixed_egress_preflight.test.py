#!/usr/bin/env python3
"""Focused offline tests for fixed-egress preflight validation."""

from pathlib import Path
import tempfile
import unittest

from miniapp_fixed_egress_common import FixedEgressError
import miniapp_fixed_egress_preflight as target


class ProxyUrlValidationTests(unittest.TestCase):
    def test_loopback_proxy_port_must_be_between_one_and_65535(self):
        self.assertEqual(
            target._validated_loopback_proxy("http://127.0.0.1:1"),
            ("127.0.0.1", 1),
        )
        self.assertEqual(
            target._validated_loopback_proxy("http://127.0.0.1:65535"),
            ("127.0.0.1", 65535),
        )
        for proxy_url in (
            "http://127.0.0.1:0",
            "http://127.0.0.1:65536",
        ):
            with self.subTest(proxy_url=proxy_url):
                with self.assertRaises(FixedEgressError):
                    target._validated_loopback_proxy(proxy_url)


class ConfigurationHealthAndProbeTests(unittest.TestCase):
    def base_env(self):
        return {
            "WECHAT_MINIAPP_FIXED_EGRESS_IP": "203.0.113.17",
            "WECHAT_MINIAPP_FIXED_EGRESS_ECHO_URL": "https://echo.example/ip",
            "WECHAT_MINIAPP_BACKEND_HEALTH_URL": "https://health.example/backend",
            "WECHAT_MINIAPP_GATEWAY_HEALTH_URL": "https://health.example/gateway",
        }

    def test_config_requires_canonical_ipv4_and_https_port_443(self):
        config = target.config_from_env(self.base_env(), expected_version="7.2.10")
        self.assertEqual(config.fixed_egress_ip, "203.0.113.17")
        self.assertIn(("echo.example", 443), config.allowlist)
        self.assertIn(("servicewechat.com", 443), config.allowlist)
        invalid_environments = (
            {},
            {**self.base_env(), "WECHAT_MINIAPP_FIXED_EGRESS_IP": "203.0.113.017"},
            {
                **self.base_env(),
                "WECHAT_MINIAPP_FIXED_EGRESS_ECHO_URL": "http://echo.example/ip",
            },
            {
                **self.base_env(),
                "WECHAT_MINIAPP_FIXED_EGRESS_ECHO_URL": "https://echo.example:8443/ip",
            },
        )
        for environment in invalid_environments:
            with self.subTest(environment=environment):
                with self.assertRaises(FixedEgressError):
                    target.config_from_env(environment, expected_version="7.2.10")

    def test_default_echo_url_uses_reachable_aws_checkip_endpoint(self):
        environment = self.base_env()
        environment.pop("WECHAT_MINIAPP_FIXED_EGRESS_ECHO_URL")
        config = target.config_from_env(environment, expected_version="7.2.10")
        self.assertEqual(config.echo_url, "https://checkip.amazonaws.com/")
        self.assertIn(("checkip.amazonaws.com", 443), config.allowlist)

    def test_health_requires_ok_true_and_exact_version(self):
        target.check_health(
            "https://health.example/check",
            "7.2.10",
            fetcher=lambda _url, _timeout: {"ok": True, "version": "7.2.10"},
        )
        for payload in (
            {"ok": False, "version": "7.2.10"},
            {"ok": True, "version": "7.2.9"},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(FixedEgressError):
                    target.check_health(
                        "https://health.example/check",
                        "7.2.10",
                        fetcher=lambda _url, _timeout, value=payload: value,
                    )

    def test_direct_health_opener_disables_proxies_and_verifies_tls(self):
        opener = target.build_direct_https_opener()
        proxy_handlers = [
            handler
            for handler in opener.handlers
            if isinstance(handler, target.request.ProxyHandler)
        ]
        https_handlers = [
            handler
            for handler in opener.handlers
            if isinstance(handler, target.request.HTTPSHandler)
        ]
        self.assertEqual(proxy_handlers, [])
        self.assertEqual(https_handlers[0]._context.verify_mode, target.ssl.CERT_REQUIRED)
        self.assertTrue(https_handlers[0]._context.check_hostname)

    def test_local_preflight_requires_matching_versions_ci_and_key(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ci_dir = root / "miniapp" / "node_modules" / "miniprogram-ci"
            ci_dir.mkdir(parents=True)
            key_path = root / "private.key"
            key_path.write_text("local-only", encoding="utf-8")
            (root / "package.json").write_text(
                '{"version":"7.2.10"}', encoding="utf-8"
            )
            miniapp_package = root / "miniapp" / "package.json"
            miniapp_package.write_text(
                '{"version":"7.2.10","devDependencies":{"miniprogram-ci":"2.1.31"}}',
                encoding="utf-8",
            )
            (ci_dir / "package.json").write_text(
                '{"version":"2.1.31"}', encoding="utf-8"
            )
            environment = {"WECHAT_MINIAPP_PRIVATE_KEY_PATH": str(key_path)}
            target.verify_local_upload_inputs(
                environment,
                expected_version="7.2.10",
                root=root,
            )
            miniapp_package.write_text(
                '{"version":"7.2.10","devDependencies":{"miniprogram-ci":"^2.1.31"}}',
                encoding="utf-8",
            )
            with self.assertRaises(FixedEgressError):
                target.verify_local_upload_inputs(
                    environment,
                    expected_version="7.2.10",
                    root=root,
                )

    def test_probe_requires_exact_egress_then_servicewechat_tls(self):
        observed = []

        def probe(kind, **kwargs):
            observed.append((kind, kwargs))
            return "203.0.113.17" if kind == "egress" else True

        target.probe_proxy(
            "http://127.0.0.1:18080",
            "https://echo.example/ip",
            "203.0.113.17",
            probe=probe,
        )
        self.assertEqual([kind for kind, _kwargs in observed], ["egress", "tls"])
        self.assertEqual(observed[1][1]["host"], "servicewechat.com")
        with self.assertRaises(FixedEgressError):
            target.probe_proxy(
                "http://127.0.0.1:18080",
                "https://echo.example/ip",
                "203.0.113.17",
                probe=lambda kind, **_kwargs: (
                    "203.0.113.18" if kind == "egress" else True
                ),
            )

    def test_egress_request_is_explicitly_tunneled_through_loopback(self):
        observed = {}

        class FakeResponse:
            def read(self, _limit):
                return b'{"ip":"203.0.113.17"}'

            def close(self):
                return None

        class FakeOpener:
            def open(self, echo_request, timeout):
                observed["host"] = echo_request.host
                observed["tunnel_host"] = echo_request._tunnel_host
                observed["timeout"] = timeout
                return FakeResponse()

        original_builder = target.request.build_opener
        target.request.build_opener = lambda *_handlers: FakeOpener()
        try:
            result = target._probe_egress(
                "http://127.0.0.1:18080",
                "https://echo.example/ip",
                1.25,
            )
        finally:
            target.request.build_opener = original_builder
        self.assertEqual(result, "203.0.113.17")
        self.assertEqual(observed["host"], "127.0.0.1:18080")
        self.assertEqual(observed["tunnel_host"], "echo.example")


if __name__ == "__main__":
    unittest.main(verbosity=2)
