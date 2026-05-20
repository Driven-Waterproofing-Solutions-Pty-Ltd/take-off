
import { TakeoffItem, Unit, ToolType } from "../types";
import { create, all } from 'mathjs';

/**
 * Converts a human-readable label into a valid variable name.
 * e.g., "Wall Height" -> "Wall_Height"
 * e.g., "5/8 Sheetrock" -> "_5_8_Sheetrock"
 */
export const toVariableName = (label: string): string => {
  if (!label) return '';
  // Replace non-alphanumeric with underscores
  let safe = label.trim().replace(/[^a-zA-Z0-9]/g, '_');
  // Ensure it doesn't start with a number
  if (/^[0-9]/.test(safe)) {
    safe = '_' + safe;
  }
  return safe;
};

/**
 * Checks if a string is a valid JavaScript identifier.
 */
export const isValidIdentifier = (name: string): boolean => {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
};

/**
 * Replaces known labels in a formula string with their variable equivalents.
 * e.g. "Wall Height * 2" -> "Wall_Height * 2"
 */
export const replaceLabelsWithVars = (formula: string, variables: { label: string, value: string }[]): string => {
  if (!formula) return '';
  let processed = formula;

  // Sort variables by length (longest first) to avoid partial matches
  // e.g. match "Wall Height" before "Height"
  const sortedVars = [...variables].sort((a, b) => b.label.length - a.label.length);

  sortedVars.forEach(v => {
    // Escape special regex characters in the label
    const escapedLabel = v.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Replace whole words/phrases only
    const regex = new RegExp(`\\b${escapedLabel}\\b`, 'gi');
    processed = processed.replace(regex, v.value);
  });

  return processed;
};

/**
 * Renames a variable in a formula.
 * Used when a referenced item (e.g. sub-item) is renamed.
 */
export const renameVariable = (formula: string, oldLabel: string, newLabel: string): string => {
  if (!formula) return '';

  const oldVar = toVariableName(oldLabel);
  const newVar = toVariableName(newLabel);

  if (!oldVar || !newVar || oldVar === newVar) return formula;

  // Replace whole word matches only
  const regex = new RegExp(`\\b${oldVar}\\b`, 'g');
  return formula.replace(regex, newVar);
};

/**
 * Sanitizes a formula string to fix common syntax errors.
 * - Removes all spaces for compact formatting.
 * - Balances parentheses.
 */
export const sanitizeFormula = (formula: string): string => {
  if (!formula) return 'Qty';

  // 1. Remove all spaces as requested by user ("without spacing")
  let cleaned = formula.replace(/\s+/g, '');

  // Balance Parentheses
  let openCount = 0;
  let closeCount = 0;
  for (const char of cleaned) {
    if (char === '(') openCount++;
    if (char === ')') closeCount++;
  }

  // If too many closing, remove from end
  while (closeCount > openCount) {
    const lastIndex = cleaned.lastIndexOf(')');
    if (lastIndex !== -1) {
      cleaned = cleaned.substring(0, lastIndex) + cleaned.substring(lastIndex + 1);
      closeCount--;
    } else {
      break;
    }
  }

  // If too many opening, append to end
  while (openCount > closeCount) {
    cleaned += ')';
    openCount--;
    closeCount++;
  }

  return cleaned;
};

/**
 * Converts a value from one unit to another.
 * UPDATE: Per user request, this now returns the value AS IS.
 * The Unit selection is treated as a label only, no mathematical conversion is performed automatically.
 */
export const convertValue = (value: number, fromUnit: Unit, toUnit: Unit, type: ToolType): number => {
  return value;
};

const math = create(all);
const limitedEvaluate = math.evaluate;

math.import({
  'import': function () { throw new Error('Function import is disabled') },
  'createUnit': function () { throw new Error('Function createUnit is disabled') },
  'evaluate': function () { throw new Error('Function evaluate is disabled') },
  'parse': function () { throw new Error('Function parse is disabled') },
  'simplify': function () { throw new Error('Function simplify is disabled') },
  'derivative': function () { throw new Error('Function derivative is disabled') }
}, { override: true });

/**
 * Safely evaluates a math formula.
 * @param item The takeoff item containing properties and formula.
 * @param overrideQty Optional. If provided, uses this value for 'Qty' instead of item.totalValue.
 * @param formulaOverride Optional. If provided, evaluates this formula instead of the item's default formula.
 * @param extraVariables Optional. Additional variables to inject into the context (e.g. calculated sub-items).
 */
export const evaluateFormula = (
  item: TakeoffItem,
  overrideQty?: number,
  formulaOverride?: string,
  extraVariables?: Record<string, number>
): number => {
  const qty = overrideQty !== undefined ? overrideQty : item.totalValue;
  const formulaToUse = formulaOverride !== undefined ? formulaOverride : item.formula;

  if (!formulaToUse || !formulaToUse.trim()) {
    return qty;
  }

  // Create a map of variables
  const scope: Record<string, number> = {
    'Qty': qty,
    'QTY': qty,
    'qty': qty,
    ...extraVariables // Merge in calculated sub-items or other context
  };

  if (item.properties) {
    item.properties.forEach(prop => {
      // Access by raw name (if safe) and sanitized name
      const val = Number(prop.value);
      if (!isNaN(val)) {
        scope[prop.name] = val;
        const safeName = toVariableName(prop.name);
        if (safeName !== prop.name) {
          scope[safeName] = val;
        }
      }
    });
  }

  // Add Price to variables
  if (item.price !== undefined) {
    scope['Price'] = item.price;
    scope['PRICE'] = item.price;
    scope['price'] = item.price;
  }

  try {
    const result = limitedEvaluate(formulaToUse, scope);

    if (isNaN(result) || result === undefined || result === null) {
      return 0;
    }

    return result;
  } catch (e) {
    // If formula fails, return 0 (safe fallback for sub-items) or Qty (safe fallback for main items if no override)
    return formulaOverride ? 0 : qty;
  }
};
