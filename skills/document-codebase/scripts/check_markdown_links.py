#!/usr/bin/env python3
"""Read-only checker for local relative Markdown links."""

from __future__ import annotations

import argparse
import fnmatch
import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse


DEFAULT_IGNORES = {
    ".git",
    ".hg",
    ".svn",
    ".atlas",
    ".cache",
    ".idea",
    ".next",
    ".nuxt",
    ".turbo",
    ".vercel",
    ".vite",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    "htmlcov",
    "lcov-report",
    "__pycache__",
    ".venv",
    "venv",
    "ios",
    "android",
    "DerivedData",
    ".gradle",
    "Pods",
}

LINK_RE = re.compile(r"(?<!\\)!?\[[^\]]*]\(([^)]+)\)")
REFERENCE_RE = re.compile(r"^\[[^\]]+]:\s+(\S+)", re.MULTILINE)
@dataclass(frozen=True)
class BrokenLink:
    file: str
    line: int
    target: str
    reason: str


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="Repository root to inspect.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text.")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists() or not root.is_dir():
        parser.error(f"root is not a directory: {root}")

    broken = check_links(root)
    if args.json:
        import json

        print(json.dumps([link.__dict__ for link in broken], indent=2, sort_keys=True))
    else:
        render_text(broken)
    return 1 if broken else 0


def check_links(root: Path) -> list[BrokenLink]:
    broken: list[BrokenLink] = []
    ignore_matcher = IgnoreMatcher(root)
    for path in markdown_files(root, ignore_matcher):
        text = path.read_text(encoding="utf-8", errors="replace")
        for target, line in extract_targets(text):
            if should_skip(target):
                continue
            parsed = urlparse(target)
            target_path = unquote(parsed.path)
            if not target_path:
                continue
            candidate = (root / target_path[1:]) if target_path.startswith("/") else (path.parent / target_path)
            if ignore_matcher.ignored(candidate):
                continue
            if not candidate.exists():
                broken.append(
                    BrokenLink(
                        file=relative(root, path),
                        line=line,
                        target=target,
                        reason="target does not exist",
                    )
                )
    return broken


def markdown_files(root: Path, ignore_matcher: "IgnoreMatcher") -> list[Path]:
    result: list[Path] = []
    for current, dirs, files in os.walk(root):
        current_path = Path(current)
        dirs[:] = [
            name
            for name in sorted(dirs)
            if name not in DEFAULT_IGNORES and not ignore_matcher.ignored(current_path / name)
        ]
        for name in sorted(files):
            path = current_path / name
            if path.suffix.lower() in {".md", ".mdx"} and not ignore_matcher.ignored(path):
                result.append(path)
    return result


class IgnoreMatcher:
    """Small root .gitignore matcher for read-only documentation checks."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.patterns = load_gitignore_patterns(self.root)

    def ignored(self, path: Path) -> bool:
        rel = relative(self.root, path)
        name = path.name
        parts = set(Path(rel).parts)
        if name in DEFAULT_IGNORES or parts.intersection(DEFAULT_IGNORES):
            return True

        ignored = False
        for pattern in self.patterns:
            negated = pattern.startswith("!")
            raw_pattern = pattern[1:] if negated else pattern
            if matches_gitignore_pattern(rel, name, raw_pattern):
                ignored = not negated
        return ignored


def load_gitignore_patterns(root: Path) -> list[str]:
    gitignore = root / ".gitignore"
    if not gitignore.exists():
        return []
    patterns: list[str] = []
    for line in gitignore.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        patterns.append(stripped)
    return patterns


def matches_gitignore_pattern(rel: str, name: str, pattern: str) -> bool:
    anchored = pattern.startswith("/")
    directory_only = pattern.endswith("/")
    normalized = pattern.strip("/")
    if not normalized:
        return False

    candidates = [rel]
    if not anchored and "/" not in normalized:
        candidates.append(name)
        candidates.extend(Path(rel).parts)

    if directory_only:
        return rel == normalized or rel.startswith(f"{normalized}/") or any(part == normalized for part in Path(rel).parts)

    return any(fnmatch.fnmatch(candidate, normalized) for candidate in candidates)


def extract_targets(text: str) -> list[tuple[str, int]]:
    targets: list[tuple[str, int]] = []
    in_fence = False
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        line_without_code = strip_inline_code(line)
        for regex in (LINK_RE, REFERENCE_RE):
            for match in regex.finditer(line_without_code):
                target = match.group(1).strip()
                targets.append((target, line_number))
    return targets


def strip_inline_code(line: str) -> str:
    return re.sub(r"`[^`]*`", "", line)


def should_skip(target: str) -> bool:
    if target.startswith("#") or target.startswith("mailto:"):
        return True
    parsed = urlparse(target)
    if parsed.scheme and parsed.scheme not in {"", "file"}:
        return True
    if target.startswith("$") or target.startswith("<"):
        return True
    return False


def relative(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def render_text(broken: list[BrokenLink]) -> None:
    if not broken:
        print("No broken local Markdown links found.")
        return
    print(f"Broken local Markdown links: {len(broken)}")
    for link in broken:
        print(f"{link.file}:{link.line}: {link.target} ({link.reason})")


if __name__ == "__main__":
    raise SystemExit(main())
