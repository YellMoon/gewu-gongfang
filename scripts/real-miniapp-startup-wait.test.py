import unittest
from pathlib import Path
from unittest.mock import patch
import run_real_miniapp_role_ui as subject


class StartupWaitTests(unittest.TestCase):
    def test_refresh_timeout_is_bounded_and_identity_is_rechecked(self):
        timeout = RuntimeError('timeout waiting for automator response')
        ready = {'route': 'pages/index/index', 'accountId': 'qa'}
        with patch.object(subject, 'run_wechatide', side_effect=[timeout, ready]) as run, patch.object(subject.time, 'sleep'):
            subject.wait_for_startup_home(Path('C:/miniapp'), 'qa', attempts=2)
        self.assertEqual(run.call_count, 2)
        with patch.object(subject, 'run_wechatide', side_effect=timeout) as run, patch.object(subject.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'timeout waiting for automator response'):
                subject.wait_for_startup_home(Path('C:/miniapp'), 'qa')
        self.assertEqual(run.call_count, 3, 'persistent bridge failures must stop, not consume all 12 route polls')
        with patch.object(subject, 'run_wechatide', side_effect=RuntimeError('permission denied')) as run:
            with self.assertRaisesRegex(RuntimeError, 'permission denied'):
                subject.wait_for_startup_home(Path('C:/miniapp'), 'qa')
        self.assertEqual(run.call_count, 1)

    def test_waits_for_real_home_route_not_just_storage(self):
        states = [{'route': 'pages/login/index', 'accountId': 'qa'},
                  {'route': 'pages/index/index', 'accountId': 'qa'}]
        with patch.object(subject, 'run_wechatide', side_effect=states) as run, patch.object(subject.time, 'sleep'):
            subject.wait_for_startup_home(Path('C:/miniapp'), 'qa', attempts=2)
        self.assertEqual(run.call_count, 2)
        self.assertTrue(all(call.args[0][0] == 'automation_evaluate' for call in run.call_args_list))
        expression = run.call_args.args[0][-1]
        self.assertIn("typeof getCurrentPages === 'function'", expression)
        self.assertIn("typeof wx !== 'undefined'", expression)

    def test_wrong_identity_or_unfinished_launch_never_passes(self):
        for state in ({'route': 'pages/index/index', 'accountId': 'other'},
                      {'route': 'pages/login/index', 'accountId': 'qa'}):
            with self.subTest(state=state), patch.object(subject, 'run_wechatide', return_value=state), patch.object(subject.time, 'sleep'):
                with self.assertRaisesRegex(RuntimeError, 'STARTUP_HOME_NOT_READY') as caught:
                    subject.wait_for_startup_home(Path('C:/miniapp'), 'qa', attempts=2)
                self.assertIn(state['route'], str(caught.exception))
                self.assertIn('accountMatches', str(caught.exception))
                self.assertNotIn('"accountId"', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
