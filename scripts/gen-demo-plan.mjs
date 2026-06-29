// Generates public/demo-plan.pdf — a multi-page, blueprint-like PDF (building
// outline, rooms, grid, dimension lines, labels, title block) so the Android demo
// has a realistic "plan" to render/zoom/navigate instead of a sparse docs PDF.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';

const W = 1190, H = 842; // A3 landscape (pt)
const ink = rgb(0.1, 0.12, 0.16);
const grey = rgb(0.78, 0.81, 0.85);
const blue = rgb(0.16, 0.39, 0.78);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const SHEETS = [
  { name: 'GROUND FLOOR', rooms: [['LOUNGE', 60, 380, 360, 360], ['KITCHEN', 430, 470, 300, 270], ['BATH', 430, 380, 300, 80], ['BED 1', 740, 470, 360, 270], ['ENTRY', 740, 380, 360, 80], ['GARAGE', 60, 120, 360, 250]] },
  { name: 'FIRST FLOOR', rooms: [['BED 2', 60, 430, 330, 310], ['BED 3', 400, 430, 330, 310], ['ENSUITE', 740, 560, 360, 180], ['RUMPUS', 740, 360, 360, 190], ['HALL', 400, 360, 330, 60], ['STAIR', 60, 200, 330, 220]] },
  { name: 'ROOF PLAN', rooms: [['RIDGE', 120, 200, 950, 480]] },
  { name: 'SITE PLAN', rooms: [['DWELLING', 300, 280, 560, 380], ['DRIVEWAY', 120, 120, 160, 540], ['YARD', 880, 280, 200, 380]] },
  { name: 'ELEVATIONS', rooms: [['NORTH', 80, 480, 480, 240], ['SOUTH', 620, 480, 480, 240], ['EAST', 80, 160, 480, 240], ['WEST', 620, 160, 480, 240]] },
];

const line = (p, x1, y1, x2, y2, c = ink, t = 1) => p.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: c });
const dim = (p, x1, y, x2, label) => { // horizontal dimension line with ticks + label
  line(p, x1, y, x2, y, blue, 0.8);
  line(p, x1, y - 5, x1, y + 5, blue, 0.8); line(p, x2, y - 5, x2, y + 5, blue, 0.8);
  p.drawText(label, { x: (x1 + x2) / 2 - 14, y: y + 4, size: 9, font, color: blue });
};

SHEETS.forEach((sheet, i) => {
  const p = doc.addPage([W, H]);
  // grid
  for (let x = 40; x < W - 40; x += 40) line(p, x, 60, x, H - 60, grey, 0.4);
  for (let y = 60; y < H - 60; y += 40) line(p, 40, y, W - 40, y, grey, 0.4);
  // building outline
  p.drawRectangle({ x: 50, y: 100, width: W - 100, height: H - 200, borderColor: ink, borderWidth: 3 });
  // rooms
  sheet.rooms.forEach(([label, x, y, w, h]) => {
    p.drawRectangle({ x, y, width: w, height: h, borderColor: ink, borderWidth: 2 });
    p.drawText(label, { x: x + 10, y: y + h - 22, size: 13, font: bold, color: ink });
    p.drawText(`${(w * h / 1000).toFixed(1)} m2`, { x: x + 10, y: y + h - 40, size: 9, font, color: rgb(0.4, 0.43, 0.48) });
  });
  // dimension lines along the top and a door swing arc-ish marker
  dim(p, 60, H - 80, W - 60, `${((W - 120) / 40).toFixed(1)} m`);
  dim(p, 60, 80, (W - 120) / 2 + 60, `${(((W - 120) / 2) / 40).toFixed(1)} m`);
  // title block
  p.drawRectangle({ x: W - 330, y: 30, width: 300, height: 60, borderColor: ink, borderWidth: 1.5 });
  p.drawText('DRIVEN — DEMO PROJECT', { x: W - 320, y: 66, size: 11, font: bold, color: ink });
  p.drawText(`${sheet.name}   |   SHEET A-${(i + 1).toString().padStart(2, '0')} of ${SHEETS.length}`, { x: W - 320, y: 48, size: 9, font, color: ink });
  p.drawText('SCALE 1:100 @ A3   NOT FOR CONSTRUCTION', { x: W - 320, y: 36, size: 7, font, color: rgb(0.5, 0.5, 0.55) });
});

const bytes = await doc.save();
fs.writeFileSync('public/demo-plan.pdf', bytes);
console.log('wrote public/demo-plan.pdf', bytes.length, 'bytes,', SHEETS.length, 'pages');
