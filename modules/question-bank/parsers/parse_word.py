#!/usr/bin/env python3
"""
格物工坊 — Word文档题目解析器
支持讲义（批注式答案）和试卷（参考答案分离式）两种格式
直接输出 JSON 到 stdout

用法: python3 parse_word.py <file_path> <source_type> [knowledge_tree_path]

source_type: lecture | exam
"""

import sys, json, io, uuid, re, os

# Ensure stdout can output UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def extract_question_number(text):
    """提取题号: '1. xxx' or '1、xxx' or '1．xxx'"""
    m = re.match(r'^(\d+)[\.、．]\s*(.*)', text)
    if m: return int(m.group(1)), m.group(2).strip()
    return None, text

def extract_option(text):
    """提取选项: 'A. xxx' or 'A、xxx'"""
    m = re.match(r'^([A-F])[\.、．]\s*(.*)', text)
    if m: return m.group(1), m.group(2).strip()
    return None, text

def extract_sub_question(text):
    """提取小题: '(1) xxx'"""
    m = re.match(r'^\((\d+)\)\s*(.*)', text)
    if m: return int(m.group(1)), m.group(2).strip()
    return None, text

def extract_meta(text):
    """从题干提取元信息（年份、考试类型、年级、地区）"""
    meta = {}
    ym = re.search(r'(19|20)\d{2}', text)
    if ym: meta['year'] = ym.group()
    if '高一' in text: meta['grade'] = '高一'
    elif '高二' in text: meta['grade'] = '高二'
    elif '高三' in text: meta['grade'] = '高三'
    if '高考' in text: meta['exam_type'] = '高考真题'
    elif '模拟' in text or '联考' in text: meta['exam_type'] = '模拟题'
    elif '期中' in text: meta['exam_type'] = '期中考试'
    elif '期末' in text: meta['exam_type'] = '期末考试'
    elif '月考' in text: meta['exam_type'] = '月考'
    for r in ['全国','北京','上海','天津','浙江','江苏','山东','广东','湖北']:
        if r in text: meta['region'] = r; break
    return meta

def extract_types_from_text(text):
    """从题干识别题型"""
    types = set()
    mapping = {
        '单选':'single', '选择题':'single', '选择':'single',
        '多选':'multi', '多选题':'multi',
        '填空':'fill', '填空题':'fill',
        '实验':'experiment', '实验题':'experiment',
        '解答':'problem', '解答题':'problem', '计算':'calculation', '计算题':'calculation',
        '简答':'short', '简答题':'short', '作图':'drawing', '作图题':'drawing',
    }
    for kw, t in mapping.items():
        if kw in text: types.add(t)
    return list(types)

# ========== 讲义模式（批注式答案） ==========

def parse_lecture_questions(paragraphs):
    """从讲义格式文档提取题目（批注答案在外部匹配）"""
    questions = []
    current = None
    
    for p in paragraphs:
        text = p.strip()
        if not text: continue
        
        num, content = extract_question_number(text)
        if num is not None:
            if current: questions.append(current)
            types = extract_types_from_text(content)
            meta = extract_meta(text)
            current = {
                'id': str(uuid.uuid4()),
                'stem': content,
                'options': [], 'sub_questions': [],
                'answer': '', 'analysis': '', 'formulas': [],
                'question_types': types if types else ['fill'],
                **meta
            }
            continue
        
        if current:
            opt, opt_content = extract_option(text)
            if opt:
                current['options'].append({'label': opt, 'content': opt_content, 'is_correct': False})
                continue
            
            sub_num, sub_content = extract_sub_question(text)
            if sub_num:
                current['sub_questions'].append({
                    'title': f'({sub_num})', 'content': sub_content, 'answer': '', 'formulas': []
                })
                continue
            
            # Append to current stem or last sub-question
            if current['sub_questions']:
                current['sub_questions'][-1]['content'] += '\n' + text
            else:
                current['stem'] += '\n' + text
    
    if current: questions.append(current)
    return questions

# ========== 试卷模式 ==========

def parse_exam_questions(paragraphs):
    """从试卷格式文档提取题目（答案在'参考答案'之后）"""
    ref_idx = -1
    for i, p in enumerate(paragraphs):
        if '参考答案' in p:
            ref_idx = i
            break
    
    if ref_idx == -1:
        ref_idx = len(paragraphs)
    
    # 前半部分：提取题目
    question_parts = []
    current_q = None
    current_options = []
    current_subs = []
    
    for i in range(0, min(ref_idx, len(paragraphs))):
        text = paragraphs[i].strip()
        if not text: continue
        
        num, content = extract_question_number(text)
        if num is not None:
            if current_q:
                current_q['options'] = current_options
                current_q['sub_questions'] = current_subs
                question_parts.append(current_q)
            types = extract_types_from_text(content)
            meta = extract_meta(text)
            current_q = {'index': len(question_parts), 'stem': content,
                         'question_types': types if types else ['fill'], **meta}
            current_options = []
            current_subs = []
            continue
        
        if current_q is None: continue
        opt, oc = extract_option(text)
        if opt:
            current_options.append({'label': opt, 'content': oc, 'is_correct': False})
            continue
        sn, sc = extract_sub_question(text)
        if sn:
            current_subs.append({'title': f'({sn})', 'content': sc, 'answer': ''})
            continue
        if current_subs:
            current_subs[-1]['content'] += '\n' + text
        else:
            current_q['stem'] += '\n' + text
    
    if current_q:
        current_q['options'] = current_options
        current_q['sub_questions'] = current_subs
        question_parts.append(current_q)
    
    # 后半部分：提取答案
    ans_parts = []
    for i in range(ref_idx + 1, len(paragraphs)):
        text = paragraphs[i].strip()
        if not text: continue
        num, rest = extract_question_number(text)
        if num is not None:
            ans_parts.append({'index': len(ans_parts), 'answer': rest, 'explanation': ''})
            continue
        if ans_parts:
            ans_parts[-1]['explanation'] += '\n' + text
    
    # 合并题目和答案
    for q in question_parts:
        for a in ans_parts:
            if q['index'] == a['index']:
                q['answer'] = a.get('answer', '')
                q['analysis'] = a.get('explanation', '')
                break
    
    return question_parts

# ========== 主入口 ==========

def main():
    if len(sys.argv) < 3:
        print(json.dumps({'error': '用法: parse_word.py <file_path> <source_type> [knowledge_tree]'}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    source_type = sys.argv[2]  # 'lecture' or 'exam'
    
    if not os.path.exists(file_path):
        print(json.dumps({'error': f'文件不存在: {file_path}'}))
        sys.exit(1)
    
    try:
        from docx import Document
        doc = Document(file_path)
    except ImportError:
        print(json.dumps({'error': '需要 python-docx: pip install python-docx'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': f'无法打开Word文档: {str(e)}'}))
        sys.exit(1)
    
    paragraphs = [p.text for p in doc.paragraphs]
    
    # 如果未指定格式，自动检测
    if source_type == 'auto':
        for p in paragraphs:
            if '参考答案' in p:
                source_type = 'exam'
                break
        else:
            source_type = 'lecture'
    
    if source_type == 'exam':
        questions = parse_exam_questions(paragraphs)
    else:
        questions = parse_lecture_questions(paragraphs)
    
    # Check for comments/annotations (lecture mode batch answer matching)
    if source_type == 'lecture':
        try:
            comments = extract_comments(file_path)
            count = min(len(comments), len(questions))
            for i in range(count):
                answer = comments[i].strip()
                if answer:
                    # Separate source from answer
                    am = re.match(r'^((?:19|20)\d{2}.+?)([A-F]{1,6})$', answer)
                    if am:
                        questions[i]['source'] = am.group(1).strip()
                        questions[i]['answer'] = am.group(2).strip()
                    else:
                        questions[i]['answer'] = answer
        except Exception:
            pass  # No comments available
    
    # Extract topics/concepts
    topics = extract_topics(paragraphs)
    
    result = {
        'success': True,
        'source_type': source_type,
        'count': len(questions),
        'questions': questions,
        'topics': topics,
        'knowledge_points': [],
    }
    
    print(json.dumps(result, ensure_ascii=False, indent=2))

def extract_comments(file_path):
    """从Word文档提取批注内容"""
    import zipfile, xml.etree.ElementTree as ET
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    try:
        with zipfile.ZipFile(file_path, 'r') as zf:
            if 'word/comments.xml' not in zf.namelist():
                return []
            root = ET.fromstring(zf.read('word/comments.xml'))
            comments = []
            for c in root.findall('.//w:comment', ns):
                texts = [t.text or '' for t in c.findall('.//w:t', ns)]
                comments.append(''.join(texts).strip())
            return comments
    except Exception:
        return []

def extract_topics(paragraphs):
    """提取专题/标题信息"""
    topics = []
    for p in paragraphs:
        p = p.strip()
        if not p: continue
        # Match headings: 专题一、一、等
        if re.match(r'^专题[一二三四五六七八九十]+', p) or re.match(r'^[一二三四五六七八九十]+[、]', p):
            topics.append(p)
    return topics

if __name__ == '__main__':
    main()
