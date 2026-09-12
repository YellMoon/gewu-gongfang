from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from parse_word import parse_lecture_numbered_items, quality_report, should_inline_option


class LectureChoiceBoundariesTests(unittest.TestCase):
    def test_choice_stems_mentioning_experiments_or_comprehensive_control_keep_options(self):
        for stem in ('通过实验测重力加速度，结果为（    ）',
                     '气球趣味实验中子弹减速，正确的是（    ）',
                     '综合车辆的动力控制，正确的是（    ）'):
            with self.subTest(stem=stem):
                question = parse_lecture_numbered_items([
                    {'text': stem, 'number_kind': 'practice', 'comments': ['BC']},
                    {'text': 'A．第一项 B．第二项'}, {'text': 'C．第三项 D．第四项'},
                ])[0]
                self.assertEqual([item['label'] for item in question['options']], list('ABCD'))
                self.assertNotIn('第一项', question['stem'])
                self.assertEqual(question['question_types'], ['multi'])

    def test_nested_experiment_options_stay_with_subquestion(self):
        self.assertTrue(should_inline_option({'stem': '实验中选择器材（    ）', 'sub_questions': [{'title': '(1)'}]}))
        self.assertTrue(should_inline_option({'stem': '实验步骤如下', 'sub_questions': []}))

    def test_source_comment_is_not_part_of_choice_answer(self):
        for source in ('2019全国I卷', '2019全国Ⅰ卷', '2019全国卷I'):
            with self.subTest(source=source):
                question = parse_lecture_numbered_items([
                    {'text': '篮球上升的时间比（    ）', 'number_kind': 'example', 'comments': [source, 'C']},
                    *[{'text': f'{label}．选项{label}'} for label in 'ABCD'],
                ])[0]
                self.assertEqual(question['answer'], 'C')
                self.assertEqual(question['source_info']['year'], '2019')
                self.assertEqual(question['source_info']['region'], '全国')
                self.assertEqual(question['question_types'], ['single'])

    def test_answer_explanation_comment_is_preserved(self):
        question = parse_lecture_numbered_items([
            {'text': '速度为多少？', 'number_kind': 'example', 'comments': ['结果为 2 m/s，采用2019全国I卷的方法。']},
        ])[0]
        self.assertEqual(question['answer'], '结果为 2 m/s，采用2019全国I卷的方法。')

    def test_quality_report_does_not_call_missing_choice_options_clean(self):
        report = quality_report([{'stem': '实验背景（    ）', 'question_types': ['single'], 'answer': 'A', 'options': []}])
        self.assertEqual(report['warnings'].get('missing_options'), 1)


if __name__ == '__main__':
    unittest.main()
