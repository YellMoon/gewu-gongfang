import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from parse_word import parse_exam_questions, finalize_question_type


class ExamSectionTypes(unittest.TestCase):
    def test_explicit_section_survives_answer_classification(self):
        questions = parse_exam_questions([
            '\u4e00\u3001\u5355\u9009\u9898', '1. \u4e00\u4e2a\u7269\u4f53\u9759\u6b62\uff0c\u6b63\u786e\u7684\u662f\uff08   \uff09', 'A. \u7532', 'B. \u4e59',
            '\u4e8c\u3001\u586b\u7a7a\u9898', '2. \u901f\u5ea6\u4e3a____\u3002',
            '\u4e09\u3001\u5b9e\u9a8c\u9898', '3. \u5982\u56fe\u8fde\u63a5\u7535\u8def\u3002',
            '\u56db\u3001\u89e3\u7b54\u9898', '4. \u6d3b\u585e\u5c01\u95ed\u4e00\u5b9a\u8d28\u91cf\u7684\u6c14\u4f53\u3002', '(1) \u6c42\u6e29\u5ea6\u3002',
            '5. \u7269\u5757\u6cbf\u659c\u9762\u8fd0\u52a8\u3002', '(1) \u6c42\u4f4d\u79fb\u3002',
            '\u53c2\u8003\u7b54\u6848', '1. A', '2. 3', '3. 4', '4. 5', '5. 6',
        ])
        self.assertEqual([q['question_types'] for q in questions], [['single'], ['fill'], ['experiment'], ['problem'], ['problem']])
        for q in questions:
            before = q['question_types'][:]
            self.assertEqual(finalize_question_type(q)['question_types'], before)

    def test_generic_non_choice_heading_does_not_force_a_type(self):
        question = {'stem': '\u5b9e\u9a8c\u4e2d\u6d4b\u91cf\u7535\u963b\u3002', 'section_title': '\u4e09\u3001\u975e\u9009\u62e9\u9898', 'options': [], 'answer': ''}
        self.assertEqual(finalize_question_type(question)['question_types'], ['experiment'])

    def test_actual_exam_comprehensive_section_is_solution(self):
        question = {'stem': '\u5982\u56fe\u6240\u793a\u6d3b\u585e\u5c01\u95ed\u4e00\u5b9a\u8d28\u91cf\u7684\u6c14\u4f53',
                    'section_title': '<strong>\u56db\u3001\u7efc\u5408\u9898</strong>', 'options': [], 'answer': ''}
        self.assertEqual(finalize_question_type(question)['question_types'], ['problem'])


if __name__ == '__main__':
    unittest.main()
