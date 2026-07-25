"""Normalize presentation MathML into the canonical editable LaTeX subset."""

from __future__ import annotations

import xml.etree.ElementTree as ET

from formula_model import FormulaConversionResult


def _local(node: ET.Element) -> str:
    return node.tag.rsplit("}", 1)[-1]


def _children(node: ET.Element) -> list[ET.Element]:
    return [child for child in list(node) if _local(child) not in {"annotation", "annotation-xml"}]


OPERATOR_MAP = {
    "−": "-",
    "×": r"\times ",
    "·": r"\cdot ",
    "→": r"\to ",
    "≤": r"\le ",
    "≥": r"\ge ",
    "≠": r"\ne ",
    "∞": r"\infty ",
    "∑": r"\sum ",
    "∏": r"\prod ",
    "∫": r"\int ",
}


class _MathmlVisitor:
    def __init__(self) -> None:
        self.warnings: list[str] = []

    def visit(self, node: ET.Element) -> str:
        tag = _local(node)
        children = _children(node)
        if tag in {"math", "mrow", "mstyle", "mpadded", "semantics", "mtd"}:
            return "".join(self.visit(child) for child in children)
        if tag in {"mi", "mn"}:
            return "".join(node.itertext()).strip()
        if tag == "mo":
            text = "".join(node.itertext()).strip()
            return "".join(OPERATOR_MAP.get(char, char) for char in text)
        if tag == "mtext":
            text = "".join(node.itertext()).strip().replace("{", r"\{").replace("}", r"\}")
            return r"\text{%s}" % text
        if tag == "mfrac" and len(children) >= 2:
            return r"\frac{%s}{%s}" % (self.visit(children[0]), self.visit(children[1]))
        if tag == "msqrt":
            return r"\sqrt{%s}" % "".join(self.visit(child) for child in children)
        if tag == "mroot" and len(children) >= 2:
            return r"\sqrt[%s]{%s}" % (self.visit(children[1]), self.visit(children[0]))
        if tag == "msub" and len(children) >= 2:
            return "%s_{%s}" % (self.visit(children[0]), self.visit(children[1]))
        if tag == "msup" and len(children) >= 2:
            return "%s^{%s}" % (self.visit(children[0]), self.visit(children[1]))
        if tag == "msubsup" and len(children) >= 3:
            return "%s_{%s}^{%s}" % tuple(self.visit(child) for child in children[:3])
        if tag == "munder" and len(children) >= 2:
            return "%s_{%s}" % (self.visit(children[0]), self.visit(children[1]))
        if tag == "mover" and len(children) >= 2:
            base, accent = self.visit(children[0]), "".join(children[1].itertext()).strip()
            command = {"^": r"\hat", "ˆ": r"\hat", "~": r"\tilde", "˜": r"\tilde", "¯": r"\overline", "→": r"\vec", "˙": r"\dot"}.get(accent)
            return r"%s{%s}" % (command, base) if command else "%s^{%s}" % (base, self.visit(children[1]))
        if tag == "munderover" and len(children) >= 3:
            return "%s_{%s}^{%s}" % tuple(self.visit(child) for child in children[:3])
        if tag == "mfenced":
            left = node.attrib.get("open", "(") or "."
            right = node.attrib.get("close", ")") or "."
            separator = node.attrib.get("separators", ",")[:1] or ","
            body = separator.join(self.visit(child) for child in children)
            return r"\left%s%s\right%s" % (left, body, right)
        if tag == "mtable":
            rows = [self.visit(row) for row in children if _local(row) == "mtr"]
            return r"\begin{matrix}%s\end{matrix}" % r" \\ ".join(rows)
        if tag == "mtr":
            return " & ".join(self.visit(cell) for cell in children if _local(cell) == "mtd")
        if tag == "menclose":
            body = "".join(self.visit(child) for child in children)
            return r"\boxed{%s}" % body if "box" in node.attrib.get("notation", "box") else body
        if tag == "mspace":
            return " "
        if tag == "none":
            return ""
        fallback = "".join(self.visit(child) for child in children)
        if fallback:
            self.warnings.append("approximated unsupported MathML node %s" % tag)
        return fallback


def convert_mathml_to_latex(mathml: str | ET.Element) -> FormulaConversionResult:
    try:
        root = ET.fromstring(mathml) if isinstance(mathml, str) else mathml
    except ET.ParseError as exc:
        return FormulaConversionResult("failed", warnings=("invalid MathML: %s" % exc,))
    visitor = _MathmlVisitor()
    latex = visitor.visit(root).strip()
    if not latex:
        return FormulaConversionResult("failed", warnings=tuple(visitor.warnings or ["empty MathML formula"]))
    return FormulaConversionResult(
        "approximate" if visitor.warnings else "complete",
        canonical_latex=latex,
        normalized_mathml=ET.tostring(root, encoding="unicode"),
        warnings=tuple(dict.fromkeys(visitor.warnings)),
    )
