
import { TakeoffItem, Unit, ToolType } from "../types";

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
  const variables: Record<string, number> = {
    'Qty': qty,
    'QTY': qty,
    'qty': qty,
    ...extraVariables // Merge in calculated sub-items or other context
  };

  if (item.properties) {
    item.properties.forEach(prop => {
      // Access by raw name (if safe) and sanitized name
      variables[prop.name] = prop.value;
      const safeName = toVariableName(prop.name);
      if (safeName !== prop.name) {
        variables[safeName] = prop.value;
      }
    });
  }

  // Add Price to variables
  if (item.price !== undefined) {
    variables['Price'] = item.price;
    variables['PRICE'] = item.price;
    variables['price'] = item.price;
  }

  try {
    // Add custom function aliases
    const customFunctions = {
      roundup: Math.ceil,
      round: Math.round,
      floor: Math.floor,
      abs: Math.abs,
      min: Math.min,
      max: Math.max,
      sqrt: Math.sqrt,
      pow: Math.pow
    };

    const argNames = [...Object.keys(customFunctions), ...Object.keys(variables)];
    const argValues = [...Object.values(customFunctions), ...Object.values(variables)];

    // Filter out invalid JavaScript identifiers (e.g., property names with spaces)
    const filteredArgNames: string[] = [];
    const filteredArgValues: any[] = [];
    for (let i = 0; i < argNames.length; i++) {
      if (isValidIdentifier(argNames[i])) {
        filteredArgNames.push(argNames[i]);
        filteredArgValues.push(argValues[i]);
      }
    }

    // Safety check for empty formula after variable replacement
    if (!formulaToUse) return 0;

    const func = new Function(...filteredArgNames, `return ${formulaToUse};`);
    const result = func(...filteredArgValues);

    if (isNaN(result) || result === undefined || result === null) {
      return 0;
    }

    return result;
  } catch (e) {
    // If formula fails, return 0 (safe fallback for sub-items) or Qty (safe fallback for main items if no override)
    return formulaOverride ? 0 : qty;
  }
};
