import { useCallback, useEffect, useRef } from 'react';
import type { TakeoffItem, Shape } from '../types';
import { ToolType } from '../types';
import { api } from '../lib/api';
import { useRetryBackoff } from './useRetryBackoff';

// Sync local React state → REST API by diffing on every items change.
//
// Tradeoffs:
//   - Eventually-consistent: a brief beat passes between drawing and persistence.
//   - Adds/deletes are reliable; *updates* (drag a vertex, edit a property)
//     are detected by checking shape.points/value drift and item field drift.
//   - Race protection: each shape/item id is locked while in-flight so a
//     rapid add+delete doesn't double-queue.
//
// IDs:
//   The client picks UUIDs and passes them in (shape_id / item_id). The worker
//   honours those, so server state always agrees with what's in React.

type SyncOp = 'creating' | 'deleting' | 'updating';

interface ItemSnapshot {
  label: string;
  color: string;
  unit: string;
  formula?: string;
  price?: number;
  group?: string;
  visible?: boolean;
  depth?: number;
  assemblyId?: string;
  hiddenPages?: number[];
  propertiesHash: string;
  subItemsHash: string;
  shapeIds: Set<string>;
}

interface ShapeSnapshot {
  itemId: string;
  pageIndex: number;
  pointsHash: string;
  value: number;
  deduction: boolean;
  text?: string;
}

function hashPoints(shape: Shape): string {
  // Cheap stable identifier for "points changed" detection.
  const ps = shape.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';');
  const bs = shape.bulges ? `|${shape.bulges.join(',')}` : '';
  return ps + bs;
}

function snapshotItem(item: TakeoffItem): ItemSnapshot {
  return {
    label: item.label,
    color: item.color,
    unit: item.unit,
    formula: item.formula,
    price: item.price,
    group: item.group,
    visible: item.visible,
    depth: item.depth,
    assemblyId: item.assemblyId,
    hiddenPages: item.hiddenPages,
    propertiesHash: JSON.stringify(item.properties ?? []),
    subItemsHash: JSON.stringify(item.subItems ?? []),
    shapeIds: new Set(item.shapes.map((s) => s.id)),
  };
}

function snapshotShape(item: TakeoffItem, shape: Shape): ShapeSnapshot {
  return {
    itemId: item.id,
    pageIndex: shape.pageIndex,
    pointsHash: hashPoints(shape),
    value: shape.value,
    deduction: !!shape.deduction,
    text: shape.text,
  };
}

function itemChanged(a: ItemSnapshot, b: ItemSnapshot): boolean {
  return (
    a.label !== b.label ||
    a.color !== b.color ||
    a.unit !== b.unit ||
    a.formula !== b.formula ||
    a.price !== b.price ||
    a.group !== b.group ||
    a.visible !== b.visible ||
    a.depth !== b.depth ||
    a.assemblyId !== b.assemblyId ||
    a.propertiesHash !== b.propertiesHash ||
    a.subItemsHash !== b.subItemsHash ||
    JSON.stringify(a.hiddenPages ?? []) !== JSON.stringify(b.hiddenPages ?? [])
  );
}

function pickItemPatch(item: TakeoffItem): Parameters<typeof api.items.update>[1] {
  return {
    label: item.label,
    color: item.color,
    unit: item.unit,
    formula: item.formula,
    price: item.price ?? null,
    group: item.group,
    visible: item.visible,
    depth: item.depth ?? null,
    assembly_id: item.assemblyId ?? null,
    hidden_pages: item.hiddenPages,
    properties: item.properties ?? [],
    sub_items: item.subItems ?? [],
  };
}

export interface SyncStatus {
  /** True when nothing is in flight and no failed write is waiting to retry. */
  isIdle: () => boolean;
}

export function useShapeSync(projectId: string | null, items: TakeoffItem[]): SyncStatus {
  const itemSnapshots = useRef<Map<string, ItemSnapshot>>(new Map());
  const shapeSnapshots = useRef<Map<string, ShapeSnapshot>>(new Map());
  const inflight = useRef<Map<string, SyncOp>>(new Map());
  const lastProjectId = useRef<string | null>(null);

  // Refs can't trigger a re-render on their own — every settled in-flight op
  // wakes the effect again so:
  //  (a) shapes deferred while their parent item was creating get processed
  //      (immediately, on success),
  //  (b) work that failed on a transient prerequisite (e.g. shape POST
  //      arriving before the scale POST) gets retried — after an exponential
  //      backoff, so a persistent 4xx can't become a tight request loop.
  const backoff = useRetryBackoff();

  useEffect(() => {
    if (!projectId) {
      // Detached (e.g. a local import). Forget the old project so that
      // re-opening it later re-primes from the server instead of diffing
      // against stale snapshots, and orphan any in-flight completions.
      if (lastProjectId.current !== null) {
        lastProjectId.current = null;
        itemSnapshots.current = new Map();
        shapeSnapshots.current = new Map();
        inflight.current = new Map();
      }
      return;
    }

    // Project switched (or initial load): the items array represents the
    // server's current truth, so prime snapshots without sending any writes.
    if (projectId !== lastProjectId.current) {
      itemSnapshots.current = new Map();
      shapeSnapshots.current = new Map();
      inflight.current = new Map();
      backoff.reset();
      for (const item of items) {
        itemSnapshots.current.set(item.id, snapshotItem(item));
        for (const shape of item.shapes) {
          shapeSnapshots.current.set(shape.id, snapshotShape(item, shape));
        }
      }
      lastProjectId.current = projectId;
      return;
    }

    // Bind this pass (and every completion it schedules) to THIS project's
    // maps. A project switch replaces the refs with fresh maps, so a request
    // for the previous project that settles later only touches the discarded
    // maps. Writing it into the new project's snapshots made the next pass
    // treat that id as "removed locally" and DELETE it — from the previous
    // project, via the unscoped DELETE route.
    const itemSnaps = itemSnapshots.current;
    const shapeSnaps = shapeSnapshots.current;
    const inflightOps = inflight.current;
    // Run the success/failure bookkeeping AFTER the inflight lock is released
    // so the woken effect sees the key as free; stale completions are dropped.
    const settle = (key: string, ok: boolean) => {
      if (inflightOps !== inflight.current) return;
      inflightOps.delete(key);
      if (ok) backoff.succeeded(key);
      else backoff.failed(key);
    };

    // Build the next-state maps so we can diff against the previous snapshot.
    const nextItems = new Map<string, TakeoffItem>();
    const nextShapes = new Map<string, { item: TakeoffItem; shape: Shape }>();
    for (const item of items) {
      nextItems.set(item.id, item);
      for (const shape of item.shapes) nextShapes.set(shape.id, { item, shape });
    }

    // --- ITEMS: create / update / delete ----------------------------------

    for (const [itemId, item] of nextItems) {
      if (inflightOps.has(`item:${itemId}`)) continue;
      if (backoff.isBackingOff(`item:${itemId}`)) continue;
      const prev = itemSnaps.get(itemId);
      if (!prev) {
        // New item — POST it. Snapshot is set ONLY on success so a transient
        // failure leaves no "marked synced" state and the next diff retries.
        inflightOps.set(`item:${itemId}`, 'creating');
        const snap = snapshotItem(item);
        api.items
          .create({
            project_id: projectId,
            id: itemId,
            label: item.label,
            type: item.type,
            color: item.color,
            unit: item.unit,
            properties: item.properties,
            formula: item.formula,
            price: item.price,
            group: item.group,
            visible: item.visible,
            depth: item.depth,
            assembly_id: item.assemblyId,   // preserve assembly link
            sub_items: item.subItems,       // preserve sub-item breakdown
            hidden_pages: item.hiddenPages, // preserve per-page hides on copy/paste
          })
          .then(() => {
            itemSnaps.set(itemId, snap);
            return true;
          })
          .catch((e) => {
            console.error('sync: create item failed', itemId, e);
            return false;
          })
          // On success this wakes the effect so child shapes deferred for
          // this item run straight away.
          .then((ok) => settle(`item:${itemId}`, ok));
      } else if (itemChanged(prev, snapshotItem(item))) {
        // Mutated item — PUT it. Same snapshot-on-success rule.
        inflightOps.set(`item:${itemId}`, 'updating');
        const newSnap = snapshotItem(item);
        api.items
          .update(itemId, pickItemPatch(item))
          .then(() => {
            itemSnaps.set(itemId, newSnap);
            return true;
          })
          .catch((e) => {
            console.error('sync: update item failed', itemId, e);
            return false;
          })
          .then((ok) => settle(`item:${itemId}`, ok));
      }
    }

    for (const itemId of [...itemSnaps.keys()]) {
      if (nextItems.has(itemId)) continue;
      if (inflightOps.has(`item:${itemId}`)) continue;
      if (backoff.isBackingOff(`item:${itemId}`)) continue;

      // Change Item moves every shape out of a source item, then App removes
      // the empty source item from local state. If we DELETE the source row
      // before the shape reparent PUTs land, the items table's ON DELETE
      // CASCADE wipes the shape rows; the subsequent PUT returns
      // updated:false but useShapeSync still snapshots it as success, so the
      // moved measurements survive in-memory and silently vanish on reload.
      // Defer the item DELETE while any of its child shapes is mid-reparent
      // — either the snapshot still points here but the next state moved it
      // elsewhere, or there's an in-flight shape PUT we haven't confirmed.
      let hasPendingReparent = false;
      for (const [shapeId, snap] of shapeSnaps) {
        if (snap.itemId !== itemId) continue;
        const next = nextShapes.get(shapeId);
        if (next && next.item.id !== itemId) {
          hasPendingReparent = true;
          break;
        }
        if (inflightOps.get(`shape:${shapeId}`) === 'updating') {
          hasPendingReparent = true;
          break;
        }
      }
      if (hasPendingReparent) continue;

      inflightOps.set(`item:${itemId}`, 'deleting');
      api.items
        .delete(itemId)
        .then(() => {
          itemSnaps.delete(itemId);
          return true;
        })
        .catch((e) => {
          console.error('sync: delete item failed', itemId, e);
          return false;
        })
        .then((ok) => settle(`item:${itemId}`, ok));
    }

    // --- SHAPES: create / update / delete --------------------------------

    for (const [shapeId, { item, shape }] of nextShapes) {
      if (inflightOps.has(`shape:${shapeId}`)) continue;
      if (backoff.isBackingOff(`shape:${shapeId}`)) continue;
      const prev = shapeSnaps.get(shapeId);
      const nextSnap = snapshotShape(item, shape);

      if (!prev) {
        // Skip if the item hasn't been created server-side yet — the next
        // tick (after the item POST resolves) will pick this shape up.
        if (inflightOps.has(`item:${item.id}`)) continue;

        inflightOps.set(`shape:${shapeId}`, 'creating');
        const dedupe = !!shape.deduction;
        const promise =
          item.type === ToolType.NOTE
            ? api.shapes.note({
                project_id: projectId,
                page_index: shape.pageIndex,
                points: shape.points,
                text: shape.text ?? '',
                item_id: item.id,
                shape_id: shape.id,
              })
            : item.type === ToolType.AREA ||
                item.type === ToolType.FILL ||
                item.type === ToolType.VOLUME
              ? // VOLUME stores a polygon (area) shape; the volume itself is
                // area × item.depth, computed in buildQuote on the server.
                api.shapes.area({
                  project_id: projectId,
                  page_index: shape.pageIndex,
                  points: shape.points,
                  item_id: item.id,
                  shape_id: shape.id,
                  deduction: dedupe,
                  snap: false,
                })
              : item.type === ToolType.LINEAR ||
                  item.type === ToolType.DIMENSION ||
                  item.type === ToolType.SEGMENT
                ? api.shapes.linear({
                    project_id: projectId,
                    page_index: shape.pageIndex,
                    points: shape.points,
                    item_id: item.id,
                    shape_id: shape.id,
                    deduction: dedupe,
                    snap: false,
                  })
                : item.type === ToolType.COUNT
                  ? api.shapes.count({
                      project_id: projectId,
                      page_index: shape.pageIndex,
                      points: shape.points,
                      item_id: item.id,
                      shape_id: shape.id,
                      deduction: dedupe,
                    })
                  : item.type === ToolType.ARC && shape.points.length >= 2
                    ? // Multi-vertex ARCs in the canvas are polylines of straight
                      // chords (bulges = []). The arc endpoint only persists a
                      // single segment, which truncated everything past the
                      // first chord on reload. Route polyline arcs through the
                      // linear endpoint so all vertices survive; single-segment
                      // arcs with a bulge still go through /arc to preserve
                      // curvature.
                      shape.points.length > 2
                      ? api.shapes.linear({
                          project_id: projectId,
                          page_index: shape.pageIndex,
                          points: shape.points,
                          item_id: item.id,
                          shape_id: shape.id,
                          deduction: dedupe,
                          snap: false,
                        })
                      : api.shapes.arc({
                          project_id: projectId,
                          page_index: shape.pageIndex,
                          start: shape.points[0],
                          end: shape.points[1],
                          bulge: shape.bulges?.[0] ?? 0,
                          item_id: item.id,
                          shape_id: shape.id,
                          deduction: dedupe,
                        })
                    : Promise.resolve(null);
        promise
          .then(() => {
            shapeSnaps.set(shapeId, nextSnap);
            return true;
          })
          .catch((e) => {
            console.error('sync: create shape failed', shapeId, e);
            return false;
          })
          .then((ok) => settle(`shape:${shapeId}`, ok));
      } else if (
        prev.itemId !== nextSnap.itemId ||
        prev.pointsHash !== nextSnap.pointsHash ||
        prev.deduction !== nextSnap.deduction ||
        prev.value !== nextSnap.value ||
        prev.text !== nextSnap.text
      ) {
        // Reparenting (itemId), geometry edit (pointsHash, value), deduction
        // toggle, or NOTE text edit. Send all fields the worker accepts; on
        // a reparent the worker recalcs both old and new item totals.
        inflightOps.set(`shape:${shapeId}`, 'updating');
        api.shapes
          .update(shapeId, {
            points: shape.points,
            deduction: shape.deduction,
            value: shape.value,
            text: shape.text,
            item_id: prev.itemId !== nextSnap.itemId ? nextSnap.itemId : undefined,
          })
          .then((res) => {
            if (!res.updated) {
              // The row is gone server-side (deleted from another tab/user).
              // Drop the snapshot so the next pass re-creates the shape from
              // the local copy, instead of marking a no-op as synced.
              shapeSnaps.delete(shapeId);
              return true;
            }
            shapeSnaps.set(shapeId, nextSnap);
            return true;
          })
          .catch((e) => {
            console.error('sync: update shape failed', shapeId, e);
            return false;
          })
          .then((ok) => settle(`shape:${shapeId}`, ok));
      }
    }

    for (const shapeId of [...shapeSnaps.keys()]) {
      if (nextShapes.has(shapeId)) continue;
      if (inflightOps.has(`shape:${shapeId}`)) continue;
      if (backoff.isBackingOff(`shape:${shapeId}`)) continue;
      const prev = shapeSnaps.get(shapeId)!;
      // If the parent item has also disappeared, the item DELETE cascades on
      // the server side; no need to call /shapes/:id explicitly.
      if (!itemSnaps.has(prev.itemId) && !nextItems.has(prev.itemId)) {
        shapeSnaps.delete(shapeId);
        continue;
      }
      inflightOps.set(`shape:${shapeId}`, 'deleting');
      api.shapes
        .delete(shapeId)
        .then(() => {
          shapeSnaps.delete(shapeId);
          return true;
        })
        .catch((e) => {
          console.error('sync: delete shape failed', shapeId, e);
          return false;
        })
        .then((ok) => settle(`shape:${shapeId}`, ok));
    }
  }, [projectId, items, backoff.tick]);

  // Read from refs at call time (no re-render per request). Callers use it
  // to hold off reviewing/pushing a quote, or switching projects, while
  // local edits haven't reached the server yet.
  const isIdle = useCallback(
    () => inflight.current.size === 0 && !backoff.hasPendingFailures(),
    [backoff]
  );
  return { isIdle };
}

export function primeShapeSyncFromServerState(
  items: TakeoffItem[],
  hook: ReturnType<typeof useShapeSync>
): void {
  // No-op: useShapeSync's snapshots populate on first effect run with whatever
  // items are passed. Kept as a sentinel for future "skip initial sync after
  // hydrating from the server" logic.
  void items;
  void hook;
}
