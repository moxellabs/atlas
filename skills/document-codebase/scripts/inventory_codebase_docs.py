#!/usr/bin/env python3
"""Read-only inventory of codebase documentation, source layout, and tests."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


DEFAULT_IGNORES = {
    ".git",
    ".hg",
    ".svn",
    ".atlas",
    ".cache",
    "node_modules",
    "target",
    "dist",
    "build",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
}

MANIFEST_NAMES = {
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "settings.gradle",
    "composer.json",
    "Gemfile",
}

SOURCE_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".rs",
    ".go",
    ".java",
    ".kt",
    ".kts",
    ".rb",
    ".php",
    ".cs",
    ".cpp",
    ".c",
    ".h",
    ".hpp",
    ".swift",
}

TEST_MARKERS = (".test.", ".spec.", "_test.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="Repository root to inspect.")
    parser.add_argument("--format", choices=("json", "markdown"), default="markdown", help="Output format.")
    parser.add_argument("--max-items", type=int, default=80, help="Maximum paths shown per list in markdown output.")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists() or not root.is_dir():
        parser.error(f"root is not a directory: {root}")

    inventory = build_inventory(root)
    if args.format == "json":
        print(json.dumps(inventory, indent=2, sort_keys=True))
    else:
        print(render_markdown(inventory, args.max_items))
    return 0


def build_inventory(root: Path) -> dict[str, Any]:
    files = list(iter_files(root))
    markdown = [path for path in files if path.suffix.lower() in {".md", ".mdx"}]
    manifests = [path for path in files if path.name in MANIFEST_NAMES]
    source = [path for path in files if path.suffix.lower() in SOURCE_EXTENSIONS]
    tests = [path for path in files if is_test_path(path)]
    docs = [path for path in markdown if is_docs_path(path)]
    readmes = [path for path in markdown if path.name.lower() == "readme.md"]
    skills = [path for path in markdown if path.name.lower() == "skill.md"]

    packages = package_roots(manifests)
    modules = module_roots(source)

    return {
        "root": str(root),
        "counts": {
            "files": len(files),
            "markdown": len(markdown),
            "docs": len(docs),
            "readmes": len(readmes),
            "skills": len(skills),
            "manifests": len(manifests),
            "source": len(source),
            "tests": len(tests),
            "package_roots": len(packages),
            "module_roots": len(modules),
        },
        "manifests": rels(root, manifests),
        "package_roots": rels(root, packages),
        "module_roots": rels(root, modules),
        "readmes": rels(root, readmes),
        "docs": rels(root, docs),
        "skills": rels(root, skills),
        "tests": rels(root, tests),
        "likely_gaps": likely_gaps(root, packages, modules, docs, readmes),
    }


def iter_files(root: Path) -> list[Path]:
    result: list[Path] = []
    for current, dirs, files in os.walk(root):
        dirs[:] = [name for name in sorted(dirs) if name not in DEFAULT_IGNORES]
        current_path = Path(current)
        for name in sorted(files):
            result.append(current_path / name)
    return result


def is_test_path(path: Path) -> bool:
    text = path.as_posix().lower()
    return any(marker in text for marker in TEST_MARKERS) or "/tests/" in text or text.endswith("/test.py")


def is_docs_path(path: Path) -> bool:
    parts = [part.lower() for part in path.parts]
    return "docs" in parts or path.name.lower() == "readme.md" or path.name.lower() == "skill.md"


def package_roots(manifests: list[Path]) -> list[Path]:
    roots = {path.parent for path in manifests if path.parent.name not in DEFAULT_IGNORES}
    return sorted(roots)


def module_roots(source: list[Path]) -> list[Path]:
    roots: set[Path] = set()
    for path in source:
        parts = path.parts
        if "src" in parts:
            index = parts.index("src")
            if index + 1 < len(parts) - 1:
                roots.add(Path(*parts[: index + 2]))
            else:
                roots.add(Path(*parts[: index + 1]))
        else:
            roots.add(path.parent)
    return sorted(roots)


def likely_gaps(root: Path, packages: list[Path], modules: list[Path], docs: list[Path], readmes: list[Path]) -> list[str]:
    doc_set = {path.resolve() for path in docs}
    readme_set = {path.resolve() for path in readmes}
    gaps: list[str] = []

    if not (root / "docs").exists() and not any(path.parent == root for path in readmes):
        gaps.append("No root docs/ directory or root README.md found.")

    for package in packages:
        package_docs = package / "docs"
        package_readme = package / "README.md"
        if package != root and not package_docs.exists() and package_readme.resolve() not in readme_set:
            gaps.append(f"Package root lacks docs or README: {relative(root, package)}")

    for module in modules:
        if module.name in {"src", "test", "tests"}:
            continue
        module_docs = module / "docs"
        if not module_docs.exists() and not any(is_relative_to(path, module) for path in doc_set):
            gaps.append(f"Source module lacks local docs: {relative(root, module)}")

    return gaps[:200]


def rels(root: Path, paths: list[Path]) -> list[str]:
    return [relative(root, path) for path in sorted(paths)]


def relative(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def render_markdown(inventory: dict[str, Any], max_items: int) -> str:
    lines = ["# Codebase Documentation Inventory", ""]
    lines.append(f"Root: `{inventory['root']}`")
    lines.append("")
    lines.append("## Counts")
    lines.append("")
    for key, value in inventory["counts"].items():
        lines.append(f"- `{key}`: {value}")
    lines.append("")

    for key, title in [
        ("package_roots", "Package Roots"),
        ("module_roots", "Module Roots"),
        ("readmes", "READMEs"),
        ("docs", "Documentation Files"),
        ("skills", "Skill Files"),
        ("tests", "Tests"),
        ("likely_gaps", "Likely Documentation Gaps"),
    ]:
        lines.extend(render_list(title, inventory[key], max_items))
    return "\n".join(lines)


def render_list(title: str, values: list[str], max_items: int) -> list[str]:
    lines = [f"## {title}", ""]
    if not values:
        lines.extend(["_None found._", ""])
        return lines
    for value in values[:max_items]:
        lines.append(f"- `{value}`")
    if len(values) > max_items:
        lines.append(f"- _{len(values) - max_items} more omitted by --max-items_")
    lines.append("")
    return lines


if __name__ == "__main__":
    raise SystemExit(main())
