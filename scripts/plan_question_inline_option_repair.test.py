import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from plan_question_inline_option_repair import propose_inline
from plan_question_option_repair import formulas
from parse_word import build_question_rich_content

ORIGINAL_ID='formula-1234567890123456cd123456'
OLD_ID='formula-1234567890123456 cd123456'

def fixture():
    candidate={'stem':'Jump?<img src="question-asset://image">A.1&lt;<i>x</i>&lt;2',
        'options':[{'label':label,'content':value,'is_correct':False} for label,value in [
            ('B','2&lt;x&lt;3'),('C','3&lt;x&lt;4'),
            ('D','4&lt;<span data-formula-id="'+OLD_ID+'" data-latex="x" data-source-format="eq_field"></span>&lt;5')]],
        'formulas':[{'id':ORIGINAL_ID,'canonical_latex':'x','source':{'part_name':'word/document.xml'}}]}
    rich=build_question_rich_content(candidate)
    for node in formulas(rich):
        node['attrs']['id']=node['attrs']['id'].replace(' ','')
    return {'id':'question-import-'+'c'*40,'status':'draft','itemHash':'c'*64,'sourceHash':'d'*64,
        'stem':candidate['stem'],'options':copy.deepcopy(candidate['options']),
        'originalCandidate':candidate,'richContent':rich}


class InlineRepairTests(unittest.TestCase):
    def test_moves_a_preserves_bcd_and_removes_proven_append(self):
        row=fixture(); baseline=copy.deepcopy(row)
        after=propose_inline(row)
        self.assertEqual([option['label'] for option in after['options']],list('ABCD'))
        self.assertNotIn('A.1',after['stem'])
        self.assertIn('question-asset://image',after['stem'])
        self.assertEqual(after['richContent']['sections']['options'][1:],row['richContent']['sections']['options'])
        self.assertEqual(len(list(formulas(after['richContent']['sections']['stem']))),0)
        self.assertEqual(len(list(formulas(after['richContent']['sections']['options']))),1)
        self.assertIn(ORIGINAL_ID,after['options'][-1]['content'])
        self.assertNotIn(OLD_ID,after['options'][-1]['content'])
        self.assertEqual(row,baseline)
        self.assertEqual(propose_inline(row),after)

    def test_rejects_edited_stem_and_formula(self):
        row=fixture(); row['stem']+='edited'
        with self.assertRaisesRegex(ValueError,'ORIGINAL_CHANGED'):propose_inline(row)
        row=fixture(); list(formulas(row['richContent']['sections']['stem']))[-1]['attrs']['canonicalLatex']='different'
        with self.assertRaisesRegex(ValueError,'APPENDED_FORMULA_UNPROVEN'):propose_inline(row)
        row=fixture(); row['richContent']['sections']['stem']['content'][0]['content'][0]['text']='edited'
        with self.assertRaisesRegex(ValueError,'RICH_BASELINE_CHANGED'):propose_inline(row)

    def test_rejects_absent_original_formula_and_non_draft(self):
        row=fixture(); row['originalCandidate']['formulas']=[]
        with self.assertRaisesRegex(ValueError,'APPENDED_FORMULA_UNPROVEN'):propose_inline(row)
        row=fixture(); row['status']='published'
        with self.assertRaisesRegex(ValueError,'SCOPE_INVALID'):propose_inline(row)


if __name__=='__main__':unittest.main()
