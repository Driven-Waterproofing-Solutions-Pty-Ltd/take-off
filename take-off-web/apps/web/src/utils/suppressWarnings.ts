
/**
 * Suppresses specific console warnings that can cause performance issues.
 * specific to PDF.js 'Optional content group not found' spam.
 */
export function suppressConsoleWarnings() {
    const originalWarn = console.warn;

    console.warn = (...args) => {
        if (args.length > 0 && typeof args[0] === 'string') {
            const msg = args[0];
            // Filter out PDF.js missing optional content group warnings
            if (msg.includes('Optional content group not found')) {
                return;
            }
        }
        originalWarn.apply(console, args);
    };
}
