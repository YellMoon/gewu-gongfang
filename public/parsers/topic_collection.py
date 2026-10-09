"""Desktop-only import of numbered topic collections with inline solutions."""
import json
import re
import sys
from pathlib import Path

BASE_PARSERS = Path(__file__).resolve().parents[2] / 'modules' / 'question-bank' / 'parsers'
sys.path.insert(0, str(BASE_PARSERS))
import parse_word as word

NUMBER = re.compile(r'^(\d+)[\u3001\uff0e.]\s*(?!\d)(.+)', re.S)
ANSWER = re.compile(r'^\s*\u3010\u7b54\u6848\u3011\s*')
ANALYSIS = re.compile(r'^\s*\u3010(?:\u8be6\u89e3|\u89e3\u6790|\u5206\u6790|\u89e3\u7b54)\u3011\s*')
SOURCE_PREFIX = re.compile(r'^\s*[\uff08(]([^\uff09)]{1,160})[\uff09)]\s*')
SOURCE_INFO = re.compile(r'(?:19|20)\d{2}\s*[\u00b7\u2022.\uff0e-]|[\u00b7\u2022].*(?:\u6a21|\u8003|\u5377)|(?:\u4e00|\u4e8c|\u4e09)\u6a21|\u9ad8\u8003|\u8054\u8003|\u671f\u4e2d|\u671f\u672b|\u6708\u8003|\u6765\u6e90|\u9009\u81ea|\u6539\u7f16|\u539f\u521b|\u5b66\u79d1\u7f51|\u7ec4\u5377\u7f51|(?:\u7701|\u5e02|\u533a).*(?:\u4e2d\u5b66|\u5b66\u6821)')
GROUP_NUMBER = re.compile(r'(?:^|\s)(\d+)[\u3001\uff0e.]\s*(?!\d)')


def clean_leading_source(text):
    count = 0
    while True:
        match = SOURCE_PREFIX.match(text)
        if not match or not SOURCE_INFO.search(match.group(1)):
            return text, count
        text = text[match.end():]
        count += 1


def append_solution(question, phase, text):
    question[phase] = (question.get(phase, '') + '\n' + text).strip()


def assign_group(text, phase, by_number, pending):
    matches = list(GROUP_NUMBER.finditer(text))
    if not matches or any(int(match.group(1)) not in pending for match in matches):
        return None
    for index, match in enumerate(matches):
        finish = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        append_solution(by_number[int(match.group(1))], phase, text[match.end():finish].strip())
    return by_number[int(matches[-1].group(1))]


def parse_rows(rows):
    questions, by_number = [], {}
    current, section, phase, expected = None, '', 'stem', None
    shared, preamble, pending = [], [], set()
    removed_sources = 0
    skipped_groups, skipped_numbers = [], set()
    title = ''
    for row in rows:
        text = row.get('text', '').strip()
        if not text:
            continue
        if word.is_exam_section_heading(text):
            current, section, phase, expected = None, text, 'stem', None
            shared, preamble, pending = [], [], set()
            continue
        answer_match, analysis_match = ANSWER.match(text), ANALYSIS.match(text)
        if answer_match or analysis_match:
            if current is None:
                continue
            phase = 'answer' if answer_match else 'analysis'
            text = text[(answer_match or analysis_match).end():].strip()
            if answer_match:
                unanswered = {q['number'] for q in questions if not q['answer'] and q['section_title'] == section}
                numbered = {int(match.group(1)) for match in GROUP_NUMBER.finditer(text)}
                pending = numbered if len(numbered) > 1 and numbered <= unanswered else set()
                consecutive = []
                for question in reversed(questions):
                    if question['section_title'] != section or question['answer']:
                        break
                    consecutive.append(question['number'])
                ambiguous = pending or (set(consecutive) if len(consecutive) > 1 and shared else set())
                if ambiguous and not ambiguous <= skipped_numbers:
                    skipped_groups.append({'numbers': sorted(ambiguous), 'reason': 'shared_material_or_combined_answers'})
                    skipped_numbers.update(ambiguous)
            grouped = assign_group(text, phase, by_number, pending) if pending else None
            if grouped is not None:
                current = grouped
            elif text:
                append_solution(current, phase, text)
            continue
        match = NUMBER.match(text)
        number = int(match.group(1)) if match else None
        if phase in ('answer', 'analysis') and pending and number in pending:
            current = by_number[number]
            append_solution(current, phase, match.group(2))
            continue
        if match and (expected is None or number == expected):
            stem, removed = clean_leading_source(match.group(2))
            removed_sources += removed
            if preamble:
                shared = preamble
                preamble = []
            current = word.new_question('\n'.join([*shared, stem]), len(questions))
            current.update(number=number, question_number=number, section_title=section, source=title)
            questions.append(current)
            by_number[number] = current
            phase, expected, pending = 'stem', number + 1, set()
            continue
        if current is None:
            if not section and not title and not row.get('formulas'):
                title = re.sub(r'<[^>]+>', '', text).strip()
            elif not (re.search(r'\u5b66\u6821[:\uff1a].*\u59d3\u540d[:\uff1a]', text) or re.search(r'\u8003\u53f7[:\uff1a].*_', text)):
                preamble.append(text)
            continue
        if phase != 'stem':
            append_solution(current, phase, text)
            continue
        option, content = word.extract_option(text)
        if option:
            choice_section = re.search(r'(?:\u5355\u9009\u9898|\u591a\u9009\u9898|\u9009\u62e9\u9898)', section)
            if word.should_inline_option(current) and not (choice_section and not current['sub_questions']):
                word.append_text(current, text)
            else:
                current['options'].append({'label': option, 'content': content, 'is_correct': False})
            continue
        label, content = word.extract_sub_question(text)
        if label:
            current['sub_questions'].append({'title': label, 'content': content, 'answer': ''})
        else:
            word.append_text(current, text)
    detected_count = len(questions)
    # The desktop adapter applies the skip policy after strict parser validation.
    # Retaining raw parsed rows here also supports an all-skipped document without
    # weakening the shared parser's non-empty output contract.
    for question in questions:
        # Assign only formulas actually referenced by this question, including
        # numbered answers shared on a single source paragraph.
        formula_ids = word._formula_ids_in_markup(word._question_rich_text(question))
        for row in rows:
            formulas = [formula for formula in row.get('formulas', []) if formula.get('id') in formula_ids]
            if formulas:
                word.attach_rich_content(question, {**row, 'formulas': formulas})
        # Answers belong to the complete question. Numbered answer paragraphs
        # remain in the main answer instead of populating sub-question answers.
        word.finalize_question_type(question)
        choice_answer = re.sub(r'[\s,\uff0c\u3001;\uff1b]+', '', question['answer']).upper()
        if re.fullmatch(r'[A-G]+', choice_answer):
            for option in question['options']:
                option['is_correct'] = option['label'].upper() in choice_answer
    word.attach_referenced_assets_from_rich_rows(questions, rows)
    for question in questions:
        question['rich_content'] = word.build_question_rich_content(question)
    return questions, {'removed_source_prefixes': removed_sources, 'numbered_questions': len(questions) - len(skipped_numbers),
                       'detected_numbered_questions': detected_count, 'skipped_groups': skipped_groups}


def main():
    rows = word.read_docx_token_rich_blocks(sys.argv[1], collapse_tables=True)
    questions, topic_report = parse_rows(rows)
    skipped = {number for group in topic_report['skipped_groups'] for number in group['numbers']}
    report = word.quality_report([question for question in questions if question['number'] not in skipped])
    report['topic_collection'] = topic_report
    report['image_cleanup'] = {'removed_count': sum(len(row.get('removed_images', [])) for row in rows),
                               'removed_images': [image for row in rows for image in row.get('removed_images', [])]}
    print(json.dumps({'success': True, 'source_type': 'lecture', 'count': len(questions), 'questions': questions,
                      'quality_report': report}, ensure_ascii=False))


if __name__ == '__main__':
    main()
