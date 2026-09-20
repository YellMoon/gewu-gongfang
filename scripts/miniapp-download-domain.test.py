import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import run_real_miniapp_role_ui as subject


class DownloadDomainTest(unittest.TestCase):
    def project(self, folder, *, check=True, private=None):
        root = Path(folder)
        (root / 'project.config.json').write_text(json.dumps({'setting': {'urlCheck': check}}), encoding='utf-8')
        if private is not None:
            (root / 'project.private.config.json').write_text(json.dumps({'setting': {'urlCheck': private}}), encoding='utf-8')
        return root

    def test_download_uses_real_wx_download_without_a_login_token(self):
        with tempfile.TemporaryDirectory() as folder:
            project = self.project(folder)
            with patch.object(subject, 'run_wx_api', return_value={'statusCode': 200, 'tempFilePath': 'http://tmp/health.json'}) as call:
                result = subject.verify_download_domain(project)
        self.assertEqual(result, {'downloadDomain': 'https://physicsedu.xyz', 'statusCode': 200, 'domainCheckEnabled': True})
        self.assertEqual(call.call_args.args[1], 'downloadFile')
        options = call.call_args.args[2][0]
        self.assertEqual(options['url'], 'https://physicsedu.xyz/cloud-business/api/health')
        self.assertNotIn('header', options)
        self.assertNotIn('tempFilePath', result)

    def test_disabled_domain_check_cannot_pass_acceptance(self):
        for check, private in [(False, None), (True, False), (False, False)]:
            with self.subTest(check=check, private=private), tempfile.TemporaryDirectory() as folder:
                project = self.project(folder, check=check, private=private)
                with patch.object(subject, 'run_wx_api') as call:
                    with self.assertRaisesRegex(RuntimeError, 'DOWNLOAD_DOMAIN_CHECK_DISABLED'):
                        subject.verify_download_domain(project)
                    call.assert_not_called()

    def test_private_true_overrides_disabled_shared_setting(self):
        with tempfile.TemporaryDirectory() as folder:
            project = self.project(folder, check=False, private=True)
            with patch.object(subject, 'run_wx_api', return_value={'statusCode': 200, 'tempFilePath': 'wxfile://tmp/health'}):
                self.assertTrue(subject.verify_download_domain(project)['domainCheckEnabled'])

    def test_blocked_download_is_a_hard_failure_not_a_request_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            project = self.project(folder)
            with patch.object(subject, 'run_wx_api', side_effect=RuntimeError('createDownloadTask:fail url not in domain list')) as call:
                with self.assertRaisesRegex(RuntimeError, 'DOWNLOAD_DOMAIN_NOT_ALLOWED'):
                    subject.verify_download_domain(project)
                self.assertEqual(call.call_count, 1)

    def test_missing_config_and_invalid_downloads_cannot_pass(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, 'DOWNLOAD_DOMAIN_CONFIG_INVALID'):
                subject.verify_download_domain(Path(folder))
            project = self.project(folder)
            for result in [None, {}, {'statusCode': 403}, {'statusCode': 200}, {'statusCode': 200, 'tempFilePath': ''}]:
                with self.subTest(result=result), patch.object(subject, 'run_wx_api', return_value=result):
                    with self.assertRaisesRegex(RuntimeError, 'DOWNLOAD_PROBE_FAILED'):
                        subject.verify_download_domain(project)

    def test_probe_only_checks_domain_without_changing_login_or_creating_sessions(self):
        with tempfile.TemporaryDirectory() as folder:
            project = self.project(folder)
            with patch.object(subject, 'verify_download_domain', return_value={'statusCode': 200}) as probe, \
                    patch.object(subject, 'snapshot_session_state') as snapshot, \
                    patch.object(subject, 'fetch_sessions') as sessions, patch('builtins.print'):
                subject.main(['--project', str(project), '--download-domain-only'])
            probe.assert_called_once_with(project.resolve())
            snapshot.assert_not_called()
            sessions.assert_not_called()

    def test_all_page_runs_gate_downloads_before_changing_the_login(self):
        with tempfile.TemporaryDirectory() as folder:
            project = self.project(folder)
            with patch.object(subject, 'verify_download_domain', side_effect=RuntimeError('DOWNLOAD_DOMAIN_NOT_ALLOWED')) as probe, \
                    patch.object(subject, 'snapshot_session_state') as snapshot:
                with self.assertRaisesRegex(RuntimeError, 'DOWNLOAD_DOMAIN_NOT_ALLOWED'):
                    subject.main(['--project', str(project), '--role', 'visitor', '--pages'])
            probe.assert_called_once()
            snapshot.assert_not_called()


if __name__ == '__main__':
    unittest.main()
