import json
import subprocess
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
            with patch.object(subject, 'run_wechatide', return_value={'statusCode': 200, 'hasTempFile': True}) as call, \
                    patch.object(subject, 'run_wx_api') as direct:
                result = subject.verify_download_domain(project)
                direct.assert_not_called()
        self.assertEqual(result, {'downloadDomain': 'https://physicsedu.xyz', 'statusCode': 200, 'domainCheckEnabled': True})
        args = call.call_args.args[0]
        self.assertEqual(args[0], 'automation_evaluate')
        source = args[args.index('--fn-source') + 1]
        self.assertIn('wx.downloadFile', source)
        self.assertIn('https://physicsedu.xyz/cloud-business/api/health', source)
        self.assertNotIn('header', source)
        self.assertNotIn('wx.request', source)
        self.assertNotIn('\n', source, 'cmd boundary needs a single-line expression')
        self.assertNotIn('tempFilePath', result)

    def test_probe_waits_for_callbacks_and_never_serializes_download_task(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(subject, 'run_wechatide', return_value={'statusCode': 200, 'hasTempFile': True}) as call, \
                    patch.object(subject, 'run_wx_api', side_effect=AssertionError('native task is not a result')):
                subject.verify_download_domain(self.project(folder))
        args = call.call_args.args[0]
        source = args[args.index('--fn-source') + 1]
        # Execute the exact runtime expression. The native DownloadTask contains
        # methods and cannot be structured-cloned across DevTools' IPC boundary.
        runner = """
const assert = require('node:assert/strict');
let source = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => source += chunk);
process.stdin.on('end', async () => {
  try {
    for (const outcome of ['success', 'empty', 'forbidden', 'failure']) {
      let callbackFinished = false;
      global.wx = { downloadFile(options) {
        assert.equal(options.url, 'https://physicsedu.xyz/cloud-business/api/health');
        assert.equal(options.timeout, 30000);
        assert.equal(options.header, undefined);
        setImmediate(() => {
          callbackFinished = true;
          if (outcome === 'failure') options.fail({errMsg:'downloadFile:fail url not in domain list'});
          else options.success({statusCode:outcome === 'forbidden' ? 403 : 200,
            tempFilePath:outcome === 'empty' ? '' : 'wxfile://private-temporary-file'});
        });
        return {abort() {}, onProgressUpdate() {}};
      }};
      const value = await eval('(' + source + ')')();
      assert(callbackFinished, 'must await the actual completion callback');
      assert.deepEqual(structuredClone(value), value);
      assert(!JSON.stringify(value).includes('private-temporary-file'));
      if (outcome === 'failure') assert.match(value.error, /url not in domain list/);
      else {
        assert.equal(value.statusCode, outcome === 'forbidden' ? 403 : 200);
        assert.equal(value.hasTempFile, outcome !== 'empty');
      }
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
});
"""
        result = subprocess.run(['node', '-e', runner], input=source, capture_output=True, text=True, encoding='utf-8', timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_disabled_domain_check_cannot_pass_acceptance(self):
        for check, private in [(False, None), (True, False), (False, False)]:
            with self.subTest(check=check, private=private), tempfile.TemporaryDirectory() as folder:
                project = self.project(folder, check=check, private=private)
                with patch.object(subject, 'run_wechatide') as call:
                    with self.assertRaisesRegex(RuntimeError, 'DOWNLOAD_DOMAIN_CHECK_DISABLED'):
                        subject.verify_download_domain(project)
                    call.assert_not_called()

    def test_private_true_overrides_disabled_shared_setting(self):
        with tempfile.TemporaryDirectory() as folder:
            project = self.project(folder, check=False, private=True)
            with patch.object(subject, 'run_wechatide', return_value={'statusCode': 200, 'hasTempFile': True}):
                self.assertTrue(subject.verify_download_domain(project)['domainCheckEnabled'])

    def test_blocked_download_is_a_hard_failure_not_a_request_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            project = self.project(folder)
            with patch.object(subject, 'run_wechatide', return_value={'error': 'createDownloadTask:fail url not in domain list'}) as call:
                with self.assertRaisesRegex(RuntimeError, 'DOWNLOAD_DOMAIN_NOT_ALLOWED'):
                    subject.verify_download_domain(project)
                self.assertEqual(call.call_count, 1)

    def test_missing_config_and_invalid_downloads_cannot_pass(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(RuntimeError, 'DOWNLOAD_DOMAIN_CONFIG_INVALID'):
                subject.verify_download_domain(Path(folder))
            project = self.project(folder)
            for result in [None, {}, {'statusCode': 403}, {'statusCode': 200}, {'statusCode': 200, 'hasTempFile': False}, {'statusCode': 200, 'hasTempFile': 'true'}, {'error': 'downloadFile:fail timeout'}]:
                with self.subTest(result=result), patch.object(subject, 'run_wechatide', return_value=result):
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
