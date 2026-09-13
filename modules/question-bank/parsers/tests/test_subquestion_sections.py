# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from parse_word import build_question_rich_content, parse_exam_question_block, parse_exam_questions, parse_lecture_numbered_items, parse_question_block


def plain(node):
    if node.get('type') == 'text':
        return node.get('text', '')
    if node.get('type') == 'formula':
        return node.get('attrs', {}).get('canonicalLatex', '')
    return ''.join(plain(child) for child in node.get('content', []))


class SubquestionSectionsTests(unittest.TestCase):
    def test_numbered_analysis_does_not_overwrite_subquestion_answers(self):
        # UTF-8: the source repeats (1)/(2) in answers and worked solutions.
        answer_formula = '<span data-formula-id="answer-work" data-latex="W=Q-mgd"></span>'
        for analysis_start in ['【详解】（1）温度推导。', '【详解】\n（1）温度推导。']:
            with self.subTest(analysis_start=analysis_start):
                question = parse_exam_questions([
                    '1. 活塞缓慢移动。', '(1) 求温度。', '(2) 求做功。',
                    '参考答案', '1. (1) 温度结果', '(2) ' + answer_formula,
                    *analysis_start.splitlines(), '（2）根据热力学第一定律。', '整理后得出结论。',
                ])[0]
                self.assertEqual(question['sub_questions'][1]['answer'], answer_formula)
                self.assertIn('（1）温度推导。', question['analysis'])
                self.assertIn('（2）根据热力学第一定律。', question['analysis'])
                self.assertIn('整理后得出结论。', question['analysis'])
                question['formulas'] = [{'id': 'answer-work', 'canonical_latex': 'W=Q-mgd',
                                         'source': {'part_name': 'word/document.xml'}}]
                rich = build_question_rich_content(question)['sections']
                self.assertNotIn('W=Q-mgd', plain(rich['stem']))
                self.assertEqual(plain(rich['subQuestions'][1]['answer']), 'W=Q-mgd')

    def test_inline_analysis_marker_keeps_following_numbered_steps_in_analysis(self):
        question = parse_exam_questions([
            '1. 计算。', '(1) 第一问。', '(2) 第二问。', '参考答案',
            '1. 答案结果【解析】（1）第一步。', '（2）第二步。',
        ])[0]
        self.assertEqual(question['answer'], '答案结果')
        self.assertEqual(question['analysis'], '（1）第一步。\n（2）第二步。')
        self.assertEqual([sub['answer'] for sub in question['sub_questions']], ['', ''])

    def test_each_import_path_assigns_body_to_one_section_only(self):
        intro = '物块与传送带间有摩擦，完成下列问题。'
        parts = ['(1) 求物块的速度。', '已知初始条件如下。', '① 求初速度。',
                 'A．正向运动', 'B．反向运动', '② 求热量。', '(2) 求绳的拉力。', '(3) 求碰撞间隔时间。']
        parsed = [
            ('generic', parse_question_block(['1. ' + intro, *parts])),
            ('exam', parse_exam_question_block(['1. ' + intro, *parts])),
            ('lecture', parse_lecture_numbered_items([
                {'text': intro, 'number_kind': 'example'}, *[{'text': text} for text in parts],
            ])),
        ]
        for mode, questions in parsed:
            with self.subTest(mode=mode):
                self.assertEqual(len(questions), 1)
                question = questions[0]
                self.assertEqual(question['stem'], intro)
                self.assertEqual(len(question['sub_questions']), 5)
                self.assertIn('已知初始条件如下。', question['sub_questions'][0]['content'])
                self.assertIn('A．正向运动', question['sub_questions'][1]['content'])
                self.assertIn('B．反向运动', question['sub_questions'][1]['content'])
                rich = build_question_rich_content(question)['sections']
                self.assertEqual(plain(rich['stem']), intro)
                rendered = plain(rich['stem']) + ''.join(plain(sub['content']) for sub in rich['subQuestions'])
                for marker in ['求物块的速度。', '已知初始条件如下。', '求初速度。', '正向运动', '反向运动', '求热量。', '求绳的拉力。', '求碰撞间隔时间。']:
                    self.assertEqual(rendered.count(marker), 1, marker)

    def test_continuation_without_subquestions_stays_in_stem(self):
        question = parse_question_block(['1. 题干第一行。', '题干第二行。'])[0]
        self.assertEqual(question['stem'], '题干第一行。\n题干第二行。')
        self.assertEqual(question['sub_questions'], [])

    def test_subquestion_formula_is_not_relocated_to_stem(self):
        formula = '<span data-formula-id="formula-sub-1" data-latex="v^{2}=2as"></span>'
        question = parse_question_block(['1. 求以下物理量。', '(1) 计算 ' + formula])[0]
        rich = build_question_rich_content(question)['sections']
        self.assertNotIn('v', plain(rich['stem']))
        self.assertIn('v^{2}=2as', plain(rich['subQuestions'][0]['content']))

    def test_diagrams_remain_once_in_their_source_subquestion(self):
        # UTF-8: keep each diagram with its source subquestion, without copies.
        image_a = '<img src="question-asset://' + 'a' * 64 + '" alt="first" />'
        image_b = '<img src="question-asset://' + 'b' * 64 + '" alt="second" />'
        question = parse_question_block(['1. 实验装置如下。', '(1) 第一组测量。', image_a, '(2) 第二组测量。', image_b])[0]
        self.assertNotIn('<img', question['stem'])
        self.assertIn(image_a, question['sub_questions'][0]['content'])
        self.assertIn(image_b, question['sub_questions'][1]['content'])
        rich = build_question_rich_content(question)
        def images(node):
            return ([node['attrs']['assetKey']] if node.get('type') == 'image' else []) + [key for child in node.get('content', []) for key in images(child)]
        sections = rich['sections']
        all_images = images(sections['stem']) + [key for sub in sections['subQuestions'] for key in images(sub['content'])]
        self.assertEqual(all_images, ['a' * 64, 'b' * 64])


if __name__ == '__main__':
    unittest.main()
