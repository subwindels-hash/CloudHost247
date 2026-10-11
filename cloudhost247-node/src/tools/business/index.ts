/**
 * Business Tools — public surface.
 *
 * Import from here. The engines are pure and free of Node and DOM APIs, so the same module is
 * bundled into the SPA (where every calculation happens in the visitor's browser tab) and compiled
 * into the server build (where `/api/tools/business/*` runs the identical code). That is the point:
 * one implementation, two runtimes, no drift between what the page shows and what the API returns.
 */

export * from './types';
export * from './format';
export * from './validate';
export * from './calculators';
export * from './generators';
export * from './generators-assets';
export * from './comparisons';
export {
  BUSINESS_TOOLS,
  BUSINESS_TOOLS_ROOT,
  BUSINESS_TOOLS_TOTAL,
  BUSINESS_TOOL_COUNTS,
  businessToolsByCategory,
  defaultInputFor,
  findBusinessTool,
  searchBusinessTools,
} from './registry';
