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
  shapeIds: Set<string>;
}

interface ShapeSnapshot {
  itemId: string;
  pageIndex: number;
  pointsHash: string;
  value: number;
  deduction: boolean;
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
        // New item — POST it.
        inflight.current.set(`item:${itemId}`, 'creating');
        const snap = snapshotItem(item);
        itemSnapshots.current.set(itemId, snap);
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
            assembly_id: item.assemblyId, // P1 fix: preserve assembly link
          })
          .catch((e) => {
            // If create fails, drop the snapshot so the next pass retries.
            itemSnapshots.current.delete(itemId);
            console.error('sync: create item failed', itemId, e);
          })
          .finally(() => {
            inflight.current.delete(`item:${itemId}`);
            retry(); // wake the effect so child shapes deferred for this item run
          });
      } else if (itemChanged(prev, snapshotItem(item))) {
        // Mutated item — PUT it.
        inflight.current.set(`item:${itemId}`, 'updating');
        const newSnap = snapshotItem(item);
        itemSnapshots.current.set(itemId, newSnap);
        api.items
          .update(itemId, pickItemPatch(item))
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
      itemSnapshots.current.delete(itemId);
      api.items
        .delete(itemId)
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
        shapeSnapshots.current.set(shapeId, nextSnap);
        const promise =
          item.type === ToolType.AREA || item.type === ToolType.FILL
            ? api.shapes.area({
                project_id: projectId,
                page_index: shape.pageIndex,
                points: shape.points,
                item_id: item.id,
                shape_id: shape.id,
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
                  snap: false,
                })
              : item.type === ToolType.COUNT
                ? api.shapes.count({
                    project_id: projectId,
                    page_index: shape.pageIndex,
                    points: shape.points,
                    item_id: item.id,
                    shape_id: shape.id,
                  })
                : item.type === ToolType.ARC && shape.points.length >= 2 && shape.bulges?.length
                  ? api.shapes.arc({
                      project_id: projectId,
                      page_index: shape.pageIndex,
                      start: shape.points[0],
                      end: shape.points[1],
                      bulge: shape.bulges[0],
                      item_id: item.id,
                      shape_id: shape.id,
                    })
                  : Promise.resolve(null);
        promise
          .catch((e) => {
            // Drop the snapshot so the next pass retries. A failed create
            // here is usually a transient "scale isn't synced yet" race —
            // useScaleSync POSTs the calibration in parallel; the retry()
            // below wakes the effect once any inflight op completes, by
            // which point the scale POST may have landed.
            shapeSnapshots.current.delete(shapeId);
            console.error('sync: create shape failed', shapeId, e);
          })
          .finally(() => {
            inflight.current.delete(`shape:${shapeId}`);
            retry();
          });
      } else if (
        prev.pointsHash !== nextSnap.pointsHash ||
        prev.deduction !== nextSnap.deduction
      ) {
        inflight.current.set(`shape:${shapeId}`, 'updating');
        shapeSnapshots.current.set(shapeId, nextSnap);
        api.shapes
          .update(shapeId, { points: shape.points, deduction: shape.deduction })
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
      shapeSnapshots.current.delete(shapeId);
      api.shapes
        .delete(shapeId)
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
