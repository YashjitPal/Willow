---
name: hatch-pet
description: Create or repair a custom animated desktop pet for Willow's Pets from a description or reference image. Use for requests to create, hatch, customize, or animate a pet. Generates and validates Codex-compatible version 2 sprite sheets, shows visual previews, and installs the finished pet in the local pet library.
---

# Hatch Pet

Create the pet the user describes using the image-generation tool available in this conversation. Preserve reference art, the requested style, face, markings, proportions, and props across every animation. Infer a friendly name when one is not supplied. Pixel, plush, clay, sticker, vector, and other readable styles are supported.

Use the native image-generation tool for visual generation, with all reference images attached. In Spark that is the Pets app's `app:generate_pet_image`: give it the prompt, an absolute `output` path inside the run, and every reference image's absolute path in `references`; it saves a PNG there for the helpers to read. If no image-generation tool is available, or it reports that no image model is set up, explain that limitation and stop before claiming that art was generated. Do not substitute a hand-drawn or duplicated static sprite for an AI-generated animated pet. This skill does not require a Codex account, a Codex skill, or a separate API key.

The skill's files are in `<skill>` on the user's computer, and the pet library is `<library>`. Run every helper, and read every reference, with `run_command`, using `<library>` as its `root`. The bundled Python helpers perform deterministic processing only. Use an available Python 3 interpreter with Pillow. Check `from PIL import Image`; if Pillow is missing, install it in a local virtual environment for this run. Keep shell commands appropriate to the user's operating system and quote paths containing spaces.

Read the generation and assembly workflow (`<skill>/references/workflow.md`) before generating poses. Read the animation rows (`<skill>/references/animation-rows.md`) for the exact state semantics, and the QA rubric (`<skill>/references/qa-rubric.md`) before accepting the result.

## Visible progress

Keep this four-step checklist visible in the conversation, with one step active at a time:

1. Getting the pet ready.
2. Imagining the pet's main look.
3. Picturing the pet's poses.
4. Hatching the pet.

Use the pet's name in those steps once known. Show the main character image after it exists. At the end, show the contact sheet and a working animation preview the way Spark normally presents images. Use absolute local image paths. Do not replace previews with a wall of file paths or claim that an unverified image is ready.

The Pets page also shows these stages from actual files. Its progress is written by `scripts/pet_bridge.py`:

```text
python "<skill>/scripts/pet_bridge.py" --library "<library>" begin --name "Pet Name"
```

Read the returned `run` path. Pass that exact path as `--output-dir` to `prepare_pet_run.py`, with `--force` to retain the new progress file. Add the user's description through `--pet-notes`, the chosen `--pet-name`, and any `--reference` image paths. Always give the bridge the library with its global `--library` option.

Update stages only after their prerequisite exists:

```text
python "<skill>/scripts/pet_bridge.py" --library "<library>" progress --run "<run>" --stage imagining
python "<skill>/scripts/pet_bridge.py" --library "<library>" progress --run "<run>" --stage posing --preview references/canonical-base.png
python "<skill>/scripts/pet_bridge.py" --library "<library>" progress --run "<run>" --stage hatching --preview references/canonical-base.png
```

`imagining` requires the prepared request; `posing` requires the generated canonical base; `hatching` requires the extracted frame manifest. If a tool fails or generation is blocked, record `--stage error --message "<short explanation>"` and report the actual blocker. Resume the same run after a repair.

## Generation contract

- Generate one canonical base, coherent strips for all nine animation states, four cardinal look anchors, and two coherent eight-pose look strips. Every row uses the canonical base as an image reference.
- Never ask the image model to produce an entire 8 × 11 atlas. Generate row strips, then assemble them deterministically.
- Use a flat chroma key that does not occur in the pet. Backgrounds, floor shadows, floating marks, text, and guide lines must not become part of the sprite.
- The final image is a transparent PNG or WebP, exactly **1536 × 2288**, arranged as **8 columns × 11 rows**, with **192 × 208** cells.
- Rows 0–8 are idle, moving right, moving left, waving, jumping, failed, waiting, working, and review. Working means focused task activity, distinct from directional movement.
- Rows 9–10 are sixteen clockwise look directions. The first direction is **up**, followed by 22.5-degree increments; right is 90°, down 180°, and left 270°.
- Preserve approved rows during repairs. Regenerate a bad look row coherently rather than inserting a mismatched one-off cell.
- Inspect every animation at normal pet size. Check direction, scale, silhouette, clipping, alpha holes, identity, and loop continuity. Numerical validation alone cannot prove that the pet looks right.

## Finish and install

After the workflow's deterministic checks pass and the final previews have been visually reviewed, write `qa/visual-review.json` in the run:

```json
{
  "approved": true,
  "standardAnimations": true,
  "lookDirections": true,
  "notes": "Describe what was actually checked."
}
```

Set these fields to true only after inspecting the corresponding output. Then run:

```text
python "<skill>/scripts/pet_bridge.py" --library "<library>" finish --run "<run>" --atlas "<run>/final/spritesheet.webp"
```

The bridge validates the version 2 atlas again, publishes `pet.json` and `spritesheet.webp` together, and marks the run ready. It preserves existing pets by choosing a new id if a name is already in use. Do not manually write an incomplete package into the live library.

The finished pet appears automatically on the **Pets** page (Spark, under Customise). Tell the user its name and that **Use pet** activates it. Include the character/animation preview in the response. Selecting it changes the live pet; created pets stay in the library.
