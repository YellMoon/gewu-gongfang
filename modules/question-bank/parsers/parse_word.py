#!/usr/bin/env python3
"""Word question parser for the question-bank import pipeline.

Usage: python parse_word.py <file_path> <source_type> [knowledge_tree_path]
source_type: lecture | exam | auto
"""

import io
import json
import os
import re
import sys
import uuid
import zipfile
import xml.etree.ElementTree as ET

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


QUESTION_RE = re.compile(r"^(\d+)[\.\u3001\uff0e]\s*(.*)")
OPTION_RE = re.compile(r"^([A-F])[\.\u3001\uff0e]\s*(.*)", re.I)
SUB_QUESTION_RE = re.compile(r"^[\(\uff08](\d+)[\)\uff09]\s*(.*)")


def extract_question_number(text):
    match = QUESTION_RE.match(text)
    if match:
        return int(match.group(1)), match.group(2).strip()
    return None, text


def read_numbering_definitions(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/numbering.xml" not in archive.namelist():
                return {}
            root = ET.fromstring(archive.read("word/numbering.xml"))
            num_to_abstract = {}
            for num in root.findall("w:num", namespace):
                num_id = num.attrib.get(f"{{{namespace['w']}}}numId")
                abstract = num.find("w:abstractNumId", namespace)
                if num_id and abstract is not None:
                    num_to_abstract[num_id] = abstract.attrib.get(f"{{{namespace['w']}}}val")

            abstract_levels = {}
            for abstract in root.findall("w:abstractNum", namespace):
                abstract_id = abstract.attrib.get(f"{{{namespace['w']}}}abstractNumId")
                levels = {}
                for level in abstract.findall("w:lvl", namespace):
                    ilvl = level.attrib.get(f"{{{namespace['w']}}}ilvl", "0")
                    lvl_text = level.find("w:lvlText", namespace)
                    num_fmt = level.find("w:numFmt", namespace)
                    start = level.find("w:start", namespace)
                    levels[ilvl] = {
                        "text": lvl_text.attrib.get(f"{{{namespace['w']}}}val", "") if lvl_text is not None else "",
                        "format": num_fmt.attrib.get(f"{{{namespace['w']}}}val", "") if num_fmt is not None else "",
                        "start": int(start.attrib.get(f"{{{namespace['w']}}}val", "1")) if start is not None else 1,
                    }
                abstract_levels[abstract_id] = levels

            definitions = {}
            for num_id, abstract_id in num_to_abstract.items():
                definitions[num_id] = abstract_levels.get(abstract_id, {})
            return definitions
    except Exception:
        return {}


def paragraph_numbering(paragraph):
    try:
        num_pr = paragraph._p.pPr.numPr if paragraph._p.pPr is not None else None
        if num_pr is None or num_pr.numId is None:
            return None
        num_id = str(num_pr.numId.val)
        ilvl = str(num_pr.ilvl.val) if num_pr.ilvl is not None else "0"
        return num_id, ilvl
    except Exception:
        return None


def read_docx_comments(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/comments.xml" not in archive.namelist():
                return {}
            root = ET.fromstring(archive.read("word/comments.xml"))
            comments = {}
            for comment in root.findall(".//w:comment", namespace):
                comment_id = comment.attrib.get(f"{{{namespace['w']}}}id")
                texts = [node.text or "" for node in comment.findall(".//w:t", namespace)]
                if comment_id:
                    comments[comment_id] = "".join(texts).strip()
            return comments
    except Exception:
        return {}


def read_paragraph_comment_refs(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/document.xml" not in archive.namelist():
                return []
            root = ET.fromstring(archive.read("word/document.xml"))
            refs_by_paragraph = []
            for paragraph in root.findall(".//w:p", namespace):
                refs = []
                for node in paragraph.findall(".//w:commentReference", namespace):
                    comment_id = node.attrib.get(f"{{{namespace['w']}}}id")
                    if comment_id:
                        refs.append(comment_id)
                refs_by_paragraph.append(refs)
            return refs_by_paragraph
    except Exception:
        return []


def extract_numbered_items(doc, file_path):
    definitions = read_numbering_definitions(file_path)
    comments = read_docx_comments(file_path)
    comment_refs = read_paragraph_comment_refs(file_path)
    counters = {}
    items = []
    for index, paragraph in enumerate(doc.paragraphs):
        text = paragraph.text.strip()
        numbering = paragraph_numbering(paragraph)
        number_label = ""
        number_kind = ""
        if numbering:
            num_id, ilvl = numbering
            level = definitions.get(num_id, {}).get(ilvl, {})
            lvl_text = level.get("text", "")
            if level.get("format") == "decimal" and "%1" in lvl_text and ilvl == "0":
                key = (num_id, ilvl)
                counters[key] = counters.get(key, level.get("start", 1) - 1) + 1
                number_label = lvl_text.replace("%1", str(counters[key]))
                if lvl_text.startswith("例"):
                    number_kind = "example"
                elif lvl_text in ("%1", "%1.", "%1．"):
                    number_kind = "practice"
        paragraph_comments = [
            comments[comment_id]
            for comment_id in (comment_refs[index] if index < len(comment_refs) else [])
            if comments.get(comment_id)
        ]
        items.append({
            "text": text,
            "number_label": number_label,
            "number_kind": number_kind,
            "comments": paragraph_comments,
        })
    return items


def extract_option(text):
    match = OPTION_RE.match(text)
    if match:
        return match.group(1).upper(), match.group(2).strip()
    return None, text


def extract_sub_question(text):
    match = SUB_QUESTION_RE.match(text)
    if match:
        return int(match.group(1)), match.group(2).strip()
    return None, text


def extract_meta(text):
    meta = {}
    year = re.search(r"(?:19|20)\d{2}", text)
    if year:
        meta["year"] = year.group(0)
    for grade in ["高一", "高二", "高三", "初一", "初二", "初三"]:
        if grade in text:
            meta["grade"] = grade
            break
    for region in ["全国", "北京", "上海", "天津", "浙江", "江苏", "山东", "广东", "湖北", "湖南", "四川"]:
        if region in text:
            meta["region"] = region
            break
    if "高考" in text:
        meta["exam_type"] = "高考真题"
    elif "模拟" in text or "联考" in text or "适应性" in text:
        meta["exam_type"] = "模拟题"
    elif "期中" in text:
        meta["exam_type"] = "期中考试"
    elif "期末" in text:
        meta["exam_type"] = "期末考试"
    elif "月考" in text:
        meta["exam_type"] = "月考"
    return meta


def extract_types_from_text(text, options=None):
    mapping = {
        "多选": "multi",
        "单选": "single",
        "选择": "single",
        "填空": "fill",
        "实验": "experiment",
        "计算": "calculation",
        "解答": "problem",
        "简答": "short",
        "作图": "drawing",
        "判断": "judge",
    }
    types = [value for key, value in mapping.items() if key in text]
    if not types and options:
        types = ["single"]
    return types or ["fill"]


def derive_topic_from_filename(file_path):
    base = os.path.splitext(os.path.basename(file_path))[0]
    patterns = [
        r"专题\d+[-：:](.+)$",
        r"实验专题\d+[-：:](.+)$",
        r"解答题专题\d+[-：:](.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, base)
        if match:
            return match.group(1).strip()
    return ""


def is_topic_heading(text):
    if not text:
        return False
    generic = ["选择题", "非选择题", "填空题", "实验题", "计算题", "解答题", "答案", "解析", "参考答案"]
    if any(word in text for word in generic):
        return False
    return bool(re.match(r"^(专题\d+|实验专题\d+|解答题专题\d+|[一二三四五六七八九十]+[、.．])", text))


def clean_topic_heading(text):
    text = re.sub(r"^(专题\d+|实验专题\d+|解答题专题\d+)[-：:、.\s]*", "", text).strip()
    text = re.sub(r"^[一二三四五六七八九十]+[、.．]\s*", "", text).strip()
    return text[:80]


def new_question(stem, index=None, knowledge_point=None):
    knowledge_points = [knowledge_point] if knowledge_point else []
    return {
        "id": str(uuid.uuid4()),
        "index": index,
        "stem": stem.strip(),
        "options": [],
        "sub_questions": [],
        "answer": "",
        "analysis": "",
        "knowledge_point": knowledge_point or "",
        "knowledge_points": knowledge_points,
        "question_types": extract_types_from_text(stem),
        **extract_meta(stem),
    }


def append_text(question, text):
    if question["sub_questions"]:
        question["sub_questions"][-1]["content"] += "\n" + text
    else:
        question["stem"] = (question["stem"] + "\n" + text).strip()


def parse_question_block(paragraphs, default_topic=None):
    questions = []
    current = None
    current_topic = default_topic or ""
    for paragraph in paragraphs:
        text = paragraph.strip()
        if not text:
            continue
        if is_topic_heading(text):
            topic = clean_topic_heading(text)
            if topic:
                current_topic = topic
            continue
        number, content = extract_question_number(text)
        if number is not None:
            if current:
                current["question_types"] = extract_types_from_text(current["stem"], current["options"])
                questions.append(current)
            current = new_question(content, len(questions), current_topic)
            continue
        if not current:
            continue
        option, option_content = extract_option(text)
        if option:
            current["options"].append({"label": option, "content": option_content, "is_correct": False})
            continue
        sub_number, sub_content = extract_sub_question(text)
        if sub_number:
            current["sub_questions"].append({"title": f"({sub_number})", "content": sub_content, "answer": ""})
            continue
        append_text(current, text)
    if current:
        current["question_types"] = extract_types_from_text(current["stem"], current["options"])
        questions.append(current)
    return questions


def split_answer_section(paragraphs):
    for index, paragraph in enumerate(paragraphs):
        if any(keyword in paragraph for keyword in ["参考答案", "答案", "解析"]):
            return paragraphs[:index], paragraphs[index + 1 :]
    return paragraphs, []


def parse_answers(paragraphs):
    answers = []
    current = None
    for paragraph in paragraphs:
        text = paragraph.strip()
        if not text:
            continue
        number, content = extract_question_number(text)
        if number is not None:
            if current:
                answers.append(current)
            current = {"number": number, "answer": content, "explanation": ""}
            continue
        if current:
            if current["explanation"]:
                current["explanation"] += "\n"
            current["explanation"] += text
    if current:
        answers.append(current)
    return answers


def parse_lecture_questions(paragraphs, default_topic=None):
    return parse_question_block(paragraphs, default_topic)


def parse_lecture_numbered_items(items, default_topic=None):
    questions = []
    current = None
    current_topic = default_topic or ""

    def finish_current():
        nonlocal current
        if current:
            comments = [comment for comment in current.pop("_comments", []) if comment]
            if comments and not current.get("answer"):
                current["answer"] = "\n".join(comments)
            current["question_types"] = extract_types_from_text(current["stem"], current["options"])
            questions.append(current)
            current = None

    for item in items:
        text = item.get("text", "").strip()
        number_kind = item.get("number_kind", "")
        number_label = item.get("number_label", "")
        if not text and not number_kind:
            continue
        if text and is_topic_heading(text):
            finish_current()
            topic = clean_topic_heading(text)
            if topic:
                current_topic = topic
            continue
        if number_kind in ("example", "practice"):
            finish_current()
            stem = f"{number_label} {text}".strip()
            current = new_question(stem, len(questions), current_topic)
            current["source_type"] = number_kind
            current["_comments"] = list(item.get("comments", []))
            continue
        if not current or not text:
            if current:
                current.setdefault("_comments", []).extend(item.get("comments", []))
            continue
        current.setdefault("_comments", []).extend(item.get("comments", []))
        option, option_content = extract_option(text)
        if option:
            current["options"].append({"label": option, "content": option_content, "is_correct": False})
            continue
        sub_number, sub_content = extract_sub_question(text)
        if sub_number:
            current["sub_questions"].append({"title": f"({sub_number})", "content": sub_content, "answer": ""})
            continue
        append_text(current, text)

    finish_current()
    return questions


def parse_exam_questions(paragraphs, default_topic=None):
    question_part, answer_part = split_answer_section(paragraphs)
    questions = parse_question_block(question_part, default_topic)
    answers = parse_answers(answer_part)
    by_index = {idx: answer for idx, answer in enumerate(answers)}
    by_number = {answer["number"]: answer for answer in answers}
    for idx, question in enumerate(questions):
        answer = by_number.get(idx + 1) or by_index.get(idx)
        if answer:
            question["answer"] = answer.get("answer", "")
            question["analysis"] = answer.get("explanation", "")
    return questions


def extract_comments(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            if "word/comments.xml" not in archive.namelist():
                return []
            root = ET.fromstring(archive.read("word/comments.xml"))
            comments = []
            for comment in root.findall(".//w:comment", namespace):
                texts = [node.text or "" for node in comment.findall(".//w:t", namespace)]
                comments.append("".join(texts).strip())
            return comments
    except Exception:
        return []


def extract_paragraphs_from_docx(file_path):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs = []
    with zipfile.ZipFile(file_path, "r") as archive:
        if "word/document.xml" not in archive.namelist():
            raise ValueError("word/document.xml not found")
        root = ET.fromstring(archive.read("word/document.xml"))
        for paragraph in root.findall(".//w:p", namespace):
            texts = [node.text or "" for node in paragraph.findall(".//w:t", namespace)]
            text = "".join(texts).strip()
            if text:
                paragraphs.append(text)
    return paragraphs


def extract_topics(paragraphs):
    topics = []
    for paragraph in paragraphs:
        text = paragraph.strip()
        if text and is_topic_heading(text):
            topic = clean_topic_heading(text)
            if topic and topic not in topics:
                topics.append(topic)
    return topics


def quality_report(questions):
    warnings = {}
    for question in questions:
        if not question.get("stem"):
            warnings["missing_stem"] = warnings.get("missing_stem", 0) + 1
        if not question.get("answer"):
            warnings["missing_answer"] = warnings.get("missing_answer", 0) + 1
        if question.get("options") and len(question["options"]) < 2:
            warnings["few_options"] = warnings.get("few_options", 0) + 1
    return {"warnings": warnings, "parsed_items": len(questions)}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: parse_word.py <file_path> <source_type> [knowledge_tree]"}, ensure_ascii=False))
        sys.exit(1)

    file_path = sys.argv[1]
    source_type = sys.argv[2]
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"file not found: {file_path}"}, ensure_ascii=False))
        sys.exit(1)

    try:
        if os.environ.get("GEWU_FORCE_DOCX_XML_FALLBACK") == "1":
            raise ImportError("forced docx xml fallback")
        from docx import Document
        doc = Document(file_path)
        paragraphs = [paragraph.text for paragraph in doc.paragraphs]
        numbered_items = extract_numbered_items(doc, file_path)
    except ImportError:
        try:
            paragraphs = extract_paragraphs_from_docx(file_path)
            numbered_items = []
        except Exception as exc:
            print(json.dumps({"error": f"cannot open Word document without python-docx: {exc}"}, ensure_ascii=False))
            sys.exit(1)
    except Exception as exc:
        try:
            paragraphs = extract_paragraphs_from_docx(file_path)
            numbered_items = []
        except Exception:
            print(json.dumps({"error": f"cannot open Word document: {exc}"}, ensure_ascii=False))
            sys.exit(1)
    if source_type == "auto":
        source_type = "exam" if any("参考答案" in paragraph or "答案" in paragraph for paragraph in paragraphs) else "lecture"

    default_topic = derive_topic_from_filename(file_path) if source_type == "lecture" else ""
    if source_type == "exam":
        questions = parse_exam_questions(paragraphs, default_topic)
    elif numbered_items:
        questions = parse_lecture_numbered_items(numbered_items, default_topic)
    else:
        questions = parse_lecture_questions(paragraphs, default_topic)
    if source_type == "lecture":
        comments = extract_comments(file_path)
        for index, answer in enumerate(comments[: len(questions)]):
            if answer:
                questions[index]["answer"] = answer

    result = {
        "success": True,
        "source_type": source_type,
        "count": len(questions),
        "questions": questions,
        "topics": extract_topics(paragraphs) or ([default_topic] if default_topic else []),
        "knowledge_points": sorted({kp for question in questions for kp in question.get("knowledge_points", []) if kp}),
        "quality_report": quality_report(questions),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
