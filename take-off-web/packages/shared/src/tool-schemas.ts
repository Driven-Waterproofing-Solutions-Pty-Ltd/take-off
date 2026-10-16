import { z } from 'zod';
import { Unit } from './types';

export const PointZ = z.object({ x: z.number(), y: z.number() });

export const UnitZ = z.nativeEnum(Unit);

// Page scale is pixels per LINEAR distance — area, volume, time, or
// count-style units are meaningless here. Restricting this keeps a stray
// "sq ft" or "hrs" out of pages.scale_json (which would cascade into wrong
// area/volume unit derivation and mislabelled measurements).
export const LinearUnitZ = z.enum([
  Unit.FEET,
  Unit.INCHES,
  Unit.YARDS,
  Unit.MILES,
  Unit.METERS,
  Unit.CENTIMETERS,
  Unit.MILLIMETERS,
  Unit.KILOMETERS,
]);

export const ScaleCalibrationZ = z.object({
  isSet: z.boolean(),
  pixelsPerUnit: z.number(),
  unit: z.string(),
});

export const ShapeZ = z.object({
  id: z.string(),
  pageIndex: z.number().int().min(0),
  points: z.array(PointZ),
  value: z.number(),
  deduction: z.boolean().optional(),
  text: z.string().optional(),
  bulges: z.array(z.number()).optional(),
});

export const ItemPropertyZ = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string()]),
});

export const SubItemZ = z.object({
  id: z.string(),
  label: z.string(),
  unit: z.string(),
  price: z.number(),
  formula: z.string(),
});

export const TakeoffItemZ = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  color: z.string(),
  unit: z.string(),
  shapes: z.array(ShapeZ),
  totalValue: z.number(),
  group: z.string().optional(),
  properties: z.array(ItemPropertyZ).optional(),
  price: z.number().optional(),
  formula: z.string().optional(),
  subItems: z.array(SubItemZ).optional(),
  visible: z.boolean().optional(),
  hiddenPages: z.array(z.number()).optional(),
  depth: z.number().optional(),
  assemblyId: z.string().optional(),
});

export const QuoteLineItemZ = z.object({
  description: z.string(),
  qty: z.number(),
  unit: z.string(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  assemblyId: z.string().optional(),
  itemId: z.string().optional(),
});

export const QuoteDraftZ = z.object({
  projectId: z.string(),
  customerId: z.string().optional(),
  lines: z.array(QuoteLineItemZ),
  subtotal: z.number(),
  gst: z.number(),
  total: z.number(),
  fingerprint: z.string().optional(),
});

const ViewportZ = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const tools = {
  load_pdf: {
    description: 'Register an uploaded PDF against a project. Returns page count and per-page sizes.',
    input: z.object({
      project_id: z.string(),
      file_key: z.string().describe('R2 object key returned from /api/upload-url'),
      name: z.string().optional(),
    }),
    output: z.object({
      pdf_id: z.string(),
      page_count: z.number().int(),
      page_sizes: z.array(z.object({ width: z.number(), height: z.number() })),
    }),
  },
  get_page_image: {
    description:
      'Render a PDF page (or viewport region) to PNG. Returns the image plus the offset and factor that map image pixels back to PDF points. It does not describe vector geometry: use snap_to_vector to lock proposed points onto the PDF linework.',
    input: z.object({
      project_id: z.string(),
      page_index: z.number().int().min(0),
      viewport: ViewportZ.optional().describe(
        'Optional crop region in PDF points (origin top-left of the page). The result text gives the offset + factor to map image pixels back to PDF points.'
      ),
      dpi: z
        .number()
        .int()
        .min(72)
        .max(300)
        .optional()
        .default(150)
        .describe('Render resolution; 72 dpi = 1 image pixel per PDF point. Very large sheets may be capped.'),
    }),
    output: z.object({
      png_base64: z.string(),
      // Render notes plus the image-pixel → PDF-point mapping.
      coordinate_mapping: z.string(),
    }),
  },
  set_scale_preset: {
    description: 'Apply a named preset scale (e.g. "1:100", "1/4\\" = 1\'0\\"") to a page.',
    input: z.object({
      project_id: z.string(),
      page_index: z.number().int().min(0),
      preset_label: z.string(),
    }),
    output: ScaleCalibrationZ,
  },
  set_scale_manual: {
    description:
      'Calibrate page scale by giving two points and the real-world distance between them in a chosen unit.',
    input: z.object({
      project_id: z.string(),
      page_index: z.number().int().min(0),
      p1: PointZ,
      p2: PointZ,
      real_distance: z.number().positive(),
      unit: LinearUnitZ,
    }),
    output: ScaleCalibrationZ,
  },
  add_area: {
    description: 'Add an AREA shape (polygon). Returns the saved shape with scaled value in current page unit.',
    input: z.object({
      project_id: z.string(),
      page_index: z.number().int().min(0),
      points: z.array(PointZ).min(3),
      item_id: z.string().optional(),
      shape_id: z.string().optional(),
      name: z.string().optional(),
      color: z.string().optional(),
      deduction: z.boolean().optional(),
      snap: z.boolean().optional().default(true),
    }),
    output: ShapeZ,
  },
  add_linear: {
    description: 'Add a LINEAR (polyline) measurement.',
    input: z.object({
      project_id: z.string(),
      page_index: z.number().int().min(0),
      points: z.array(PointZ).min(2),
      item_id: z.string().optional(),
      shape_id: z.string().optional(),
      name: z.string().optional(),
      color: z.string().optional(),
      deduction: z.boolean().optional(),
      snap: z.boolean().optional().default(true),
    }),
    output: ShapeZ,
  },
  add_count: {
    description: 'Add a COUNT marker (each point = one item).',
    input: z.object({
      project_id: z.string(),
      page_index: z.number().int().min(0),
      points: z.array(PointZ).min(1),
      item_id: z.string().optional(),
      shape_id: z.string().optional(),
      name: z.string().optional(),
      color: z.string().optional(),
      deduction: z.boolean().optional(),
    }),
    output: ShapeZ,
  },
  add_arc: {
    description:
      'Add a single circular ARC segment between two points. `bulge` is HALF the arc\'s included angle in radians (not the DXF tan(θ/4) bulge factor).',
    input: z.object({
      project_id: z.string(),
      page_index: z.number().int().min(0),
      start: PointZ,
      end: PointZ,
      // calculateArcLength (shared by the worker, the canvas and stored D1
      // rows) uses radius = chord / (2·sin|bulge|), length = radius · 2|bulge|.
      // Spell that out so MCP/agent callers don't pass a DXF bulge factor
      // (tan(θ/4)) and get an under-counted length.
      bulge: z
        .number()
        .describe(
          'Half of the included angle in radians; sign = side of the chord. 0 = straight line, π/4 ≈ 0.7854 = quarter circle, π/2 ≈ 1.5708 = semicircle. NOT the DXF tan(θ/4) bulge factor.'
        ),
      item_id: z.string().optional(),
      shape_id: z.string().optional(),
      name: z.string().optional(),
      color: z.string().optional(),
      deduction: z.boolean().optional(),
    }),
    output: ShapeZ,
  },
  snap_to_vector: {
    description: 'Snap proposed points to nearest PDF vector vertices/intersections within tolerance.',
    input: z.object({
      project_id: z.string(),
      page_index: z.number().int().min(0),
      points: z.array(PointZ),
      tolerance_px: z.number().positive().optional().default(8),
    }),
    output: z.object({ snapped: z.array(PointZ) }),
  },
  list_items: {
    description: 'List all takeoff items (with shapes) for a project.',
    input: z.object({ project_id: z.string() }),
    output: z.array(TakeoffItemZ),
  },
  search_projects: {
    description: 'Full-text search across past projects/quotes.',
    input: z.object({ query: z.string(), limit: z.number().int().optional().default(10) }),
    output: z.array(
      z.object({
        project_id: z.string(),
        name: z.string(),
        customer_name: z.string().optional(),
        total: z.number().optional(),
        created_at: z.number(),
        snippet: z.string().optional(),
      })
    ),
  },
  recall_customer: {
    description: 'Fuzzy-match a customer by name/email/phone from the synced Xero contacts.',
    input: z.object({ query: z.string() }),
    output: z.array(
      z.object({
        id: z.string(),
        xeroContactId: z.string().optional(),
        name: z.string(),
        email: z.string().optional(),
        phone: z.string().optional(),
      })
    ),
  },
  list_assemblies: {
    description: 'List material/labour assemblies, optionally filtered by tag.',
    input: z.object({ tag: z.string().optional() }),
    output: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        unit: z.string(),
        tags: z.array(z.string()).optional(),
      })
    ),
  },
  get_takeoff_knowledge: {
    description:
      "Fetch curated takeoff knowledge chunks from D1. Use this BEFORE measuring any plan — it returns the methodology rules (never fabricate a measurement; measure off figured dimensions; counting rule for fillets/junctions), the rate cards per builder, the product system (GCP Silcor + SAS PU25 fillet, +10% wastage), worked-example bands, the Pavilion Studio LE template (sheet 13/14 = wet area details), FFE schedule conventions (matte-black tile-insert wastes on LE jobs per Eliza Grace Interiors selections), and prior takeoff records. Filter by topic ('methodology' | 'counting-rule' | 'product-system' | 'plan-retrieval' | 'rate-cards-current' | 'rate-cards-legacy' | 'rate-cards-proposed' | 'labour-rates' | 'worked-examples' | 'pavilion-template' | 'ffe-schedule' | 'waste-finish' | 'takeoff-record') or by builder ('leading-edge'). Omit both filters for the full index.",
    input: z.object({
      topic: z.string().optional(),
      builder: z.string().optional(),
    }),
    output: z.array(
      z.object({
        id: z.string(),
        topic: z.string(),
        title: z.string(),
        body_md: z.string(),
        builder: z.string().nullable(),
      })
    ),
  },
  apply_assembly: {
    description: 'Attach an assembly to an item; line items flow into the quote.',
    input: z.object({
      project_id: z.string(),
      item_id: z.string(),
      assembly_id: z.string(),
    }),
    output: TakeoffItemZ,
  },
  build_quote: {
    description:
      'Compute the current quote draft for a project. Pure calculation — does not push to Xero.',
    input: z.object({ project_id: z.string() }),
    output: QuoteDraftZ,
  },
  push_to_xero: {
    description:
      'Push the current project quote to Xero as a DRAFT Quote or DRAFT Invoice. Never AUTHORISED or SUBMITTED. Requires explicit user confirmation upstream.',
    input: z.object({
      project_id: z.string(),
      kind: z.enum(['QUOTE', 'INVOICE']),
      customer_xero_id: z.string(),
      reference: z.string().optional(),
      quote_fingerprint: z
        .string()
        .optional()
        .describe(
          'The `fingerprint` from the build_quote result the user reviewed. When given, the push is refused if the quote has changed since.'
        ),
    }),
    output: z.object({
      xero_id: z.string(),
      deep_link: z.string().url(),
    }),
  },
  pull_xero_invoice: {
    description:
      'Fetch a past Xero invoice with its full line items (description, qty, unit price, account code, tracking). Use it to reverse-engineer real assemblies / pricing from prior work, or to look up how a similar job was previously quoted. Read-only. Pass invoice_id (Xero UUID) OR invoice_number (e.g. "INV-1814").',
    input: z.object({
      invoice_id: z.string().optional(),
      invoice_number: z.string().optional(),
    }),
    output: z.object({
      invoice_id: z.string(),
      invoice_number: z.string(),
      status: z.string(),
      contact_name: z.string().nullable(),
      contact_xero_id: z.string().nullable(),
      date: z.string().nullable(),
      due_date: z.string().nullable(),
      total: z.number(),
      subtotal: z.number(),
      total_tax: z.number(),
      currency: z.string(),
      reference: z.string().nullable(),
      line_items: z.array(
        z.object({
          description: z.string().nullable(),
          quantity: z.number().nullable(),
          unit_amount: z.number().nullable(),
          line_amount: z.number().nullable(),
          account_code: z.string().nullable(),
          tax_type: z.string().nullable(),
          item_code: z.string().nullable(),
          tracking: z.array(z.object({ name: z.string(), option: z.string() })),
        })
      ),
      deep_link: z.string().url(),
    }),
  },
} as const;

export type ToolName = keyof typeof tools;
export type ToolInput<N extends ToolName> = z.infer<(typeof tools)[N]['input']>;
export type ToolOutput<N extends ToolName> = z.infer<(typeof tools)[N]['output']>;
