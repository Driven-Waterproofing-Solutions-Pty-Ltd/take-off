// Generates public/demo-plan.pdf — a multi-page, PORTRAIT blueprint-like PDF
// (building outline, rooms in a grid, dimension lines, labels, title block) so the
// Android demo has a realistic "plan" that fills a phone screen when fit-to-width.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';

const W = 842, H = 1190; // A3 PORTRAIT (pt) — taller than wide, fills a phone screen
const ink = rgb(0.1, 0.12, 0.16);
const grey = rgb(0.78, 0.81, 0.85);
const blue = rgb(0.16, 0.39, 0.78);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const SHEETS = [
  { name: 'GROUND FLOOR', rooms: ['LOUNGE', 'KITCHEN', 'DINING', 'BED 1', 'BATH', 'GARAGE'] },
  { name: 'FIRST FLOOR', rooms: ['BED 2', 'BED 3', 'ENSUITE', 'RUMPUS', 'STUDY', 'HALL'] },
  { name: 'SITE PLAN', rooms: ['DWELLING', 'DRIVEWAY', 'DECK', 'LAWN', 'SHED', 'PATH'] },
  { name: 'ELEVATIONS', rooms: ['NORTH', 'SOUTH', 'EAST', 'WEST'] },
];

const line = (p, x1, y1, x2, y2, c = ink, t = 1) => p.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: c });
const dim = (p, x1, y, x2, label) => {
  line(p, x1, y, x2, y, blue, 0.8);
  line(p, x1, y - 6, x1, y + 6, blue, 0.8); line(p, x2, y - 6, x2, y + 6, blue, 0.8);
  p.drawText(label, { x: (x1 + x2) / 2 - 16, y: y + 5, size: 10, font, color: blue });
};

SHEETS.forEach((sheet, i) => {
  const p = doc.addPage([W, H]);
  // grid
  for (let x = 40; x < W - 40; x += 45) line(p, x, 70, x, H - 110, grey, 0.4);
  for (let y = 70; y < H - 110; y += 45) line(p, 40, y, W - 40, y, grey, 0.4);
  // building outline
  const ox = 60, oy = 130, ow = W - 120, oh = H - 250;
  p.drawRectangle({ x: ox, y: oy, width: ow, height: oh, borderColor: ink, borderWidth: 3 });
  // rooms in a 2-column grid filling the outline
  const cols = 2, rows = Math.ceil(sheet.rooms.length / cols), gap = 16;
  const cw = (ow - gap * (cols + 1)) / cols, ch = (oh - gap * (rows + 1)) / rows;
  sheet.rooms.forEach((label, idx) => {
    const c = idx % cols, r = Math.floor(idx / cols);
    const x = ox + gap + c * (cw + gap);
    const y = oy + oh - gap - (r + 1) * ch - r * gap;
    p.drawRectangle({ x, y, width: cw, height: ch, borderColor: ink, borderWidth: 2 });
    // doorway gap + door-swing tick for blueprint feel
    line(p, x + cw * 0.4, y, x + cw * 0.6, y, rgb(1, 1, 1), 3);
    line(p, x + cw * 0.4, y, x + cw * 0.4, y + ch * 0.18, ink, 1);
    p.drawText(label, { x: x + 14, y: y + ch - 26, size: 15, font: bold, color: ink });
    p.drawText(`${(cw * ch / 1000).toFixed(1)} m2`, { x: x + 14, y: y + ch - 46, size: 10, font, color: rgb(0.4, 0.43, 0.48) });
  });
  // dimension lines (overall width + height)
  dim(p, ox, oy - 26, ox + ow, `${(ow / 45).toFixed(1)} m`);
  p.drawText(`${(oh / 45).toFixed(1)} m`, { x: ox - 50, y: oy + oh / 2, size: 10, font, color: blue, rotate: { type: 'degrees', angle: 90 } });
  // title block (bottom)
  p.drawRectangle({ x: ox, y: 40, width: ow, height: 70, borderColor: ink, borderWidth: 1.5 });
  p.drawText('DRIVEN — DEMO RESIDENCE', { x: ox + 16, y: 82, size: 14, font: bold, color: ink });
  p.drawText(`${sheet.name}    SHEET A-${(i + 1).toString().padStart(2, '0')} of ${SHEETS.length}`, { x: ox + 16, y: 62, size: 11, font, color: ink });
  p.drawText('SCALE 1:100 @ A3    NOT FOR CONSTRUCTION', { x: ox + 16, y: 47, size: 8, font, color: rgb(0.5, 0.5, 0.55) });
});

const bytes = await doc.save();
fs.writeFileSync('public/demo-plan.pdf', bytes);
console.log('wrote public/demo-plan.pdf', bytes.length, 'bytes,', SHEETS.length, 'pages (portrait)');
