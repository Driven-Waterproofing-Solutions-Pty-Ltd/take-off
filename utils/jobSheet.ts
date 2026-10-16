import { TakeoffItem, ToolType, Unit } from '../types';
import { evaluateFormulaChecked, convertValue, toVariableName } from './math';

/**
 * Pure helpers behind the Job Sheet & Xero view: line-item pricing, GST maths,
 * local dates and the Xero CSV export. Kept free of React so the money logic
 * can be reasoned about (and exercised) on its own.
 */

export interface ComputedLineItem {
    group: string;
    label: string;
    type: string;
    qty: number;
    unit: string;
    unitPrice: number;
    /** Line amount ex GST in dollars, rounded to the cent. */
    total: number;
    /** Sub-item rows are a breakdown of their parent row and are never billed. */
    isSubItem?: boolean;
    /** The formula produced a non-finite quantity or amount (e.g. Qty / 0). */
    invalid?: boolean;
}

export interface JobSheetTotals {
    subtotalCents: number;
    gstCents: number;
    totalCents: number;
}

/** Australian GST on income, used whenever no Xero tax rate has been chosen. */
export const DEFAULT_GST_PERCENT = 10;
/** Name of Xero's standard Australian sales tax rate (API code `OUTPUT`). */
export const DEFAULT_XERO_TAX_RATE_NAME = 'GST on Income';
export const DEFAULT_XERO_TAX_TYPE = 'OUTPUT';

/** Rounds half away from zero (-0.5 → -1), like currency rounding, unlike Math.round. */
function roundHalfAwayFromZero(value: number): number {
    return Math.sign(value) * Math.round(Math.abs(value));
}

/** Dollars to whole cents, clearing binary float noise first (1.005 → 101, -1.005 → -101). */
export function toCents(amount: number): number {
    if (!Number.isFinite(amount)) return 0;
    return roundHalfAwayFromZero(Number((amount * 100).toPrecision(15)));
}

export function centsToDollars(cents: number): number {
    return cents / 100;
}

/**
 * Turns takeoff items into job sheet rows, using the same pricing rule as the
 * Estimates view: an item with its own unit price is billed at qty × price and
 * its sub-items are only a breakdown; an item without a price is billed at the
 * sum of its sub-items. Sub-item rows follow their parent for display only.
 */
export function computeLineItems(items: TakeoffItem[]): ComputedLineItem[] {
    const rows: ComputedLineItem[] = [];

    items
        .filter((i) => i.type !== ToolType.NOTE)
        .forEach((item) => {
            const group = item.group || 'General';
            const convertedQty = convertValue(item.totalValue, Unit.FEET, item.unit, item.type);
            const main = evaluateFormulaChecked(item, convertedQty);
            // A non-number result (e.g. a boolean) is invalid; use 0 so the row still renders.
            const calculated = typeof main.value === 'number' ? main.value : 0;

            const subContext: Record<string, number> = {};
            let subTotal = 0;
            const subRows: ComputedLineItem[] = [];

            (item.subItems ?? []).forEach((sub) => {
                const subEval = evaluateFormulaChecked(item, convertedQty, sub.formula, subContext);
                const subQty = typeof subEval.value === 'number' ? subEval.value : 0;
                const varName = toVariableName(sub.label);
                if (varName) subContext[varName] = subQty;
                const subPrice = sub.price || 0;
                const lineTotal = subQty * subPrice;
                subTotal += lineTotal;
                subRows.push({
                    group,
                    label: `  ↳ ${sub.label}`,
                    type: 'Sub-Item',
                    qty: subQty,
                    unit: String(sub.unit),
                    unitPrice: subPrice,
                    total: centsToDollars(toCents(lineTotal)),
                    isSubItem: true,
                    invalid: !subEval.ok || !Number.isFinite(subQty) || !Number.isFinite(lineTotal),
                });
            });

            const itemPrice = item.price || 0;
            const usesSubItemPricing = itemPrice === 0 && subTotal > 0;
            const totalCost = usesSubItemPricing ? subTotal : calculated * itemPrice;
            const unitPrice = usesSubItemPricing
                ? (calculated > 0 ? subTotal / calculated : 0)
                : itemPrice;

            rows.push({
                group,
                label: item.label,
                type: item.type,
                qty: calculated,
                unit: String(item.unit),
                unitPrice,
                total: centsToDollars(toCents(totalCost)),
                // A broken sub-item formula makes its parent unbillable too.
                invalid: !main.ok || !Number.isFinite(calculated) || !Number.isFinite(totalCost) || subRows.some((r) => r.invalid),
            });
            rows.push(...subRows);
        });

    return rows;
}

/** Billable rows whose formula gave a non-finite result; nothing may be sent while any exist. */
export function invalidLines(rows: ComputedLineItem[]): ComputedLineItem[] {
    return billableLines(rows).filter((r) => r.invalid);
}

/** The rows that are actually charged (sub-item breakdown rows excluded). */
export function billableLines(rows: ComputedLineItem[]): ComputedLineItem[] {
    return rows.filter((r) => !r.isSubItem);
}

export function sumLineCents(rows: ComputedLineItem[]): number {
    return billableLines(rows).reduce((sum, r) => sum + toCents(r.total), 0);
}

/**
 * Subtotal, GST and total in cents. GST is worked out and rounded per line,
 * then summed, which is how Xero calculates tax on a tax-exclusive invoice, so
 * the printed job sheet agrees with the draft invoice to the cent.
 */
export function computeTotals(rows: ComputedLineItem[], gstPercent: number = DEFAULT_GST_PERCENT): JobSheetTotals {
    let subtotalCents = 0;
    let gstCents = 0;
    billableLines(rows).forEach((r) => {
        const lineCents = toCents(r.total);
        subtotalCents += lineCents;
        gstCents += roundHalfAwayFromZero(Number(((lineCents * gstPercent) / 100).toPrecision(15)));
    });
    return { subtotalCents, gstCents, totalCents: subtotalCents + gstCents };
}

// ── Dates ─────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD for the given moment in the user's local timezone. */
export function toLocalIsoDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
}

/** DD/MM/YYYY, the date format Xero's invoice import expects for an Australian organisation. */
export function toXeroCsvDate(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** Formats a YYYY-MM-DD string as an en-AU date without shifting it through UTC. */
export function formatIsoDate(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return '';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.toLocaleDateString('en-AU');
}

// ── Xero CSV export ───────────────────────────────────────────────────────────

export interface XeroCsvOptions {
    rows: ComputedLineItem[];
    contactName: string;
    address: string;
    invoiceNumber: string;
    reference: string;
    invoiceDate: string;
    dueDate: string;
    accountCode: string;
    taxRateName: string;
    currency: string;
}

/** Every column of Xero's sales invoice import template, in template order. */
export const XERO_CSV_HEADERS = [
    '*ContactName', 'EmailAddress',
    'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4',
    'POCity', 'PORegion', 'POPostalCode', 'POCountry',
    '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', 'Total',
    'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount', 'Discount',
    '*AccountCode', '*TaxType', 'TaxAmount',
    'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2',
    'Currency', 'BrandingTheme',
] as const;

type XeroCsvColumn = (typeof XERO_CSV_HEADERS)[number];

/** Description used for a billable row on the Xero invoice (API and CSV alike). */
export function xeroLineDescription(row: ComputedLineItem): string {
    return `${row.group}: ${row.label} (${row.qty.toFixed(2)} ${row.unit})`;
}

function csvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Builds a Xero sales-invoice import CSV with the full template header. Every
 * row shares one invoice number so Xero imports a single invoice, and each line
 * is quantity 1 at the line total, exactly like the API path, so both match the
 * job sheet. Total and TaxAmount are left blank so Xero calculates GST from
 * the tax rate rather than checking against a figure written here.
 */
export function buildXeroCsv(opts: XeroCsvOptions): string {
    const lines = billableLines(opts.rows);

    const body = lines.map((row) => {
        const cells: Partial<Record<XeroCsvColumn, string>> = {
            '*ContactName': opts.contactName,
            POAddressLine1: opts.address,
            '*InvoiceNumber': opts.invoiceNumber,
            Reference: opts.reference,
            '*InvoiceDate': toXeroCsvDate(opts.invoiceDate),
            '*DueDate': toXeroCsvDate(opts.dueDate),
            // Total is left blank: Xero works it out (lines plus tax) on import.
            '*Description': xeroLineDescription(row),
            '*Quantity': '1',
            '*UnitAmount': (toCents(row.total) / 100).toFixed(2),
            '*AccountCode': opts.accountCode,
            '*TaxType': opts.taxRateName,
            Currency: opts.currency,
        };
        return XERO_CSV_HEADERS.map((h) => cells[h] ?? '');
    });

    return [
        XERO_CSV_HEADERS.join(','),
        ...body.map((r) => r.map(csvCell).join(',')),
    ].join('\n');
}
