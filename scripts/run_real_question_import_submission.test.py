import unittest

import run_real_question_import_submission as subject


class RealQuestionImportSubmissionRunnerTests(unittest.TestCase):
    def test_task_id_validation_accepts_only_import_task_ids(self):
        self.assertEqual(
            subject.valid_task_id("question_import_task_exam_12345678"),
            "question_import_task_exam_12345678",
        )
        for value in ("", "question_import_task_short", "schedule_12345678", "question_import_task_bad;rm"):
            with self.assertRaises(ValueError):
                subject.valid_task_id(value)

    def test_receipt_requires_both_requested_tasks_to_be_submitted(self):
        exam = "question_import_task_exam_12345678"
        lecture = "question_import_task_lecture_12345678"
        payload = {
            "ok": True,
            "imports": [
                {"taskId": exam, "submittedCount": 19, "alreadySubmittedCount": 0, "status": "submitted"},
                {"taskId": lecture, "submittedCount": 88, "alreadySubmittedCount": 0, "status": "submitted"},
            ],
        }
        self.assertEqual(subject.parse_receipt(__import__("json").dumps(payload), exam, lecture), payload)

        payload["imports"][1]["status"] = "drafts_prepared"
        with self.assertRaises(ValueError):
            subject.parse_receipt(__import__("json").dumps(payload), exam, lecture)


if __name__ == "__main__":
    unittest.main()
