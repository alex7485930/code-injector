const BLOCKED_PROTOCOLS = new Set(["chrome:", "edge:", "about:", "devtools:"]);
const EXTENSION_PROTOCOLS = new Set([
  "chrome-extension:",
  "moz-extension:",
  "safari-extension:",
  "ms-browser-extension:"
]);

const THEME_KEY = "theme";
const DEFAULT_THEME = "light";
const ACTION_ICONS = {
  light: {
    16: "icons/16px.png",
    48: "icons/48px.png",
    128: "icons/128px.png",
  },
  dark: {
    16: "icons/darkmode/16px.png",
    48: "icons/darkmode/48px.png",
    128: "icons/darkmode/128px.png",
  },
};
const ALERT_ACTION_ICONS = {
  light: {
    16: "icons/alert-48px.png",
    48: "icons/alert-48px.png",
    128: "icons/alert-48px.png",
  },
  dark: {
    16: "icons/darkmode/alert-48px.png",
    48: "icons/darkmode/alert-48px.png",
    128: "icons/darkmode/alert-48px.png",
  },
};

const normalizeTheme = (value) => (value === "dark" ? "dark" : "light");
let currentTheme = DEFAULT_THEME;

const setActionIcon = async (theme) => {
  if (!chrome?.action?.setIcon) return;
  const normalized = normalizeTheme(theme);
  const path = ACTION_ICONS[normalized];
  try {
    await chrome.action.setIcon({ path });
  } catch (error) {
    console.error("[Code Injector] Failed to set action icon:", error);
  }
};

const setTabActionIcon = async (tabId, theme, hasActiveRuleMatch) => {
  if (!chrome?.action?.setIcon || typeof tabId !== "number") return;
  const normalized = normalizeTheme(theme);
  const iconSet = hasActiveRuleMatch ? ALERT_ACTION_ICONS : ACTION_ICONS;
  const path = iconSet[normalized];

  try {
    await chrome.action.setIcon({ tabId, path });
  } catch (error) {
    console.error("[Code Injector] Failed to set tab action icon:", error);
  }
};

const isAllowedPageUrl = (url) => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return !BLOCKED_PROTOCOLS.has(parsed.protocol) && !EXTENSION_PROTOCOLS.has(parsed.protocol);
  } catch (error) {
    return false;
  }
};

const updateIconForTab = async (tab) => {
  if (!tab?.id) return;
  if (!isAllowedPageUrl(tab.url)) {
    await setTabActionIcon(tab.id, currentTheme, false);
    return;
  }

  const rules = await loadRules();
  const hasActiveRuleMatch = rules.some((rule) => urlMatchesRule(tab.url, rule));
  await setTabActionIcon(tab.id, currentTheme, hasActiveRuleMatch);
};

const updateIconForActiveTab = async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs?.[0];
    if (!activeTab) return;
    await updateIconForTab(activeTab);
  } catch (error) {
    console.error("[Code Injector] Failed to update active tab icon:", error);
  }
};

const initActionIcon = async () => {
  try {
    const result = await chrome.storage.local.get(THEME_KEY);
    currentTheme = normalizeTheme(result?.[THEME_KEY] ?? DEFAULT_THEME);
    await setActionIcon(currentTheme);
    await updateIconForActiveTab();
  } catch (error) {
    console.error("[Code Injector] Failed to initialize action icon:", error);
  }
};

// Pattern matching utility (same as in popup.js)
const patternToRegex = (pattern) => {
  if (!pattern) return null;
  const escaped = pattern
    .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
    .replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`, "i");
  } catch (err) {
    return null;
  }
};

// Compile patterns once per rule to avoid re-creating regexes on each tab update
const compileRule = (rule) => ({
  ...rule,
  regexes: (rule.patterns || [])
    .map((pattern) => patternToRegex(pattern.trim()))
    .filter(Boolean),
});

// Cache for rules to avoid reading from storage on every tab update
let rulesCache = [];
let rulesCacheTimestamp = 0;
const CACHE_DURATION = 1000; // 1 second cache

// Track which tabs have been injected to avoid duplicate injections
const injectedTabs = new Set();

// Load rules from storage (with caching)
const loadRules = async () => {
  const now = Date.now();
  if (rulesCacheTimestamp && now - rulesCacheTimestamp < CACHE_DURATION) {
    return rulesCache;
  }
  
  const { rules = [] } = await chrome.storage.local.get({ rules: [] });
  rulesCache = rules.map(compileRule);
  rulesCacheTimestamp = now;
  return rulesCache;
};

// Check if a URL matches any of the rule patterns
const urlMatchesRule = (url, rule) =>
  Boolean(rule.enabled && rule.regexes?.length && rule.regexes.some((regex) => regex.test(url)));

// Inject code for a rule into a tab
const injectRule = async (tabId, rule) => {
  try {
    // Inject JavaScript if present
    if (rule.jsCode && rule.jsCode.trim()) {
      console.log("[Code Injector] Injecting JS code:", rule.jsCode.substring(0, 50) + "...");

      // Run in page context without blob URLs or eval/new Function. Use Trusted
      // Types when available to satisfy strict CSP that requires them.
      const runJsInMain = async () => {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (code) => {
            try {
              const makeScript = () => {
                const script = document.createElement("script");
                script.dataset.codeInjector = "true";
                script.type = "text/javascript";

                if (window.trustedTypes?.createPolicy) {
                  let policy;
                  // Try to get existing policy if getPolicy is available and is a function
                  if (typeof window.trustedTypes.getPolicy === "function") {
                    policy = window.trustedTypes.getPolicy("code-injector");
                  }
                  // Create policy if we don't have one yet
                  if (!policy) {
                    try {
                      policy = window.trustedTypes.createPolicy("code-injector", {
                        createScript: (input) => input,
                      });
                    } catch (e) {
                      // Policy might already exist, try to get it again if getPolicy is available
                      if (typeof window.trustedTypes.getPolicy === "function") {
                        policy = window.trustedTypes.getPolicy("code-injector");
                      }
                    }
                  }
                  // Use policy if we have one, otherwise fall back to direct assignment
                  if (policy) {
                    script.text = policy.createScript(code);
                  } else {
                    script.text = code;
                  }
                } else {
                  script.text = code;
                }

                return script;
              };

              const script = makeScript();
              (document.documentElement || document.head || document.body).appendChild(script);
              script.remove();
            } catch (error) {
              console.error("Code Injector: Error executing JS in MAIN world (script tag):", error);
              throw error;
            }
          },
          args: [rule.jsCode],
        });
      };

      // Fallback: run inside the isolated world (not subject to page CSP); still can touch the DOM.
      const runJsIsolated = async () => {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (code) => {
            try {
              const run = new Function(code);
              run();
            } catch (error) {
              console.error("Code Injector: Error executing JS in isolated world:", error);
            }
          },
          args: [rule.jsCode],
        });
      };

      try {
        await runJsInMain();
        console.log("[Code Injector] JS injected successfully (MAIN world, script tag)");
      } catch (mainWorldError) {
        console.log("[Code Injector] MAIN world injection blocked, falling back to isolated world", mainWorldError);
        await runJsIsolated();
        console.log("[Code Injector] JS injected successfully (isolated world)");
      }
    }
    
    // Inject CSS if present
    if (rule.cssCode && rule.cssCode.trim()) {
      console.log("[Code Injector] Injecting CSS code");
      await chrome.scripting.insertCSS({
        target: { tabId },
        css: rule.cssCode,
      });
      console.log("[Code Injector] CSS injected successfully");
    }
  } catch (error) {
    console.error("[Code Injector] Failed to inject code:", error);
  }
};

// Handle tab updates - inject code when a page loads
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only proceed when the page is fully loaded
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }
  
  console.log("[Code Injector] Tab completed:", tab.url);
  
  // Create a unique key for this tab+url combination
  const tabKey = `${tabId}:${tab.url}`;
  
  // Skip if we've already injected for this tab+url
  if (injectedTabs.has(tabKey)) {
    console.log("[Code Injector] Already injected for this tab+url");
    return;
  }
  
  // Skip blocked protocols
  if (!isAllowedPageUrl(tab.url)) {
    console.log("[Code Injector] Unsupported URL for injection");
    await updateIconForTab(tab);
    return;
  }
  
  // Load rules from cache/storage
  const rules = await loadRules();
  console.log("[Code Injector] Loaded rules:", rules.length);
  
  // Find matching rules
  const matchingRules = rules.filter((rule) => urlMatchesRule(tab.url, rule));
  console.log("[Code Injector] Matching rules:", matchingRules.length, matchingRules.map(r => r.name));
  await setTabActionIcon(tabId, currentTheme, matchingRules.length > 0);
  
  if (matchingRules.length === 0) {
    return;
  }
  
  // Mark this tab as injected
  injectedTabs.add(tabKey);
  
  // Inject code for each matching rule
  for (const rule of matchingRules) {
    console.log("[Code Injector] Injecting rule:", rule.name);
    await injectRule(tabId, rule);
  }
});

// Clear injected tabs when navigation starts (to allow re-injection on new pages)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    // Remove all entries for this tab (since URL might be changing)
    const keysToRemove = [];
    for (const key of injectedTabs) {
      if (key.startsWith(`${tabId}:`)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => injectedTabs.delete(key));

    // Reset icon while the next page is loading.
    setTabActionIcon(tabId, currentTheme, false);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateIconForTab(tab);
  } catch (error) {
    console.error("[Code Injector] Failed to update icon on tab activation:", error);
  }
});

// Reload rules cache when storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.rules) {
    const nextRules = changes.rules.newValue || [];
    rulesCache = nextRules.map(compileRule);
    rulesCacheTimestamp = Date.now();
    updateIconForActiveTab();
  }

  if (changes.theme) {
    currentTheme = normalizeTheme(changes.theme.newValue ?? DEFAULT_THEME);
    setActionIcon(currentTheme);
    updateIconForActiveTab();
  }
});

// Initialize rules cache on startup
loadRules();
initActionIcon();

// Keep toolbar icon in sync with startup events
chrome.runtime.onInstalled.addListener(initActionIcon);
chrome.runtime.onStartup.addListener(initActionIcon);
