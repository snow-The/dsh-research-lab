// Resolve the harness-only import to the local stand-in so test-absorb.mjs can drive dist/index.js
// without a DSH process. Kept next to the tests, not in ~/.dsh, so the suite is self-contained.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: new URL('./test-shims/dsh-tools.mjs', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
