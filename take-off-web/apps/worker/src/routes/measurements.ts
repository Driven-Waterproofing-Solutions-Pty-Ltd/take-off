import { Hono } from 'hono';
import type { Env } from '../env';
import { tools } from '@takeoff/shared';
import { setScalePreset, setScaleManual } from '../tools/scale';
import { addArea, addLinear, addCount, addArc } from '../tools/measure';
import { snapToVector } from '../tools/snap';
import { listItems } from '../tools/memory';
import { upsertPage } from '../db/queries';

const app = new Hono<{ Bindings: Env }>();

app.post('/scale/preset', async (c) => {
  const body = await c.req.json();
  const input = tools.set_scale_preset.input.parse(body);
  return c.json(await setScalePreset(c.env, input));
});

app.post('/scale/manual', async (c) => {
  const body = await c.req.json();
  const input = tools.set_scale_manual.input.parse(body);
  return c.json(await setScaleManual(c.env, input));
});

app.post('/shapes/area', async (c) => {
  const body = await c.req.json();
  const input = tools.add_area.input.parse(body);
  return c.json(await addArea(c.env, input));
});

app.post('/shapes/linear', async (c) => {
  const body = await c.req.json();
  const input = tools.add_linear.input.parse(body);
  return c.json(await addLinear(c.env, input));
});

app.post('/shapes/count', async (c) => {
  const body = await c.req.json();
  const input = tools.add_count.input.parse(body);
  return c.json(await addCount(c.env, input));
});

app.post('/shapes/arc', async (c) => {
  const body = await c.req.json();
  const input = tools.add_arc.input.parse(body);
  return c.json(await addArc(c.env, input));
});

app.post('/snap', async (c) => {
  const body = await c.req.json();
  const input = tools.snap_to_vector.input.parse(body);
  return c.json(await snapToVector(c.env, input));
});

app.get('/items/:projectId', async (c) => {
  return c.json(await listItems(c.env, c.req.param('projectId')));
});

// Client uploads its extracted PDF vector cache for a page (for snap)
app.put('/pages/:projectId/:pageIndex/vector-cache', async (c) => {
  const projectId = c.req.param('projectId');
  const pageIndex = parseInt(c.req.param('pageIndex'), 10);
  const cache = await c.req.json();
  await upsertPage(c.env.DB, projectId, pageIndex, { vectorCache: cache });
  return c.json({ ok: true });
});

export default app;
