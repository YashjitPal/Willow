#!/usr/bin/env python3
"""Report real hatching progress and atomically publish a validated local pet."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def library_path(explicit: str | None) -> Path:
    """The pet library Willow passes as --library (`Pets` in the Willow folder); without it, the old `pets` in the app's data directory."""
    if explicit:
        return Path(explicit).expanduser().resolve()
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData/Roaming")))
    elif sys.platform == "darwin":
        base = Path.home() / "Library/Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share")))
    return (base / "com.willow.studio/pets").resolve()


def write_json(file: Path, value: dict) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(file)


def inside(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()) or candidate == root.resolve():
        raise ValueError("The requested artifact is outside its pet run.")
    return candidate


def run_path(library: Path, argument: str) -> Path:
    run = Path(argument).expanduser().resolve()
    if run.parent != (library / ".hatching").resolve() or not run.is_dir():
        raise ValueError("Use a run returned by this library's begin command.")
    return run


def status(run: Path, stage: str, **extra) -> dict:
    file = run / "progress.json"
    current = json.loads(file.read_text(encoding="utf-8"))
    current.update(stage=stage, updatedAt=now(), **extra)
    if stage != "error":
        current.pop("message", None)
    write_json(file, current)
    return current


def begin(library: Path, name: str) -> dict:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:50] or "pet"
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + slug + "-" + uuid.uuid4().hex[:6]
    run = library / ".hatching" / run_id
    run.mkdir(parents=True, exist_ok=False)
    write_json(run / "progress.json", {"name": name[:100], "stage": "preparing", "updatedAt": now()})
    return {"run": str(run), "library": str(library), "stage": "preparing"}


def progress(run: Path, stage: str, preview: str | None, message: str | None) -> dict:
    needed = {"imagining": "pet_request.json", "posing": "references/canonical-base.png", "hatching": "frames/frames-manifest.json"}
    if stage in needed and not inside(run, needed[stage]).is_file():
        raise ValueError(f"{stage} requires {needed[stage]} first.")
    extra = {}
    if preview:
        image = inside(run, preview)
        with Image.open(image) as opened:
            opened.verify()
        extra["preview"] = image.relative_to(run).as_posix()
    if stage == "error":
        extra["message"] = (message or "Pet creation needs attention.")[:500]
    return status(run, stage, **extra)


def finish(library: Path, run: Path, atlas_argument: str) -> dict:
    atlas = Path(atlas_argument).expanduser().resolve()
    if not atlas.is_relative_to(run) or not atlas.is_file():
        raise ValueError("The finished atlas must be inside this pet run.")
    request = json.loads((run / "pet_request.json").read_text(encoding="utf-8"))
    review = json.loads((run / "qa/visual-review.json").read_text(encoding="utf-8"))
    if not all(review.get(key) is True for key in ("approved", "standardAnimations", "lookDirections")):
        raise ValueError("Review the standard animations and look directions before publishing.")
    key = request.get("chroma_key", {}).get("hex", "#00FF00")
    validation = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("validate_atlas.py")), str(atlas),
         "--require-v2", "--chroma-key", key, "--json-out", str(run / "qa/install-validation.json")],
        capture_output=True, text=True, check=False,
    )
    if validation.returncode:
        raise ValueError("The atlas did not pass validation. Inspect qa/install-validation.json before repairing it.")
    name = str(request.get("display_name") or request.get("pet_name") or json.loads((run / "progress.json").read_text())["name"])
    slug = re.sub(r"[^a-z0-9]+", "-", str(request.get("pet_id") or name).lower()).strip("-")[:60] or "pet"
    pet_id = slug
    suffix = 2
    while (library / pet_id).exists():
        pet_id = f"{slug}-{suffix}"
        suffix += 1
    package = run / ("package-" + uuid.uuid4().hex[:8])
    package.mkdir()
    with Image.open(atlas) as opened:
        image = opened.convert("RGBA")
        image.save(package / "spritesheet.webp", format="WEBP", lossless=True, exact=True)
        image.crop((0, 0, 192, 208)).save(run / "preview.png")
    manifest = {"id": pet_id, "displayName": name[:100], "description": str(request.get("description") or "A custom animated pet.")[:500],
                "spriteVersionNumber": 2, "spritesheetPath": "spritesheet.webp"}
    write_json(package / "pet.json", manifest)
    package.rename(library / pet_id)
    status(run, "ready", petId=pet_id, preview="preview.png")
    return {"id": pet_id, "name": name, "directory": str(library / pet_id), "preview": str(run / "preview.png"), "stage": "ready"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("begin")
    create.add_argument("--name", required=True)
    update = commands.add_parser("progress")
    update.add_argument("--run", required=True)
    update.add_argument("--stage", required=True, choices=["preparing", "imagining", "posing", "hatching", "error"])
    update.add_argument("--preview")
    update.add_argument("--message")
    install = commands.add_parser("finish")
    install.add_argument("--run", required=True)
    install.add_argument("--atlas", required=True)
    args = parser.parse_args()
    library = library_path(args.library)
    try:
        if args.command == "begin":
            result = begin(library, args.name)
        elif args.command == "progress":
            result = progress(run_path(library, args.run), args.stage, args.preview, args.message)
        else:
            result = finish(library, run_path(library, args.run), args.atlas)
    except (ValueError, OSError, json.JSONDecodeError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
