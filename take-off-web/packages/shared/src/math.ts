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
math.import(
  {
    import: function () {
      throw new Error('Function import is disabled');
    },
    createUnit: function () {
      throw new Error('Function createUnit is disabled');
    },
    evaluate: function () {
      throw new Error('Function evaluate is disabled');
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
const limitedEvaluate = math.evaluate;

export const evaluateFormula = (
  item: TakeoffItem,
  overrideQty?: number,
  formulaOverride?: string,
  extraVariables?: Record<string, number>
): number => {
  const qty = overrideQty !== undefined ? overrideQty : item.totalValue;
  const formulaToUse = formulaOverride !== undefined ? formulaOverride : item.formula;
  if (!formulaToUse || !formulaToUse.trim()) return qty;

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

  try {
    const result = limitedEvaluate(formulaToUse, scope);
    if (isNaN(result) || result === undefined || result === null) return 0;
    return result;
  } catch {
    return formulaOverride ? 0 : qty;
  }
};
