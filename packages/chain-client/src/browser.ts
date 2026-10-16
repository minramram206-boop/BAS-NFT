/**
 * Everything in this package that is safe to bundle for a browser: types,
 * protocol constants, score maths, account decoders and instruction builders
 * for the district, the market and the prize vault.
 * It never imports `@bas/config` (which reads files) or a Node built-in;
 * `test/browser.test.ts` fails if it starts to.
 */
export * from './types.js';
export * from './constants.js';
export * from './errors.js';
export * from './stats.js';
export * from './accounts.js';
export * from './instructions.js';
export * from './market.js';
export * from './prizeVault.js';
