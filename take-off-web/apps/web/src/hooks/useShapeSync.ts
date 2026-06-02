import { useEffect, useRef, useState } from 'react';
import type { TakeoffItem, Shape } from '../types';
import { ToolType } from '../types';
import { api } from '../lib/api';

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

export function useShapeSync(projectId: string | null, items: TakeoffItem[]): void {
  const itemSnapshots = useRef<Map<string, ItemSnapshot>>(new Map());
  const shapeSnapshots = useRef<Map<string, ShapeSnapshot>>(new Map());
  const inflight = useRef<Map<string, SyncOp>>(new Map());
  const lastProjectId = useRef<string | null>(null);

  // Refs can't trigger a re-render on their own — bumping this tick on every
  // completed in-flight op forces the effect to run again so:
  //  (a) shapes deferred while their parent item was creating get processed,
  //  (b) work that failed on a transient prerequisite (e.g. shape POST
  //      arriving before the scale POST) gets retried instead of getting
  //      stuck in local state until something else nudges items.
  const [tick, setTick] = useState(0);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!projectId) return;

    // Project switched (or initial load): the items array represents the
    // server's current truth, so prime snapshots without sending any writes.
    if (projectId !== lastProjectId.current) {
      itemSnapshots.current = new Map();
      shapeSnapshots.current = new Map();
      inflight.current = new Map();
      for (const item of items) {
        itemSnapshots.current.set(item.id, snapshotItem(item));
        for (const shape of item.shapes) {
          shapeSnapshots.current.set(shape.id, snapshotShape(item, shape));
        }
      }
      lastProjectId.current = projectId;
      return;
    }

    // Build the next-state maps so we can diff against the previous snapshot.
    const nextItems = new Map<string, TakeoffItem>();
    const nextShapes = new Map<string, { item: TakeoffItem; shape: Shape }>();
    for (const item of items) {
      nextItems.set(item.id, item);
      for (const shape of item.shapes) nextShapes.set(shape.id, { item, shape });
    }

    // --- ITEMS: create / update / delete ----------------------------------

    for (const [itemId, item] of nextItems) {
      if (inflight.current.has(`item:${itemId}`)) continue;
      const prev = itemSnapshots.current.get(itemId);
      if (!prev) {
        // New item — POST it. Snapshot is set ONLY on success so a transient
        // failure leaves no "marked synced" state and the next diff retries.
        inflight.current.set(`item:${itemId}`, 'creating');
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
          .then(() => itemSnapshots.current.set(itemId, snap))
          .catch((e) => console.error('sync: create item failed', itemId, e))
          .finally(() => {
            inflight.current.delete(`item:${itemId}`);
            retry(); // wake the effect so child shapes deferred for this item run
          });
      } else if (itemChanged(prev, snapshotItem(item))) {
        // Mutated item — PUT it. Same snapshot-on-success rule.
        inflight.current.set(`item:${itemId}`, 'updating');
        const newSnap = snapshotItem(item);
        api.items
          .update(itemId, pickItemPatch(item))
          .then(() => itemSnapshots.current.set(itemId, newSnap))
          .catch((e) => console.error('sync: update item failed', itemId, e))
          .finally(() => {
            inflight.current.delete(`item:${itemId}`);
            retry();
          });
      }
    }

    for (const itemId of [...itemSnapshots.current.keys()]) {
      if (nextItems.has(itemId)) continue;
      if (inflight.current.has(`item:${itemId}`)) continue;
      inflight.current.set(`item:${itemId}`, 'deleting');
      api.items
        .delete(itemId)
        .then(() => itemSnapshots.current.delete(itemId))
        .catch((e) => console.error('sync: delete item failed', itemId, e))
        .finally(() => {
          inflight.current.delete(`item:${itemId}`);
          retry();
        });
    }

    // --- SHAPES: create / update / delete --------------------------------

    for (const [shapeId, { item, shape }] of nextShapes) {
      if (inflight.current.has(`shape:${shapeId}`)) continue;
      const prev = shapeSnapshots.current.get(shapeId);
      const nextSnap = snapshotShape(item, shape);

      if (!prev) {
        // Skip if the item hasn't been created server-side yet — the next
        // tick (after the item POST resolves) will pick this shape up.
        if (inflight.current.has(`item:${item.id}`)) continue;

        inflight.current.set(`shape:${shapeId}`, 'creating');
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
          .then(() => shapeSnapshots.current.set(shapeId, nextSnap))
          .catch((e) => console.error('sync: create shape failed', shapeId, e))
          .finally(() => {
            inflight.current.delete(`shape:${shapeId}`);
            retry();
          });
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
        inflight.current.set(`shape:${shapeId}`, 'updating');
        api.shapes
          .update(shapeId, {
            points: shape.points,
            deduction: shape.deduction,
            value: shape.value,
            text: shape.text,
            item_id: prev.itemId !== nextSnap.itemId ? nextSnap.itemId : undefined,
          })
          .then(() => shapeSnapshots.current.set(shapeId, nextSnap))
          .catch((e) => console.error('sync: update shape failed', shapeId, e))
          .finally(() => {
            inflight.current.delete(`shape:${shapeId}`);
            retry();
          });
      }
    }

    for (const shapeId of [...shapeSnapshots.current.keys()]) {
      if (nextShapes.has(shapeId)) continue;
      if (inflight.current.has(`shape:${shapeId}`)) continue;
      const prev = shapeSnapshots.current.get(shapeId)!;
      // If the parent item has also disappeared, the item DELETE cascades on
      // the server side; no need to call /shapes/:id explicitly.
      if (!itemSnapshots.current.has(prev.itemId) && !nextItems.has(prev.itemId)) {
        shapeSnapshots.current.delete(shapeId);
        continue;
      }
      inflight.current.set(`shape:${shapeId}`, 'deleting');
      api.shapes
        .delete(shapeId)
        .then(() => shapeSnapshots.current.delete(shapeId))
        .catch((e) => console.error('sync: delete shape failed', shapeId, e))
        .finally(() => {
          inflight.current.delete(`shape:${shapeId}`);
          retry();
        });
    }
  }, [projectId, items, tick]);
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
