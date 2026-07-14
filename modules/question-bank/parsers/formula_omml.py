"""Convert Office Math Markup Language nodes into canonical KaTeX-safe LaTeX."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from formula_model import FormulaConversionResult


M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _local(node: ET.Element) -> str:
    return node.tag.rsplit("}", 1)[-1]


def _value(node: ET.Element | None, default: str = "") -> str:
    if node is None:
        return default
    return node.attrib.get("{%s}val" % M) or node.attrib.get("{%s}val" % W) or node.attrib.get("val") or default


def _child(node: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in list(node) if _local(child) == name), None)


def _descendant(node: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in node.iter() if _local(child) == name), None)


TOKEN_REPLACEMENTS = {
    "→": r"\to ",
    "←": r"\leftarrow ",
    "∞": r"\infty ",
    "×": r"\times ",
    "·": r"\cdot ",
    "≤": r"\le ",
    "≥": r"\ge ",
    "≠": r"\ne ",
    "±": r"\pm ",
}

FUNCTIONS = {
    "sin": r"\sin",
    "cos": r"\cos",
    "tan": r"\tan",
    "cot": r"\cot",
    "ln": r"\ln",
    "log": r"\log",
    "lim": r"\lim",
    "max": r"\max",
    "min": r"\min",
}


def _normalize_token(text: str) -> str:
    result = "".join(TOKEN_REPLACEMENTS.get(char, char) for char in text)
    result = re.sub(r"\\([A-Za-z]+)\s+(?=[_}^{,)&+\-=]|$)", r"\\\1", result)
    return result


class _OmmlVisitor:
    def __init__(self) -> None:
        self.warnings: list[str] = []

    def visit(self, node: ET.Element | None) -> str:
        if node is None:
            return ""
        tag = _local(node)
        if tag == "t":
            return _normalize_token(node.text or "")
        if tag.endswith("Pr") or tag in {"ctrlPr"}:
            return ""
        if tag == "r":
            content = "".join(self.visit(child) for child in list(node) if _local(child) != "rPr")
            rpr = _child(node, "rPr")
            plain = bool(rpr is not None and any(_local(child) in {"nor", "lit"} or (_local(child) == "sty" and _value(child) in {"p", "plain"}) for child in list(rpr)))
            return r"\mathrm{%s}" % content if plain and content else content
        if tag in {"oMath", "oMathPara", "e", "num", "den", "deg", "sub", "sup", "lim", "fName"}:
            return "".join(self.visit(child) for child in list(node))
        if tag == "f":
            numerator = self.visit(_child(node, "num"))
            denominator = self.visit(_child(node, "den"))
            fraction_type = _value(_descendant(node, "type"))
            return "%s/%s" % (numerator, denominator) if fraction_type in {"lin", "skw"} else r"\frac{%s}{%s}" % (numerator, denominator)
        if tag in {"sSub", "sSup", "sSubSup"}:
            base = self.visit(_child(node, "e"))
            sub = self.visit(_child(node, "sub"))
            sup = self.visit(_child(node, "sup"))
            return base + ("_{%s}" % sub if sub else "") + ("^{%s}" % sup if sup else "")
        if tag == "sPre":
            base = self.visit(_child(node, "e"))
            sub = self.visit(_child(node, "sub"))
            sup = self.visit(_child(node, "sup"))
            return "{}" + ("_{%s}" % sub if sub else "") + ("^{%s}" % sup if sup else "") + base
        if tag == "rad":
            degree = self.visit(_child(node, "deg"))
            body = self.visit(_child(node, "e"))
            return r"\sqrt[%s]{%s}" % (degree, body) if degree else r"\sqrt{%s}" % body
        if tag == "nary":
            symbol = _value(_descendant(node, "chr"), "∑")
            command = {"∑": r"\sum", "Σ": r"\sum", "∫": r"\int", "∏": r"\prod", "∐": r"\coprod"}.get(symbol, symbol)
            sub = self.visit(_child(node, "sub"))
            sup = self.visit(_child(node, "sup"))
            body = self.visit(_child(node, "e"))
            return command + ("_{%s}" % sub if sub else "") + ("^{%s}" % sup if sup else "") + ("{%s}" % body if body else "")
        if tag in {"limLow", "limUpp"}:
            base = self.visit(_child(node, "e"))
            limit = self.visit(_child(node, "lim"))
            marker = "_" if tag == "limLow" else "^"
            base = FUNCTIONS.get(base.strip(), base)
            return "%s%s{%s}" % (base, marker, limit)
        if tag == "func":
            name = self.visit(_child(node, "fName")).strip()
            body = self.visit(_child(node, "e"))
            return r"%s\left(%s\right)" % (FUNCTIONS.get(name, r"\operatorname{%s}" % name), body)
        if tag == "d":
            begin = _value(_descendant(node, "begChr"), "(")
            end = _value(_descendant(node, "endChr"), ")")
            separator = _value(_descendant(node, "sepChr"), "|")
            entries = [self.visit(child) for child in list(node) if _local(child) == "e"]
            body = (r"\middle%s" % separator).join(entries)
            return r"\left%s%s\right%s" % (begin or ".", body, end or ".")
        if tag == "m":
            rows = []
            for row in (child for child in list(node) if _local(child) == "mr"):
                rows.append(" & ".join(self.visit(cell) for cell in list(row) if _local(cell) == "e"))
            return r"\begin{matrix}%s\end{matrix}" % r" \\ ".join(rows)
        if tag == "mr":
            return " & ".join(self.visit(cell) for cell in list(node) if _local(cell) == "e")
        if tag == "eqArr":
            rows = [self.visit(child) for child in list(node) if _local(child) == "e"]
            return r"\begin{aligned}%s\end{aligned}" % r" \\ ".join(rows)
        if tag == "acc":
            accent = _value(_descendant(node, "chr"), "ˆ")
            command = {"ˆ": r"\hat", "^": r"\hat", "˜": r"\tilde", "~": r"\tilde", "˙": r"\dot", "¨": r"\ddot", "⃗": r"\vec", "→": r"\vec"}.get(accent)
            body = self.visit(_child(node, "e"))
            if command:
                return r"%s{%s}" % (command, body)
            self.warnings.append("unsupported OMML accent %s" % accent)
            return body
        if tag == "bar":
            position = _value(_descendant(node, "pos"), "top")
            command = r"\underline" if position in {"bot", "bottom"} else r"\overline"
            return r"%s{%s}" % (command, self.visit(_child(node, "e")))
        if tag == "groupChr":
            position = _value(_descendant(node, "pos"), "top")
            command = r"\underbrace" if position in {"bot", "bottom"} else r"\overbrace"
            return r"%s{%s}" % (command, self.visit(_child(node, "e")))
        if tag in {"box", "borderBox"}:
            return r"\boxed{%s}" % self.visit(_child(node, "e"))
        if tag == "phant":
            return r"\phantom{%s}" % self.visit(_child(node, "e"))

        children = "".join(self.visit(child) for child in list(node))
        if children:
            self.warnings.append("approximated unsupported OMML node %s" % tag)
        return children


def convert_omml_to_latex(node: ET.Element | str) -> FormulaConversionResult:
    try:
        root = ET.fromstring(node) if isinstance(node, str) else node
    except ET.ParseError as exc:
        return FormulaConversionResult("failed", warnings=("invalid OMML: %s" % exc,))
    visitor = _OmmlVisitor()
    latex = visitor.visit(root).strip()
    if not latex:
        return FormulaConversionResult("failed", warnings=tuple(visitor.warnings or ["empty OMML formula"]))
    return FormulaConversionResult(
        "approximate" if visitor.warnings else "complete",
        canonical_latex=latex,
        warnings=tuple(dict.fromkeys(visitor.warnings)),
    )
