#!/usr/bin/env python3
"""Bundle src/repo-intel into a single-file executable.

Substitutes two placeholders in repo-intel.py with their data as Python string
literals — TEMPLATE with the frontend bundle (web/dist/index.html), TECHDATA
with techdata.json — then writes the result to the given output path with mode
0755.
"""

import os
import sys
from pathlib import Path

TEMPLATE_PLACEHOLDER = 'TEMPLATE = "__TEMPLATE_PLACEHOLDER__"'
TECHDATA_PLACEHOLDER = 'TECHDATA = "__TECHDATA_PLACEHOLDER__"'
VERSION_PLACEHOLDER = 'VERSION = "0.0.0-dev"'


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: build.py OUTPUT_PATH")
    out_path = Path(sys.argv[1])

    src_dir = Path(__file__).resolve().parent
    script = (src_dir / "repo-intel.py").read_text(encoding="utf-8")

    template_path = src_dir / "web" / "dist" / "index.html"
    if not template_path.exists():
        sys.exit(
            f"error: {template_path} not found — run `bun install && bun run build` "
            "in web/ (or `make build`, which does it) to produce the frontend bundle."
        )
    template = template_path.read_text(encoding="utf-8")

    techdata_path = src_dir / "techdata.json"
    if not techdata_path.exists():
        sys.exit(
            f"error: {techdata_path} not found — run `make repo-intel-techdata` "
            "(needs network) to generate it, then commit it."
        )
    techdata = techdata_path.read_text(encoding="utf-8")

    for name, placeholder in (
        ("web/dist/index.html", TEMPLATE_PLACEHOLDER),
        ("techdata.json", TECHDATA_PLACEHOLDER),
    ):
        if script.count(placeholder) != 1:
            sys.exit(
                f"error: expected exactly one {name} placeholder ({placeholder!r}) in repo-intel.py"
            )

    bundled = script.replace(TEMPLATE_PLACEHOLDER, f"TEMPLATE = {template!r}").replace(
        TECHDATA_PLACEHOLDER, f"TECHDATA = {techdata!r}"
    )

    # Bake the version only when given one (release builds pass the tag via
    # $REPO_INTEL_VERSION). Without it the sentinel is left untouched, so the
    # committed dist/repo-intel rebuilds byte-for-byte — CI gates that.
    version = os.environ.get("REPO_INTEL_VERSION", "").strip().lstrip("v")
    if version:
        if bundled.count(VERSION_PLACEHOLDER) != 1:
            sys.exit(
                f"error: expected exactly one version sentinel ({VERSION_PLACEHOLDER!r}) "
                "in repo-intel.py"
            )
        bundled = bundled.replace(VERSION_PLACEHOLDER, f"VERSION = {version!r}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(bundled, encoding="utf-8")
    out_path.chmod(0o755)
    print(f"built {out_path} ({os.path.getsize(out_path):,} bytes)")


if __name__ == "__main__":
    main()
