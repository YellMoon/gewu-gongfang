import unittest
from run_business_parity_shadow import validate_backup, validate_target


class BusinessParityShadowGuardTest(unittest.TestCase):
    def backup(self):
        root = '/root/scheduling-backups/postgres/20260907-083758'
        return dict(root=root, dump=root+'/gewu_cloud.dump', sha256='a'*64,
                    restoreVerified=True, ownershipAndPrivilegesVerified=True, securityFingerprint='b'*32)

    def test_requires_security_preserving_backup(self):
        self.assertEqual(validate_backup(self.backup()), self.backup())
        for key in ('ownershipAndPrivilegesVerified','securityFingerprint','restoreVerified','sha256'):
            value = self.backup(); del value[key]
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError,'VERIFIED_BACKUP_REQUIRED'):
                validate_backup(value)

    def test_never_accepts_production_or_arbitrary_restore_targets(self):
        self.assertEqual(validate_target('gewu_ui_shadow_'+'a'*16),'gewu_ui_shadow_'+'a'*16)
        for name in ('gewu_cloud','postgres','gewu_ui_shadow_','gewu_ui_shadow_'+'a'*16+';id'):
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError,'ISOLATED_SHADOW_REQUIRED'):
                validate_target(name)
        value = self.backup(); value['dump']='/root/live/gewu_cloud.dump'
        with self.assertRaisesRegex(RuntimeError,'VERIFIED_BACKUP_REQUIRED'):
            validate_backup(value)


if __name__ == '__main__': unittest.main()
