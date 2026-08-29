import json
import unittest

import run_real_question_import_publish as subject


class RealQuestionImportPublishRunnerTests(unittest.TestCase):
    def test_task_id_validation_accepts_only_import_task_ids(self):
        self.assertEqual(subject.valid_task_id("question_import_task_exam_12345678"), "question_import_task_exam_12345678")
        for value in ("", "question_import_task_short", "schedule_12345678", "question_import_task_bad;rm"):
            with self.assertRaises(ValueError):
                subject.valid_task_id(value)

    def test_receipt_requires_exactly_two_published_samples(self):
        exam = "question_import_task_exam_12345678"
        lecture = "question_import_task_lecture_12345678"
        receipt = {"ok": True, "questionIds": ["question-import-a", "question-import-b"], "publishedCount": 2}
        self.assertEqual(subject.parse_receipt(json.dumps(receipt), exam, lecture), receipt)
        receipt["publishedCount"] = 1
        with self.assertRaises(ValueError):
            subject.parse_receipt(json.dumps(receipt), exam, lecture)


if __name__ == "__main__":
    unittest.main()
