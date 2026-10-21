export { Backend, backendSession, cleanupSchema } from "./backend.js";
export { handleProvider } from "./provider.js";
export { prepareBrowserConfig } from "./config.js";
export { prepareBotBrowserConfig, browserNamespace } from "./config.js";
export type { BrowserResetSnapshot } from "./factory-reset.js";

export type { ExtensionRef, ExtensionRecord, ExtensionConfiguration } from "./extensions.js";
export type { VaultConnection } from "./vault.js";
