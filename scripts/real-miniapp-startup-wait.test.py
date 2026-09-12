import unittest
from pathlib import Path
from unittest.mock import patch
import run_real_miniapp_role_ui as subject


class StartupWaitTests(unittest.TestCase):
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
                with self.assertRaisesRegex(RuntimeError, 'STARTUP_HOME_NOT_READY'):
                    subject.wait_for_startup_home(Path('C:/miniapp'), 'qa', attempts=2)


if __name__ == '__main__':
    unittest.main()
