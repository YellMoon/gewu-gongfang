"""Batched MathType OLE to MathML/LaTeX conversion with safe caching."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable, Iterable

from formula_mathml import convert_mathml_to_latex
from formula_model import FormulaConversionResult


MATHTYPE_BATCH_SENTINEL = "__GEWU_MATHTYPE_BATCH_JSON__"
_CACHE: dict[str, str | None] = {}


def mathtype_cache_key(ole_data: bytes) -> str:
    return hashlib.sha256(ole_data).hexdigest()


def clear_mathtype_cache() -> None:
    _CACHE.clear()


def set_cached_mathml(key: str, mathml: str | None) -> None:
    _CACHE[key] = mathml


def extract_mathml_from_converter_output(output: str | None) -> str | None:
    if not output:
        return None
    match = re.search(r"(?:<\?xml[^>]*>\s*)?<math\b.*?</math>", output, flags=re.S | re.I)
    return match.group(0) if match else None


def parse_mathtype_batch_stdout(stdout: str) -> list[str | None] | None:
    marker_index = stdout.rfind(MATHTYPE_BATCH_SENTINEL)
    if marker_index < 0:
        return None
    try:
        decoded = json.loads(stdout[marker_index + len(MATHTYPE_BATCH_SENTINEL):].strip())
    except json.JSONDecodeError:
        return None
    if not isinstance(decoded, list):
        return None
    return [extract_mathml_from_converter_output(item) if isinstance(item, str) else None for item in decoded]


def find_ruby_executable() -> str | None:
    configured = os.environ.get("GEWU_RUBY_BIN") or os.environ.get("RUBY_BIN")
    if configured and Path(configured).is_file():
        return configured
    project_root = Path(__file__).resolve().parents[3]
    candidates = [
        project_root / "runtime" / "ruby" / "bin" / "ruby.exe",
        project_root / "runtime" / "ruby" / "bin" / "ruby",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return shutil.which("ruby")


def _ruby_environment(ruby: str) -> dict[str, str]:
    env = dict(os.environ)
    ruby_root = Path(ruby).resolve().parent.parent
    gem_root = ruby_root / "lib" / "ruby" / "gems" / "3.3.0"
    if gem_root.is_dir():
        env["GEM_HOME"] = str(gem_root)
        env["GEM_PATH"] = str(gem_root)
    env["RUBYOPT"] = "-EUTF-8:UTF-8"
    return env


def convert_mathtype_oles_to_mathml_batch(
    ole_datas: Iterable[bytes],
    runner: Callable = subprocess.run,
) -> dict[str, str | None]:
    unique: list[tuple[str, bytes]] = []
    seen: set[str] = set()
    for ole_data in ole_datas:
        key = mathtype_cache_key(ole_data)
        if key in seen:
            continue
        seen.add(key)
        if key not in _CACHE:
            unique.append((key, ole_data))
    if not unique:
        return {key: _CACHE.get(key) for key in seen}
    ruby = find_ruby_executable()
    if not ruby:
        for key, _data in unique:
            _CACHE[key] = None
        return {key: _CACHE.get(key) for key in seen}

    try:
        with tempfile.TemporaryDirectory(prefix="gewu-mathtype-") as temp_dir:
            paths: list[str] = []
            for index, (_key, data) in enumerate(unique):
                path = Path(temp_dir) / ("formula_%d.bin" % index)
                path.write_bytes(data)
                paths.append(str(path))
            script = (
                "require 'json'; require 'mathtype_to_mathml_plus'; "
                "results = ARGV.map { |path| begin MathTypeToMathMLPlus::Converter.new(path).convert rescue nil end }; "
                "print '%s'; puts JSON.generate(results)" % MATHTYPE_BATCH_SENTINEL
            )
            completed = runner(
                [ruby, "-e", script, *paths],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=max(20, 12 + len(paths) * 10),
                env=_ruby_environment(ruby),
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
    except Exception:
        for key, _data in unique:
            _CACHE[key] = None
        return {key: _CACHE.get(key) for key in seen}

    converted = parse_mathtype_batch_stdout(completed.stdout)
    if converted is None or len(converted) != len(unique):
        for key, _data in unique:
            _CACHE[key] = None
        return {key: _CACHE.get(key) for key in seen}
    for (key, _data), mathml in zip(unique, converted):
        _CACHE[key] = mathml
    return {key: _CACHE.get(key) for key in seen}


def convert_mathtype_ole_to_mathml(ole_data: bytes, runner: Callable = subprocess.run) -> str | None:
    key = mathtype_cache_key(ole_data)
    if key in _CACHE:
        return _CACHE[key]
    return convert_mathtype_oles_to_mathml_batch([ole_data], runner=runner).get(key)


def convert_mathtype_ole(
    ole_data: bytes,
    preview_ref: str | None = None,
    runner: Callable = subprocess.run,
) -> FormulaConversionResult:
    mathml = convert_mathtype_ole_to_mathml(ole_data, runner=runner)
    if not mathml:
        return FormulaConversionResult(
            "preview_only" if preview_ref else "failed",
            preview_ref=preview_ref,
            warnings=("MathType OLE conversion unavailable or failed",),
        )
    converted = convert_mathml_to_latex(mathml)
    return FormulaConversionResult(
        converted.status,
        canonical_latex=converted.canonical_latex,
        normalized_mathml=mathml,
        preview_ref=preview_ref,
        warnings=converted.warnings,
    )
