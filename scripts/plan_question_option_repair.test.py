import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from plan_question_option_repair import propose, html_to_rich_document


def fixture(content='1 kmB\uff0e2 kmC\uff0e3 kmD\uff0e7 km'):
    options = [{'label': 'A', 'content': content, 'is_correct': False}]
    return {'id': 'question-import-' + 'a' * 40, 'status': 'draft', 'version': 2,
            'itemHash': 'a' * 64, 'sourceHash': 'b' * 64,
            'stem': 'Stem', 'answer': 'B', 'explanation': 'Analysis', 'options': options,
            'originalCandidate': {'options': copy.deepcopy(options)},
            'richContent': {'sections': {'stem': html_to_rich_document('Stem'),
                'answer': html_to_rich_document('B'), 'analysis': html_to_rich_document('Analysis'),
                'options': [{'id': 'original-A', 'label': 'A', 'isCorrect': False,
                             'content': html_to_rich_document(content)}]}}}


class OptionRepairTests(unittest.TestCase):
    def test_splits_only_options_preserving_other_fields_and_id(self):
        row = fixture()
        baseline = copy.deepcopy(row)
        after = propose(row)
        self.assertEqual([o['label'] for o in after['options']], list('ABCD'))
        self.assertEqual(after['richContent']['sections']['options'][0]['id'], 'original-A')
        self.assertEqual(after['richContent']['sections']['stem'], row['richContent']['sections']['stem'])
        self.assertEqual(row, baseline)
        self.assertEqual(propose(row), after)

    def test_preserves_corrected_formula_identity(self):
        old = 'formula-1234567890123456 cd123456'
        row = fixture('<span data-formula-id="' + old + '" data-latex="x"></span>B.2C.3D.4')
        node = row['richContent']['sections']['options'][0]['content']['content'][0]['content'][0]
        node['attrs']['id'] = old.replace(' ', '')
        after = propose(row)
        self.assertEqual(after['richContent']['sections']['options'][0]['content']['content'][0]['content'][0], node)

    def test_refuses_edited_rich_or_original(self):
        row = fixture()
        row['richContent']['sections']['options'][0]['content']['content'][0]['content'][0]['text'] += '!'
        with self.assertRaisesRegex(ValueError, 'RICH_BASELINE_CHANGED'):
            propose(row)
        row = fixture()
        row['originalCandidate']['options'][0]['content'] += '!'
        with self.assertRaisesRegex(ValueError, 'ORIGINAL_CHANGED'):
            propose(row)

    def test_rejects_published_and_incomplete_sequences(self):
        row = fixture()
        row['status'] = 'published'
        with self.assertRaisesRegex(ValueError, 'SCOPE_INVALID'):
            propose(row)
        self.assertIsNone(propose(fixture('from A.point to B.point')))

    def test_does_not_treat_markup_attributes_as_labels(self):
        self.assertIsNone(propose(fixture('<img src="question-asset://B.C.D.image">')))

    def test_refuses_style_loss_when_html_tag_spans_options(self):
        with self.assertRaisesRegex(ValueError, 'VISIBLE_PAYLOAD_CHANGED'):
            propose(fixture('<i>1B.2C.3D.4</i>'))


if __name__ == '__main__':
    unittest.main()
