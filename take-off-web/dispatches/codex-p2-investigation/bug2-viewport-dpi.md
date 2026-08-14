# Bug 2 — `get_page_image` ignores `viewport` and `dpi`

## VERDICT: confirmed

The schema declares `viewport` and `dpi`. The executor reads neither. It reads an undeclared `render_scale` field and passes the full page through MuPDF, then forces a downscale to MAX_IMAGE_EDGE = 1568 px. There is no crop path, no DPI honouring, and no offset/scale returned to the agent.

## EVIDENCE

### Schema (declares `viewport` + `dpi`)
`take-off-web/packages/shared/src/tool-schemas.ts:111-119`
```
get_page_image: {
  description:
    'Render a PDF page (or viewport region) to PNG. Returns base64 PNG plus a summary of nearby vector geometry useful for snapping.',
  input: z.object({
    project_id: z.string(),
    page_index: z.number().int().min(0),
    viewport: ViewportZ.optional(),                              // ← declared
    dpi: z.number().int().min(72).max(300).optional().default(150),// ← declared, default 150
  }),
  ...
}
```
`ViewportZ` (same file, :90-95) is `{x, y, width, height}` — a crop rectangle.

### Executor (uses neither)
`take-off-web/apps/web/src/lib/agentTools.ts:118-172`
```
case 'get_page_image': {
  ...
  const renderScale = Number(input.render_scale ?? 1.0);          // ← undocumented field; default 1×
  const { pixels, width, height } = mupdfController.renderPageToImageData(
    resolved.localIndex,
    renderScale
  );
  const png = pixelsToPngBase64(pixels, width, height);           // ← whole page, then forced ≤1568px
  ...
}
```
- `input.viewport` is never read.
- `input.dpi` is never read.
- The renderer signature (`mupdfController.ts:192`) is `renderPageToImageData(pageIndex, scale=1.0)` — scale only, no rect; can't crop even if the executor wanted to.
- `pixelsToPngBase64` (:74) applies `MAX_IMAGE_EDGE = 1568` downscale regardless of caller intent.

### Return contract (offset/scale not returned)
The text block (:163-167) tells the model the output dimensions and the combined `renderScale × downscale` factor, but never an `x/y` offset (because there is no crop). So even if the agent guessed at high `render_scale`, it has no way to receive a sub-rect of a sheet.

## BLAST RADIUS

- The system prompt instructs the agent to "Call get_page_image to see a page before measuring it" (`useTakeoffAgent.ts:75`) — i.e. once per page, no zoom workflow taught.
- The schema description ("or viewport region") and explicit `viewport` field actively invite the agent to request crops. Per the design doc (`takeoff-agent-design.md:24`) the system was originally specced around viewport captures.
- For a Driven waterproofing takeoff on A1/A0 builder plans (typical: Hallmark/AHC PDFs render ≫1568 px even at 1×), the model's image is downscaled hard. Small details (fillet/junction symbols, dimension text, shower-tray hatch) are sub-readable at full-sheet resolution.
- User-visible failure modes:
  1. Wrong measurement — model traces a polygon on a blurry sheet, misplaces a vertex by 2-3 px, area off by several percent on a 12 m² shower.
  2. Missed counts — symbols too small to distinguish from background noise once downscaled.
  3. Token waste — the model may re-request the same page hoping a different call gives more detail (it can't).
- Frequency: every multi-page takeoff. The agent has no alternative tool for closeups.

## ROOT CAUSE

Schema/executor drift: the public contract still advertises `viewport`/`dpi` from an earlier design, but the implementation was rewritten around a private `render_scale` knob plus a hard MAX_IMAGE_EDGE cap, with no crop path through `mupdfController`.

## FIX SKETCH (recommend: honour the contract)

- Extend `mupdfController.renderPageToImageData` (or add a sibling) to accept an optional viewport `{x, y, width, height}` in PDF points, build a `mupdf.Matrix.scale × translate`, and `toPixmap` only the cropped bbox.
- In the executor: read `input.viewport` and `input.dpi`; compute `renderScale = dpi / 72`; pass viewport through; remove the undeclared `render_scale` field (or alias it for back-compat).
- Soften the MAX_IMAGE_EDGE clamp when an explicit viewport is supplied — the agent is asking for a high-fidelity crop on purpose; cap at, say, 2048 or only downscale when truly necessary.
- Return crop metadata in the text block: `offset_x`, `offset_y` (PDF points), `pdf_points_per_image_pixel`, and re-state how to convert image coords → PDF points (`x_pdf = offset_x + x_img / scale`).
- Cheaper alternative: drop `viewport`/`dpi` from the schema, rename `render_scale` to a public field, and update the schema description. Not recommended — kills the only path to readable detail on large sheets.

## TEST PLAN

1. Unit: feed a known A1 sheet, call executor with `viewport={x:100,y:100,width:200,height:200}` and `dpi:300`; assert the returned PNG dims ≈ `200 * 300/72 = 833 px` per side and the text block contains correct offset/scale.
2. Integration: run the agent loop on a real Hallmark plan; verify the model emits a follow-up `get_page_image` with a viewport after first seeing the full sheet, and that subsequent `add_area` coordinates land inside the shower.
3. Regression: existing full-page call with no viewport/dpi still returns a ≤1568 px PNG with `renderScale=1` semantics (i.e. agent measurements on full-page calls remain unchanged).
4. Schema drift guard: assert `Object.keys(toolSchemas.get_page_image.input.shape)` equals the set the executor actually reads — would have caught this drift.
