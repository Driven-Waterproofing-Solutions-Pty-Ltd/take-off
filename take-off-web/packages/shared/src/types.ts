export enum ToolType {
  SELECT = 'SELECT',
  SCALE = 'SCALE',
  DIMENSION = 'DIMENSION',
  SEGMENT = 'SEGMENT',
  LINEAR = 'LINEAR',
  ARC = 'ARC',
  AREA = 'AREA',
  VOLUME = 'VOLUME',
  FILL = 'FILL',
  COUNT = 'COUNT',
  NOTE = 'NOTE',
}

export enum Unit {
  FEET = 'ft',
  INCHES = 'in',
  YARDS = 'yd',
  MILES = 'mi',
  METERS = 'm',
  CENTIMETERS = 'cm',
  MILLIMETERS = 'mm',
  KILOMETERS = 'km',
  SQ_FT = 'sq ft',
  SQ_IN = 'sq in',
  SQ_YD = 'sq yd',
  SQ_MI = 'sq mi',
  ACRES = 'acres',
  SQ_M = 'sq m',
  SQ_CM = 'sq cm',
  SQ_MM = 'sq mm',
  SQ_KM = 'sq km',
  HECTARES = 'hectares',
  CU_FT = 'cu ft',
  CU_IN = 'cu in',
  CU_YD = 'cu yd',
  CU_MI = 'cu mi',
  CU_M = 'cu m',
  CU_CM = 'cu cm',
  CU_MM = 'cu mm',
  CU_KM = 'cu km',
  LITERS = 'L',
  MILLILITERS = 'mL',
  EACH = 'EA',
  BUNDLE = 'BUNDLE',
  HOURS = 'hrs',
  SHEETS = 'Sheets',
  ROLLS = 'Rolls',
  GALLONS = 'Gallons',
  LBS = 'lbs',
  PIECES = 'Pcs',
  BOX = 'Box',
  BUCKET = 'Bucket',
  TON = 'Ton',
}

export interface Point {
  x: number;
  y: number;
}

export interface Shape {
  id: string;
  pageIndex: number;
  points: Point[];
  value: number;
  deduction?: boolean;
  text?: string;
  bulges?: number[];
}

export interface ItemProperty {
  name: string;
  value: number | string;
}

export interface SubItem {
  id: string;
  label: string;
  unit: Unit | string;
  price: number;
  formula: string;
}

export interface TakeoffItem {
  id: string;
  label: string;
  type: ToolType;
  color: string;
  unit: Unit;
  shapes: Shape[];
  totalValue: number;
  group?: string;
  properties?: ItemProperty[];
  price?: number;
  formula?: string;
  subItems?: SubItem[];
  visible?: boolean;
  hiddenPages?: number[];
  depth?: number;
  assemblyId?: string;
}

export interface ItemTemplate {
  id: string;
  label: string;
  type: ToolType;
  color: string;
  unit: Unit;
  properties?: ItemProperty[];
  subItems?: SubItem[];
  price?: number;
  formula?: string;
  group?: string;
  tags?: string[];
  createdAt: number;
}

export interface ScaleCalibration {
  isSet: boolean;
  pixelsPerUnit: number;
  unit: Unit;
}

export interface LegendSettings {
  x: number;
  y: number;
  scale: number;
  visible?: boolean;
}

export interface PageData {
  scale: ScaleCalibration;
  name?: string;
  legend?: LegendSettings;
}

export type ProjectData = Record<number, PageData>;

export interface Customer {
  id: string;
  xeroContactId?: string;
  name: string;
  email?: string;
  phone?: string;
  lastSyncedAt?: number;
}

export interface Material {
  id: string;
  sku?: string;
  name: string;
  unit: Unit | string;
  unitCost: number;
  supplier?: string;
}

export interface AssemblyLine {
  materialId: string;
  qtyPerUnit: number;
  wastePct: number;
  labourMinPerUnit: number;
}

export interface Assembly {
  id: string;
  name: string;
  unit: Unit | string;
  formula?: string;
  tags?: string[];
  lines: AssemblyLine[];
}

export interface PastQuote {
  id: string;
  projectId: string;
  customerId?: string;
  total: number;
  accepted: boolean;
  xeroId?: string;
  createdAt: number;
  snapshot?: unknown;
}

export interface QuoteLineItem {
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  assemblyId?: string;
  itemId?: string;
}

export interface QuoteDraft {
  projectId: string;
  customerId?: string;
  lines: QuoteLineItem[];
  subtotal: number;
  gst: number;
  total: number;
}
