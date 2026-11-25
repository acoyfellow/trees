// Public surface of the library-neutral IAP host core.
export { validate, loadCatalog, checkTree, type Catalog } from "./core/validate";
export { load, researchKey, type LoadOptions, type LoadResult, type SourceResult, type ToolCall } from "./core/load";
export { resolveTree, resolveForItem, evalCondition, type ResolvedTree } from "./core/resolve";
export { aliasKey, compatible, resolveIntent, deriveRequirements, invokeIntent, type Intent, type Materializer } from "./core/intents";
export { applyChange, type Change } from "./core/change";
export { applyDefaults } from "./core/defaults";
