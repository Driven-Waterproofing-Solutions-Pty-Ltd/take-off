# Analysis of Formula Evaluation Bug

## Problem
User reports that formula `Qty*(Thickness_in_Inch/12)/27*(Slope__/100+1)` is not evaluating correctly; instead it shows only the total of Qty.

## Root Cause
The `evaluateFormula` function in `utils/math.ts` uses `new Function(...argNames, 'return ' + formula)` where `argNames` are the keys of a variables map. This map includes both raw property names (e.g., "Thickness in Inch") and sanitized names (e.g., "Thickness_in_Inch"). Raw property names containing spaces or special characters are **invalid JavaScript identifiers**, causing a syntax error when the function is constructed. The error is caught and the function falls back to returning the raw Qty.

## Additional Issues
1. `replaceLabelsWithVars` may not replace labels correctly if the formula already uses sanitized names (which is fine).
2. `sanitizeFormula` removes spaces, which could break variable names that contain spaces (but they should have been replaced earlier).
3. The variable mapping includes duplicate entries (raw and sanitized) which is unnecessary.

## Proposed Fix
Modify `evaluateFormula` to only include valid JavaScript identifiers as argument names. This can be done by filtering `Object.keys(variables)` using a regex `^[a-zA-Z_$][a-zA-Z0-9_$]*$`. Alternatively, we can simply **not add raw property names** to the variables map, only adding the sanitized names.

### Option 1: Filter invalid identifiers
In the `try` block, before constructing `argNames`, filter out keys that are not valid identifiers.

### Option 2: Only add sanitized names
Change the property iteration to:
```typescript
if (item.properties) {
    item.properties.forEach(prop => {
        const safeName = toVariableName(prop.name);
        variables[safeName] = prop.value;
    });
}
```
This ensures all variable keys are valid identifiers. However, this would break formulas that reference the raw property name (with spaces). Since `replaceLabelsWithVars` should have already converted raw labels to sanitized names, and `sanitizeFormula` removes spaces, it's safe to assume that raw names are not needed.

We also need to update `replaceLabelsWithVars` to ensure it replaces raw labels with sanitized names (it already does). However, note that `variableSuggestions` in `PropertiesModal` uses `toVariableName(p.name)` as the `value`. That's correct.

## Testing
We should test the fix with a sample item:
- Properties: `{ name: "Thickness in Inch", value: 4 }`, `{ name: "Slope %", value: 5 }`
- Formula: `Qty*(Thickness_in_Inch/12)/27*(Slope__/100+1)`
- Qty: 100 (for example)

Expected result: `100*(4/12)/27*(5/100+1) ≈ 100*0.3333/27*1.05 ≈ 1.296`. We can verify.

## Implementation Steps
1. Switch to Code mode.
2. Edit `utils/math.ts` lines 137-145 to only add sanitized names (or filter invalid identifiers).
3. Ensure no regression by checking other usages (sub-items, price, etc.).
4. Test the fix manually in the application.

## Recommendation
Proceed with Option 2 (only sanitized names) as it's simpler and aligns with the variable naming convention used elsewhere.

Let me know if you'd like to implement this fix.