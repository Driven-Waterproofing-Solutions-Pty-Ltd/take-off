import { TakeoffItem, Unit, ToolType } from './types';
import { create, all } from 'mathjs';

export const toVariableName = (label: string): string => {
  if (!label) return '';
  let safe = label.trim().replace(/[^a-zA-Z0-9]/g, '_');
  if (/^[0-9]/.test(safe)) safe = '_' + safe;
  return safe;
};

export const isValidIdentifier = (name: string): boolean => {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
};

export const replaceLabelsWithVars = (
  formula: string,
  variables: { label: string; value: string }[]
): string => {
  if (!formula) return '';
  let processed = formula;
  const sortedVars = [...variables].sort((a, b) => b.label.length - a.label.length);
  sortedVars.forEach((v) => {
    const escapedLabel = v.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedLabel}\\b`, 'gi');
    processed = processed.replace(regex, v.value);
  });
  return processed;
};

export const renameVariable = (formula: string, oldLabel: string, newLabel: string): string => {
  if (!formula) return '';
  const oldVar = toVariableName(oldLabel);
  const newVar = toVariableName(newLabel);
  if (!oldVar || !newVar || oldVar === newVar) return formula;
  const regex = new RegExp(`\\b${oldVar}\\b`, 'g');
  return formula.replace(regex, newVar);
};

export const sanitizeFormula = (formula: string): string => {
  if (!formula) return 'Qty';
  let cleaned = formula.replace(/\s+/g, '');
  let openCount = 0;
  let closeCount = 0;
  for (const char of cleaned) {
    if (char === '(') openCount++;
    if (char === ')') closeCount++;
  }
  while (closeCount > openCount) {
    const lastIndex = cleaned.lastIndexOf(')');
    if (lastIndex !== -1) {
      cleaned = cleaned.substring(0, lastIndex) + cleaned.substring(lastIndex + 1);
      closeCount--;
    } else break;
  }
  while (openCount > closeCount) {
    cleaned += ')';
    openCount--;
    closeCount++;
  }
  return cleaned;
};

export const convertValue = (value: number, _from: Unit, _to: Unit, _type: ToolType): number => value;

const math = create(all);
// Capture the real evaluate BEFORE we disable the global one,
// so formula evaluation still works while user-controlled formulas
// can't escape into import/createUnit/parse/simplify/derivative.
const limitedEvaluate = math.evaluate;
math.import(
  {
    import: function () {
      throw new Error('Function import is disabled');
    },
    createUnit: function () {
      throw new Error('Function createUnit is disabled');
    },
    parse: function () {
      throw new Error('Function parse is disabled');
    },
    simplify: function () {
      throw new Error('Function simplify is disabled');
    },
    derivative: function () {
      throw new Error('Function derivative is disabled');
    },
  },
  { override: true }
);

/**
 * Outcome of evaluating a formula: `ok` with a finite quantity, or why it
 * could not produce one — `error` (parse error, unknown variable, disabled
 * function) or `non-finite` (Infinity/NaN, or a non-number such as a matrix).
 * An empty formula is `ok` with the plain quantity.
 */
export type FormulaEvaluation =
  | { ok: true; value: number }
  | { ok: false; reason: 'error' | 'non-finite' };

export const tryEvaluateFormula = (
  item: TakeoffItem,
  overrideQty?: number,
  formulaOverride?: string,
  extraVariables?: Record<string, number>
): FormulaEvaluation => {
  const qty = overrideQty !== undefined ? overrideQty : item.totalValue;
  const formulaToUse = formulaOverride !== undefined ? formulaOverride : item.formula;
  if (!formulaToUse || !formulaToUse.trim()) return { ok: true, value: qty };

  const scope: Record<string, number> = {
    Qty: qty,
    QTY: qty,
    qty,
    ...extraVariables,
  };

  if (item.properties) {
    item.properties.forEach((prop) => {
      const val = Number(prop.value);
      if (!isNaN(val)) {
        scope[prop.name] = val;
        const safeName = toVariableName(prop.name);
        if (safeName !== prop.name) scope[safeName] = val;
      }
    });
  }

  if (item.price !== undefined) {
    scope.Price = item.price;
    scope.PRICE = item.price;
    scope.price = item.price;
  }

  // Qty is reserved: a custom property or sub-item labelled "Qty" must not
  // replace the measured quantity every formula prices from.
  scope.Qty = qty;
  scope.QTY = qty;
  scope.qty = qty;

  try {
    const result: unknown = limitedEvaluate(formulaToUse, scope);
    // Only finite numbers are quantities. `Qty / 0` evaluates to Infinity,
    // which slipped past isNaN and reached buildQuote / Xero as qty, line
    // total and GST — serialised to JSON as null. Matrices, units, strings
    // etc. are not quantities either.
    if (typeof result !== 'number' || !Number.isFinite(result)) return { ok: false, reason: 'non-finite' };
    return { ok: true, value: result };
  } catch {
    return { ok: false, reason: 'error' };
  }
};

// Lenient form used for display and item/sub-item pricing: a non-finite
// result counts as 0, and a formula that fails to evaluate falls back to the
// plain quantity (or 0 for an explicit override formula).
export const evaluateFormula = (
  item: TakeoffItem,
  overrideQty?: number,
  formulaOverride?: string,
  extraVariables?: Record<string, number>
): number => {
  const result = tryEvaluateFormula(item, overrideQty, formulaOverride, extraVariables);
  if (result.ok === true) return result.value;
  if (result.reason === 'non-finite') return 0;
  const qty = overrideQty !== undefined ? overrideQty : item.totalValue;
  return formulaOverride ? 0 : qty;
};
