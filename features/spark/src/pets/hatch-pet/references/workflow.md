# Generation and assembly

These are the same sprite states, dimensions, directional order, and deterministic raster helpers used by Hatch Pet. The conversation's image-generation tool supplies the generated images. Replace `<python>`, `<skill>`, and `<run>` with actual paths, using the shell's proper quoting. Use the run returned by `pet_bridge.py begin`; always pass its output directory explicitly.

## Prepare and generate

```text
<python> "<skill>/scripts/prepare_pet_run.py" --pet-name "Pet Name" --pet-notes "User's character description" --output-dir "<run>" --style-preset auto --force
```

Add each user reference with `--reference "<absolute image path>"`. Read `pet_request.json` and `imagegen-jobs.json`. Each job names its prompt file, required input images, dependencies, and decoded output path. Generate a job only after its dependencies are complete. Read the prompt and attach every listed reference image to the native image-generation tool. Guides are layout references; they must not appear in the result.

Generate `base` first. Copy the chosen native generated image to both `decoded/base.png` and `references/canonical-base.png`. Keep this identity reference unchanged throughout the run. Mark the job complete only after its actual image exists and has been inspected. Update the visible progress to `posing`, with the canonical base preview.

Generate `idle` and `running-right` next, inspect identity and cadence, then complete the remaining standard rows. Generate `running-left` separately unless mirroring the approved rightward strip preserves all markings, props, and meaning. The helper `derive_running_left_from_running_right.py` supports a deliberate mirror; read its help before using it.

For each completed row, extract and inspect it immediately:

```text
<python> "<skill>/scripts/extract_strip_frames.py" --decoded-dir "<run>/decoded" --output-dir "<run>/qa/rows/<state>/frames" --states <state> --method auto
<python> "<skill>/scripts/inspect_frames.py" --frames-root "<run>/qa/rows/<state>/frames" --json-out "<run>/qa/rows/<state>/review.json" --states <state> --require-components
```

Fix clipping, detached parts, identity drift, and extraction errors before accepting the row. Record visual/tool failures as progress errors instead of displaying invented completion. Repair the failing row in the existing run, keeping approved rows and the canonical base.

### Recovering extraction

When a source strip has complete, separated poses with stable scale and placement, `stable-slots` can correct extraction-induced size or baseline jumps. Use it only after checking the source: overlapping poses, limbs crossing slot boundaries, and fragments from neighboring poses need a regenerated row. Keep the canonical base and matching layout guide attached to that regeneration.

For a suitable source, extract and inspect the same row with these paired options:

```text
<python> "<skill>/scripts/extract_strip_frames.py" --decoded-dir "<run>/decoded" --output-dir "<run>/qa/rows/<state>/frames" --states <state> --method stable-slots
<python> "<skill>/scripts/inspect_frames.py" --frames-root "<run>/qa/rows/<state>/frames" --json-out "<run>/qa/rows/<state>/review.json" --states <state> --require-components --allow-stable-slots
```

`--allow-stable-slots` permits that explicit extraction method; it does not approve the artwork. Inspect the extracted cells and their motion at normal pet size before accepting the warning. Slot slicing can cut off a limb or include another pose's fragments even when the numerical check passes. If that happens, regenerate the row rather than accepting it or relaxing further checks.

## Standard atlas and motion

Once all nine rows pass, collect their approved frames into `<run>/frames/<state>/`. Merge the per-row `frames-manifest.json` files into `<run>/frames/frames-manifest.json`, retaining the common `chroma_key`, each row's `state` and extraction `method`, and updating `frames` to the copied paths. Copy the exact reviewed images; re-extracting every row with `auto` would discard a correction already approved during row QA.

Run the combined inspection below. Add `--allow-stable-slots` only if a collected row used that method and its visual warning was reviewed. Then assemble and preview the standard atlas:

```text
<python> "<skill>/scripts/inspect_frames.py" --frames-root "<run>/frames" --json-out "<run>/qa/review.json" --require-components
<python> "<skill>/scripts/compose_atlas.py" --frames-root "<run>/frames" --output "<run>/final/standard.png"
<python> "<skill>/scripts/make_contact_sheet.py" "<run>/final/standard.png" --output "<run>/qa/standard-contact-sheet.png"
<python> "<skill>/scripts/render_animation_previews.py" --frames-root "<run>/frames" --output-dir "<run>/qa/previews"
```

Inspect the contact sheet and normal-size GIFs. Work must show effort, waiting must ask for input, movement must face its direction, and idle must contain subtle visible motion. The intermediate standard atlas is 8 × 9 and must never be installed as a new pet. Start `hatching` only after the extracted frame manifest exists.

## Look directions

Write a short `qa/look-mechanics.md` identifying how the character communicates each direction. Generate the manifest's `look-cardinals` strip in the exact order **up, screen-right, down, screen-left**. Ground it in the base and every reference defining the face, head, props, and look mechanics. Extract the approved anchors:

```text
<python> "<skill>/scripts/extract_cardinal_anchors.py" --strip "<run>/decoded/look-cardinals.png" --output-dir "<run>/decoded/look-anchors" --chroma-key "<key>" --json-out "<run>/qa/cardinal-anchors.json"
<python> "<skill>/scripts/compose_cardinal_anchor_strip.py" --anchors-dir "<run>/decoded/look-anchors" --output "<run>/decoded/look-anchors-approved.png"
```

Use the actual key from `pet_request.json`. Generate look row 9 as one coherent eight-pose strip, grounded in the approved cardinal strip and base. Directions are 000, 022.5, 045, 067.5, 090, 112.5, 135, 157.5 degrees. Inspect each pose at normal pet size before proceeding.

Generate row 10 only after row 9 passes. Ground it additionally in row 9 for registration and scale. Directions are 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5 degrees. Cardinal directions must be unmistakable; intermediate directions must preserve clockwise motion without a snap at either row boundary. Repair a failing row as a coherent strip.

```text
<python> "<skill>/scripts/assemble_extended_atlas.py" --base-atlas "<run>/final/standard.png" --look-row-9 "<run>/decoded/look-row-9.png" --look-row-10 "<run>/decoded/look-row-10.png" --chroma-key "<key>" --output "<run>/final/extended.png"
<python> "<skill>/scripts/despill_chroma_edges.py" "<run>/final/extended.png" --output "<run>/final/clean.png" --webp-output "<run>/final/spritesheet.webp" --chroma-key "<key>" --json-out "<run>/qa/chroma-cleanup.json"
<python> "<skill>/scripts/validate_atlas.py" "<run>/final/spritesheet.webp" --require-v2 --chroma-key "<key>" --json-out "<run>/qa/atlas-validation.json"
<python> "<skill>/scripts/make_contact_sheet.py" "<run>/final/spritesheet.webp" --output "<run>/qa/contact-sheet.png"
<python> "<skill>/scripts/make_direction_qa_sheet.py" "<run>/final/spritesheet.webp" --output "<run>/qa/look-directions.png"
```

Do not add repeated chroma cleanup once the report and validator pass. Inspect the final contact sheet on light and dark backgrounds, all nine standard animation GIFs, and all sixteen ordered look directions. Use `measure_direction_continuity.py` and its help when motion reveals a size or registration jump. Treat the QA rubric as the acceptance standard; do not weaken validator flags to publish a failing pet.

## Publish and show

Follow the SKILL.md visual-review and `pet_bridge.py finish` steps. The bridge publishes a Codex-compatible `pet.json` with `spriteVersionNumber: 2` and `spritesheetPath: spritesheet.webp` beside the image. It writes to Willow's pet library, not Codex's own pet folder.

Show the real character preview and working GIF in the final conversation response. The picker supplies an animated preview and Use pet. No API key or generation configuration is stored in pet manifests or progress files.
