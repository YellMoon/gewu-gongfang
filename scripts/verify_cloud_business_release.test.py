#!/usr/bin/env python3
"""Keep marked acceptance fixtures out of historical migration count gates."""

import unittest

import verify_cloud_business_release as release


class ReleaseVerificationSqlTests(unittest.TestCase):
    def test_marked_role_acceptance_profiles_do_not_change_historical_counts(self):
        sql = release.verification_sql()
        self.assertIn("id NOT LIKE 'e2e-teacher-%'", sql)
        self.assertIn("id NOT LIKE 'e2e-student-%'", sql)


if __name__ == "__main__":
    unittest.main()
