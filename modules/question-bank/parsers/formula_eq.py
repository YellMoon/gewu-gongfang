"""Reconstruct and normalize legacy Microsoft Word EQ fields."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from word_content import WordToken


@dataclass(frozen=True)
class EqField:
    instruction: str
    visible_result: str
    start_index: int
    end_index: int
    conversion_instruction: str | None = None


@dataclass(frozen=True)
class EqConversion:
    status: str
    canonical_latex: str | None
    visible_text: str | None = None
    warnings: tuple[str, ...] = ()


@dataclass
class _FieldFrame:
    start_index: int
    instructions: list[WordToken]
    result: list[str]
    separated: bool = False


def _clean_instruction(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _conversion_instruction(tokens: Iterable[WordToken]) -> str:
    """Keep Word run-level scripts when rebuilding an EQ instruction."""
    fragments: list[str] = []
    for token in tokens:
        text = token.text or ""
        if not text:
            continue
        if token.style.vert_align == "subscript":
            fragments.append(r"\s\do2(" + text + ")")
        elif token.style.vert_align == "superscript":
            fragments.append(r"\s\up2(" + text + ")")
        else:
            fragments.append(text)
    return _clean_instruction("".join(fragments))


def _is_layout_overlay(instruction: str) -> bool:
    """An aligned overlay nested in another EQ field is positioning metadata."""
    return bool(re.match(r"(?i)^EQ\s+\\o\\al(?:\s|\(|$)", instruction))


def collect_eq_fields(tokens: Iterable[WordToken]) -> list[EqField]:
    fields: list[EqField] = []
    stack: list[_FieldFrame] = []
    for token in tokens:
        index = token.source.content_index
        if token.kind == "field_simple":
            instruction = _clean_instruction(token.text or "")
            if re.match(r"(?i)^EQ(?:\s|$)", instruction):
                fields.append(EqField(instruction, token.xml or "", index, index))
            continue
        if token.kind == "field_begin":
            stack.append(_FieldFrame(index, [], []))
            continue
        if not stack:
            continue
        frame = stack[-1]
        if token.kind == "field_instruction" and not frame.separated:
            frame.instructions.append(token)
        elif token.kind == "field_separate":
            frame.separated = True
        elif token.kind == "text" and frame.separated:
            frame.result.append(token.text or "")
        elif token.kind == "field_end":
            completed = stack.pop()
            instruction = _clean_instruction("".join(item.text or "" for item in completed.instructions))
            if re.match(r"(?i)^EQ(?:\s|$)", instruction) and not (stack and _is_layout_overlay(instruction)):
                fields.append(EqField(
                    instruction,
                    "".join(completed.result).strip(),
                    completed.start_index,
                    index,
                    _conversion_instruction(completed.instructions),
                ))
    return fields


def _split_arguments(value: str) -> list[str]:
    args: list[str] = []
    depth = 0
    start = 0
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            args.append(value[start:index].strip())
            start = index + 1
    args.append(value[start:].strip())
    return args


def _balanced_group(value: str, open_index: int) -> tuple[str, int]:
    if open_index >= len(value) or value[open_index] != "(":
        raise ValueError("EQ command requires a parenthesized argument")
    depth = 0
    for index in range(open_index, len(value)):
        char = value[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return value[open_index + 1:index], index + 1
    raise ValueError("unbalanced EQ field parentheses")


def _convert_integral(expression: str) -> str | None:
    match = re.fullmatch(r"\\i(?P<sum>\\su|\\pr)?\((.*)\)", expression, flags=re.I | re.S)
    if not match:
        return None
    args = _split_arguments(match.group(2))
    if len(args) != 3:
        raise ValueError("EQ integral requires lower, upper and body arguments")
    operator = r"\sum" if (match.group("sum") or "").lower() == r"\su" else r"\prod" if (match.group("sum") or "").lower() == r"\pr" else r"\int"
    lower, upper, body = (_convert_expression(item) for item in args)
    return rf"{operator}_{{{lower}}}^{{{upper}}}{{{body}}}"


def _array_expression(expression: str, start: int, force_cases: bool = False) -> tuple[str, int]:
    # start points immediately after the \a command.
    columns = 1
    index = start
    while index < len(expression) and expression[index] == "\\":
        switch = re.match(r"\\(al|ac|ar|co(\d+)|vs\d+|hs\d+)", expression[index:], re.I)
        if not switch:
            break
        if switch.group(2):
            columns = max(1, int(switch.group(2)))
        index += len(switch.group(0))
    group, next_index = _balanced_group(expression, index)
    cells = _split_arguments(group)
    rows = []
    for offset in range(0, len(cells), columns):
        row = [_convert_expression(cell) for cell in cells[offset:offset + columns]]
        if len(row) < columns:
            row.extend([""] * (columns - len(row)))
        rows.append(" & ".join(row))
    environment = "cases" if force_cases else "array"
    column_spec = "" if force_cases else "{%s}" % ("l" * columns)
    return r"\begin{%s}%s%s\end{%s}" % (environment, column_spec, r" \\ ".join(rows), environment), next_index


def _bracket_expression(expression: str, start: int) -> tuple[str, int]:
    index = start
    left = "("
    right = ")"
    while index < len(expression) and expression[index] == "\\":
        switch = re.match(r"\\(lc|rc|bc)\\(.)", expression[index:], re.I | re.S)
        if not switch:
            break
        side, character = switch.group(1).lower(), switch.group(2)
        if side in {"lc", "bc"}:
            left = character
        if side in {"rc", "bc"}:
            right = character
        index += len(switch.group(0))
    group, next_index = _balanced_group(expression, index)
    if left == "{" and group.startswith(r"\a"):
        converted, consumed = _array_expression(group, 2, force_cases=True)
        if consumed != len(group):
            raise ValueError("unexpected content after EQ piecewise array")
        return converted, next_index
    body = _convert_expression(group)
    latex_left = r"\{" if left == "{" else left or "."
    latex_right = r"\}" if right == "}" else right or "."
    return r"\left%s%s\right%s" % (latex_left, body, latex_right), next_index


def _convert_expression(expression: str) -> str:
    expression = expression.strip()
    integral = _convert_integral(expression)
    if integral is not None:
        return integral

    script_pattern = re.compile(
        r"(?P<base>(?:\([^()]*\)|（[^（）]*）|[^\\(),\s]+))"
        r"\\s\\(?P<direction>up|do)(?:\d+)?\((?P<script>[^()]*)\)",
        re.I,
    )
    while True:
        match = script_pattern.search(expression)
        if not match:
            break
        base = _convert_expression(match.group("base"))
        script = _convert_expression(match.group("script"))
        marker = "^" if match.group("direction").lower() == "up" else "_"
        expression = expression[:match.start()] + rf"{base}{marker}{{{script}}}" + expression[match.end():]

    output: list[str] = []
    index = 0
    while index < len(expression):
        if expression[index] != "\\":
            output.append(expression[index])
            index += 1
            continue
        command_match = re.match(r"\\([A-Za-z]+)", expression[index:])
        if not command_match:
            output.append(expression[index])
            index += 1
            continue
        command = command_match.group(1).lower()
        argument_start = index + len(command_match.group(0))
        symbol_commands = {"ge": r"\ge ", "le": r"\le ", "ne": r"\ne ", "pm": r"\pm ", "in": r"\in ", "to": r"\to "}
        if command in symbol_commands:
            output.append(symbol_commands[command])
            index = argument_start
            continue
        if command == "a":
            converted, next_index = _array_expression(expression, argument_start)
            output.append(converted)
        elif command == "b":
            converted, next_index = _bracket_expression(expression, argument_start)
            output.append(converted)
        elif command in {"f", "r"}:
            group, next_index = _balanced_group(expression, argument_start)
            args = _split_arguments(group)
            if command == "f" and len(args) == 2:
                output.append(r"\frac{%s}{%s}" % (_convert_expression(args[0]), _convert_expression(args[1])))
            elif command == "r" and len(args) == 1:
                output.append(r"\sqrt{%s}" % _convert_expression(args[0]))
            elif command == "r" and len(args) == 2:
                output.append(r"\sqrt[%s]{%s}" % (_convert_expression(args[0]), _convert_expression(args[1])))
            else:
                raise ValueError("invalid EQ command argument count")
        elif command == "o":
            overlay_start = argument_start
            switch = re.match(r"\\(?:ac|al|ar|ad)", expression[overlay_start:], re.I)
            if switch:
                overlay_start += len(switch.group(0))
            group, next_index = _balanced_group(expression, overlay_start)
            # Preserve only the two observed Word vertical offsets for an
            # explicit horizontal bar.  This retains the rendered mark without
            # asserting that it is a vector arrow or accepting arbitrary EQ
            # overlays as mathematical syntax.
            overline = re.fullmatch(r"\s*([A-Za-z])\s*,\s*\\s\\up(?:2|6)\(\s*[-－]\s*\)\s*", group)
            if switch or not overline:
                raise ValueError("unsupported EQ overlay")
            output.append(r"\bar{%s}" % overline.group(1))
        else:
            raise ValueError("unsupported EQ command: \\" + command)
        index = next_index
    return re.sub(r"\\([A-Za-z]+)\s+(?=\d)", r"\\\1 ", "".join(output)).strip()


def convert_eq_to_latex(instruction: str, visible_result: str = "") -> EqConversion:
    cleaned = _clean_instruction(instruction)
    if not re.match(r"(?i)^EQ(?:\s|$)", cleaned):
        return EqConversion("failed", None, visible_result.strip() or None, ("not an EQ field",))
    expression = re.sub(r"(?i)^EQ\s*", "", cleaned)
    expression = re.sub(r"(?i)\s+\\\*\s+MERGEFORMAT(?:INET)?\s*$", "", expression).strip()
    try:
        latex = _convert_expression(expression)
        if not latex:
            raise ValueError("empty EQ expression")
        return EqConversion("complete", latex)
    except ValueError as exc:
        visible = visible_result.strip() or None
        return EqConversion("preview_only" if visible else "failed", None, visible, (str(exc),))
