"""Offline proposal only: no connection, SQL, or production mutation capability."""
import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'modules/question-bank/parsers'))
from parse_word import html_to_rich_document, split_packed_options


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def formulas(node):
    if isinstance(node, dict):
        if node.get('type') in ('formula', 'formulaBlock'):
            yield node
        for value in node.values():
            yield from formulas(value)
    elif isinstance(node, list):
        for value in node:
            yield from formulas(value)


def reconcile_document(parsed, current, identities):
    """Only accept the already verified formula-ID repair, never text/LaTeX edits."""
    left, right = list(formulas(parsed)), list(formulas(current))
    if len(left) != len(right):
        raise ValueError('RICH_BASELINE_CHANGED')
    for old, existing in zip(left, right):
        old_id = old.get('attrs', {}).get('id', '')
        current_id = existing.get('attrs', {}).get('id', '')
        if old_id != current_id:
            canonical = re.sub(r'(?<=[0-9]) (?=(?:da|[adcf])?cd)', '', old_id)
            if canonical != current_id or not re.fullmatch(r'formula-[a-f0-9]{24}', current_id):
                raise ValueError('RICH_BASELINE_CHANGED')
            old['attrs']['id'] = current_id
        if old_id in identities and identities[old_id] != current_id:
            raise ValueError('FORMULA_ID_AMBIGUOUS')
        identities[old_id] = current_id
    if parsed != current:
        raise ValueError('RICH_BASELINE_CHANGED')


def visible_payloads(node, packed_label=None):
    """Compare every non-whitespace glyph/mark and every embedded object."""
    if isinstance(node, dict):
        kind = node.get('type')
        if kind == 'text':
            value = node['text']
            if packed_label:
                value = re.sub(r'([A-G])[.\uff0e]\s*',
                               lambda match: '' if match[1].upper() > packed_label else match[0],
                               value, flags=re.I)
            for glyph in value:
                if not glyph.isspace():
                    yield {'glyph': glyph, 'marks': node.get('marks', [])}
        elif kind in ('doc', 'paragraph'):
            yield from visible_payloads(node.get('content', []), packed_label)
        else:
            yield node
    elif isinstance(node, list):
        for value in node:
            yield from visible_payloads(value, packed_label)


def propose(row):
    if (row.get('status') != 'draft' or not re.fullmatch(r'question-import-[a-f0-9]{40}', row.get('id', ''))
            or row['id'] != 'question-import-' + str(row.get('itemHash', ''))[:40]
            or not re.fullmatch(r'[a-f0-9]{64}', row.get('sourceHash', ''))):
        raise ValueError('SCOPE_INVALID')
    if row['options'] != row.get('originalCandidate', {}).get('options'):
        raise ValueError('ORIGINAL_CHANGED')
    draft = {'options': copy.deepcopy(row['options'])}
    split_packed_options(draft)
    if draft['options'] == row['options']:
        return None
    rich = copy.deepcopy(row['richContent'])
    existing = rich['sections']['options']
    if len(existing) != len(row['options']):
        raise ValueError('RICH_BASELINE_CHANGED')
    identities = {}
    for raw, option in zip(row['options'], existing):
        if raw['label'] != option['label'] or bool(raw.get('is_correct')) != bool(option.get('isCorrect')):
            raise ValueError('RICH_BASELINE_CHANGED')
        reconcile_document(html_to_rich_document(raw['content']), option['content'], identities)
    original_by_label = {option['label']: option for option in existing}
    next_options = []
    for option in draft['options']:
        label = option['label']
        document = html_to_rich_document(option['content'])
        for node in formulas(document):
            old_id = node.get('attrs', {}).get('id')
            if old_id not in identities:
                raise ValueError('FORMULA_ID_ADDED')
            node['attrs']['id'] = identities[old_id]
        previous = original_by_label.get(label)
        next_options.append({
            **(copy.deepcopy(previous) if previous else {}),
            'id': previous['id'] if previous else 'option-' + digest([row['id'], label])[:12],
            'label': label, 'content': document, 'isCorrect': bool(option.get('is_correct'))})
    # Splitting must neither lose nor alter formula payloads or their ordering.
    if list(formulas(existing)) != list(formulas(next_options)):
        raise ValueError('FORMULA_PAYLOAD_CHANGED')
    before_payload = [value for option in existing
                      for value in visible_payloads(option['content'], option['label'])]
    after_payload = [value for option in next_options
                     for value in visible_payloads(option['content'])]
    if before_payload != after_payload:
        raise ValueError('VISIBLE_PAYLOAD_CHANGED')
    rich['sections']['options'] = next_options
    return {'options': draft['options'], 'richContent': rich}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    entries, skipped = [], []
    rows = json.loads(Path(args.snapshot).read_text(encoding='utf-8'))
    for row in rows:
        try:
            after = propose(row)
            if after:
                entries.append({'id': row['id'], 'baselineHash': digest(row), 'after': after})
            else:
                skipped.append({'id': row['id'], 'reason': 'NOT_PACKED_OPTIONS'})
        except ValueError as error:
            skipped.append({'id': row['id'], 'reason': str(error)})
    entries.sort(key=lambda entry: entry['id'])
    report = {'mode': 'offline-proposal-only', 'snapshotHash': digest(rows),
              'planHash': digest(entries), 'entries': entries, 'skipped': skipped}
    with Path(args.output).open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=True, separators=(',', ':'))
    print(json.dumps({'mode': report['mode'], 'proposed': len(entries), 'skipped': skipped,
                      'planHash': report['planHash']}, ensure_ascii=True))


if __name__ == '__main__':
    main()
