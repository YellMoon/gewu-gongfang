"""Offline proof of the specific legacy inline-A / appended-D-formula defect."""
import argparse
import copy
import json
import re
from pathlib import Path
from plan_question_option_repair import digest, formulas, reconcile_document, visible_payloads, html_to_rich_document
from parse_word import _ensure_formula_markup, recover_inline_first_option


def text_nodes(node):
    if isinstance(node,dict):
        if node.get('type')=='text':yield node
        for value in node.get('content',[]):yield from text_nodes(value)


def propose_inline(row):
    if (row.get('status')!='draft' or not re.fullmatch(r'question-import-[a-f0-9]{40}',row.get('id',''))
            or row['id']!='question-import-'+str(row.get('itemHash',''))[:40]
            or not re.fullmatch(r'[a-f0-9]{64}',row.get('sourceHash',''))
            or [option['label'] for option in row['options']]!=list('BCD')):
        raise ValueError('SCOPE_INVALID')
    original=row['originalCandidate']
    if row['stem']!=original.get('stem') or row['options']!=original.get('options'):
        raise ValueError('ORIGINAL_CHANGED')
    rich=copy.deepcopy(row['richContent'])
    stem=rich['sections']['stem']
    extra=stem['content'][-1]['content'][-1]
    extra_id=extra.get('attrs',{}).get('id')
    catalogue=[formula for formula in original.get('formulas',[]) if formula.get('id')==extra_id]
    if (extra.get('type')!='formula' or len(catalogue)!=1
            or catalogue[0].get('canonical_latex')!=extra['attrs'].get('canonicalLatex')
            or catalogue[0].get('source',{}).get('part_name')!='word/document.xml'):
        raise ValueError('APPENDED_FORMULA_UNPROVEN')
    option_d=rich['sections']['options'][-1]
    originals_in_d=[node for node in formulas(option_d) if node['attrs']['id']==extra_id]
    if (len(originals_in_d)!=1 or originals_in_d[0]['attrs']['canonicalLatex']!=extra['attrs']['canonicalLatex']
            or len(list(formulas(stem)))!=len(list(formulas(html_to_rich_document(row['stem']))))+1):
        raise ValueError('APPENDED_FORMULA_UNPROVEN')
    identities={}
    # Reproduce exactly the old append operation; all other rich nodes must match.
    reconcile_document(html_to_rich_document(_ensure_formula_markup(row['stem'],catalogue)),stem,identities)
    stem['content'][-1]['content'].pop()
    if not stem['content'][-1]['content']:stem['content'].pop()
    reconcile_document(html_to_rich_document(row['stem']),stem,identities)
    for raw,existing in zip(row['options'],rich['sections']['options']):
        if raw['label']!=existing['label'] or bool(raw.get('is_correct'))!=bool(existing.get('isCorrect')):
            raise ValueError('RICH_BASELINE_CHANGED')
        reconcile_document(html_to_rich_document(raw['content']),existing['content'],identities)
    after={'stem':row['stem'],'options':copy.deepcopy(row['options'])}
    recover_inline_first_option(after)
    if [option['label'] for option in after['options']]!=list('ABCD'):
        raise ValueError('A_OPTION_NOT_RECOVERED')
    # Fix only formula-ID attributes already reconciled against current rich nodes.
    def normalized_markup(value):
        return re.sub(r'(data-formula-id=["\'])([^"\']+)(["\'])',
                      lambda match:match[1]+identities.get(match[2],match[2])+match[3],value)
    after['stem']=normalized_markup(after['stem'])
    for option in after['options']:option['content']=normalized_markup(option['content'])
    next_stem=html_to_rich_document(after['stem'])
    next_a={'id':'option-'+digest([row['id'],'A'])[:12],'label':'A','isCorrect':False,
            'content':html_to_rich_document(after['options'][0]['content'])}
    for node in formulas([next_stem,next_a['content']]):
        old_id=node['attrs']['id']
        node['attrs']['id']=identities.get(old_id,old_id)
    without_marker=copy.deepcopy(stem)
    markers=[(node,match) for node in text_nodes(without_marker)
             for match in re.finditer(r'(?<![A-Za-z])A[.\uff0e]\s*',node['text'])]
    if not markers:raise ValueError('A_MARKER_UNPROVEN')
    node,match=markers[-1]
    node['text']=node['text'][:match.start()]+node['text'][match.end():]
    if list(visible_payloads(without_marker))!=list(visible_payloads([next_stem,next_a['content']])):
        raise ValueError('VISIBLE_PAYLOAD_CHANGED')
    if list(formulas(stem))!=list(formulas([next_stem,next_a['content']])):
        raise ValueError('FORMULA_PAYLOAD_CHANGED')
    rich['sections']['stem']=next_stem
    rich['sections']['options']=[next_a]+rich['sections']['options']
    after['richContent']=rich
    return after


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    rows=json.loads(Path(args.snapshot).read_text(encoding='utf-8'))
    entries=sorted([{'id':row['id'],'kind':'restore-inline-first-option','baselineHash':digest(row),
                     'after':propose_inline(row)} for row in rows],key=lambda entry:entry['id'])
    result={'mode':'offline-proposal-only','snapshotHash':digest(rows),'planHash':digest(entries),'entries':entries}
    with Path(args.output).open('x',encoding='utf-8') as handle:json.dump(result,handle,ensure_ascii=True)
    print(json.dumps({'mode':result['mode'],'proposed':len(entries),'planHash':result['planHash']}))
