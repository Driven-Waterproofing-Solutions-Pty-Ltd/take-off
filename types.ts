
export enum ToolType {
  SELECT = 'SELECT',
  SCALE = 'SCALE',
  DIMENSION = 'DIMENSION', // 2 points with annotations
  SEGMENT = 'SEGMENT', // 2 points
  LINEAR = 'LINEAR', // Polyline
  AREA = 'AREA', // Polygon
  COUNT = 'COUNT', // Points
  NOTE = 'NOTE', // Text annotation
}

export enum Unit {
  // Linear Imperial
  FEET = 'ft',
  INCHES = 'in',
  YARDS = 'yd',
  MILES = 'mi',

  // Linear Metric
  METERS = 'm',
  CENTIMETERS = 'cm',
  MILLIMETERS = 'mm',
  KILOMETERS = 'km',

  // Area Imperial
  SQ_FT = 'sq ft',
  SQ_IN = 'sq in',
  SQ_YD = 'sq yd',
  ACRES = 'acres',

  // Area Metric
  SQ_M = 'sq m',
  SQ_CM = 'sq cm',
  SQ_MM = 'sq mm',
  HECTARES = 'hectares',

  // Volume Imperial
  CU_FT = 'cu ft',
  CU_IN = 'cu in',
  CU_YD = 'cu yd',

  // Volume Metric
  CU_M = 'cu m',
  CU_CM = 'cu cm',
  CU_MM = 'cu mm',
  LITERS = 'L',
  MILLILITERS = 'mL',

  // Count
  EACH = 'EA',
  BUNDLE = 'BUNDLE',

  // Time
  HOURS = 'hrs',

  // Generic Materials (for sub-items)
  SHEETS = 'Sheets',
  ROLLS = 'Rolls',
  GALLONS = 'Gallons',
  LBS = 'lbs',
  PIECES = 'Pcs',
  BOX = 'Box',
  BUCKET = 'Bucket',
  TON = 'Ton'
}

export interface Point {
  x: number;
  y: number;
}

// A single piece of geometry (e.g., one line, one polygon)
export interface Shape {
  id: string;
  pageIndex: number; // The global page index this shape belongs to
  points: Point[];
  value: number; // Length, Area, or Count (1 or N)
  deduction?: boolean; // If true, this shape is subtracted from the total
  text?: string; // For NOTE items
}

export interface ItemProperty {
  name: string;
  value: number;
}

export interface SubItem {
  id: string;
  label: string;
  unit: Unit | string; // Can be a standard Unit or string for flexibility
  price: number;
  formula: string; // e.g. "(Qty * Height) / 32"
}

// A Group of shapes (e.g., "Interior Walls")
export interface TakeoffItem {
  id: string;
  // pageIndex removed - items are now global across the project
  label: string;
  type: ToolType;
  color: string;
  unit: Unit;
  // scaleFactor removed - values are calculated per shape based on page scale at creation
  shapes: Shape[];
  totalValue: number; // Aggregated value across all pages (RAW QUANTITY in Scale Unit)

  // Advanced Properties
  group?: string; // Grouping category (e.g. "Division 1", "Exterior")
  properties?: ItemProperty[]; // e.g. [{name: "Waste", value: 10}]
  price?: number; // Unit Price
  formula?: string; // e.g. "Qty * 1.1"
  subItems?: SubItem[]; // Material breakdowns
  visible?: boolean; // Controls visibility on canvas
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

// Represents a single PDF file upload
export interface PlanSet {
  id: string;
  file: File;
  name: string; // User defined name (e.g. "Plumbing Set")
  pageCount: number;
  startPageIndex: number; // Global index where this set starts
  pages?: number[]; // Mapping of local index to original PDF page index (0-based)
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
  name?: string; // Custom page name
  legend?: LegendSettings; // Position/Scale of the legend for this page
}

export type ProjectData = Record<number, PageData>; // Key is global page index

// File System Access API Interfaces
export type PermissionState = 'granted' | 'denied' | 'prompt';

export interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
  queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: any): Promise<FileSystemWritableFileStream>;
}

export interface FileSystemWritableFileStream extends WritableStream {
  write(data: any): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
}

export interface LicenseResponse {
  valid: boolean;
  message: string;
  token?: string;
  expires_at?: string;
  license_type?: 'trial' | 'paid';
}
