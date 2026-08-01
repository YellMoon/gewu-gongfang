import unittest

from repair_production_tls import CERTBOT_RENEW_COMMAND, ENABLED_BACKUP_NAMES, patch_nginx_config


class RepairProductionTlsTest(unittest.TestCase):
    def test_inserts_acme_route_before_http_catch_all(self):
        source = """server {
    listen 80;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:3001;
    }
}
"""

        patched = patch_nginx_config(source)

        self.assertIn("location /.well-known/acme-challenge/", patched)
        self.assertLess(
            patched.index("location /.well-known/acme-challenge/"),
            patched.index("location / {"),
        )
        self.assertEqual(patch_nginx_config(patched), patched)

    def test_rejects_config_without_expected_http_server(self):
        with self.assertRaisesRegex(ValueError, "NGINX_HTTP_SERVER_PATTERN_NOT_FOUND"):
            patch_nginx_config("server { listen 443 ssl; }")

    def test_only_known_enabled_backup_files_are_disabled(self):
        self.assertEqual(
            ENABLED_BACKUP_NAMES,
            (
                "education-platform.bak-20260627-131419",
                "education-platform.restore3002-20260627-131717",
            ),
        )

    def test_manual_repair_does_not_use_randomized_renew_command(self):
        self.assertIn("certbot certonly", CERTBOT_RENEW_COMMAND)
        self.assertIn("--webroot-path /var/www/certbot", CERTBOT_RENEW_COMMAND)
        self.assertNotIn("certbot renew", CERTBOT_RENEW_COMMAND)


if __name__ == "__main__":
    unittest.main()
