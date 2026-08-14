# Getting the plans

You cannot do a takeoff without the actual plan bytes on disk, rasterised. This file
records where Driven's plans live and how to retrieve them, depending on what tools the
current session has.

## Where the plans are
- **Builder plans:** Driven's M365 / SharePoint under `01_BUILDERS/<Builder>/`.
- **Leading Edge:** `01_BUILDERS/Leading_Edge/`, SharePoint drive id
  `b!mUMgiiHsb0GM2iN0QYbT8l21Y7kyjPBFuXMTpqR-uCKXKVmHsjiPTa9FGV4lQry7`.
- Each job is a lot folder (e.g. `LOT 4232`, `N696R`) containing the architectural
  PDF set.

## Retrieval — session with SharePoint / M365 MCP tools
If the session exposes SharePoint/OneDrive MCP tools (`sharepoint_search`,
`sharepoint_folder_search`, `search_files`, `read_file_content`,
`download_file_content`, `get_file_metadata`):

1. `sharepoint_folder_search` / `search_files` for the builder + lot to locate the
   PDF and get its `driveId` + `itemId`.
2. `download_file_content` (or read the raw bytes) to pull the **actual file** to disk.
   Do not stop at metadata — you need the bytes to rasterise.
3. Rasterise: `pdftoppm -r 200 <file>.pdf page` and read every page image.

## Retrieval — Graph raw fallback
If only a raw Graph passthrough is available, fetch the drive item **without
`$select`** so the temporary `@microsoft.graph.downloadUrl` is not stripped:

```
GET /drives/{driveId}/items/{itemId}
```

Then `curl` the `downloadUrl` to disk and rasterise as above. (Adding `$select` to that
call drops `downloadUrl` and you get metadata only — a past failure mode.)

## Retrieval — user upload
If the user attaches the PDF directly, just use it. Rasterise and proceed.

## Hard checks before measuring
- **Confirm it's the right job.** Wrong-lot mix-ups have happened (a chase email once
  carried the wrong dwelling's plans). Match the lot/job/builder on the title block to
  what you were asked to quote.
- **Confirm the set is complete and legible.** Missing or unreadable sheets → flag and
  request the correct file. Do not infer scope to fill a gap.
- If the correct plans never arrive, the takeoff is **blocked** — say so. (e.g. the
  Risley job stayed blocked pending the correct BA plans.)
