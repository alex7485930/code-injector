import { initTheme } from "./theme.js";

initTheme();

const statusEl = document.getElementById("status");
const rulesListEl = document.getElementById("rulesList");
const ruleTemplate = document.getElementById("ruleRow");
const urlPreviewEl = document.getElementById("urlPreview");
const openOptionsBtn = document.getElementById("openOptions");
const addNewRuleBtn = document.getElementById("addNewRule");

const BLOCKED_PROTOCOLS = new Set(["chrome:", "edge:", "about:", "devtools:"]);
const EXTENSION_PROTOCOLS = new Set(["chrome-extension:", "moz-extension:", "safari-extension:", "ms-browser-extension:"]);

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

const compileRule = (rule) => ({
  ...rule,
  regexes: (rule.patterns || [])
    .map((pattern) => patternToRegex(pattern.trim()))
    .filter(Boolean),
});

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

const validUrl = (url) => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return !BLOCKED_PROTOCOLS.has(parsed.protocol);
  } catch (err) {
    return false;
  }
};

const isExtensionPage = (url) => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return EXTENSION_PROTOCOLS.has(parsed.protocol);
  } catch (err) {
    return false;
  }
};

const describeStatus = (text) => {
  statusEl.textContent = text;
  statusEl.hidden = false;
};

const hideStatus = () => {
  statusEl.hidden = true;
};

const openRuleInOptions = (ruleId) => {
  const url = chrome.runtime.getURL(`rules.html#rule=${encodeURIComponent(ruleId)}`);
  chrome.tabs.create({ url });
  window.close();
};

const getToggleTitle = (enabled) => (enabled ? "Turn rule OFF" : "Turn rule ON");
const setToggleTitle = (input) => {
  const title = getToggleTitle(input.checked);
  input.title = title;
  const switchEl = input.closest(".switch");
  if (switchEl) {
    switchEl.title = title;
  }
};

const attachToggleHandler = (input, ruleId) => {
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", async () => {
    input.disabled = true;
    try {
      const { rules = [] } = await chrome.storage.local.get({ rules: [] });
      const next = rules.map((rule) =>
        rule.id === ruleId ? { ...rule, enabled: input.checked } : rule
      );
      await chrome.storage.local.set({ rules: next });
      setToggleTitle(input);
    } finally {
      input.disabled = false;
    }
  });
};

const renderRules = (rules, matched) => {
  rulesListEl.innerHTML = "";
  if (!validUrl(matched.url)) {
    describeStatus("Cannot add a rule on this page.");
    return;
  }

  if (!matched.rules.length) {
    describeStatus("No rules match this URL.");
    return;
  }

  hideStatus();
  matched.rules.forEach((rule) => {
    const node = ruleTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = rule.id;
    const ruleName = rule.name || "(Untitled rule)";
    const nameEl = node.querySelector(".rule-name");
    nameEl.textContent = ruleName;
    nameEl.title = ruleName;
    const toggle = node.querySelector(".rule-toggle");
    toggle.checked = Boolean(rule.enabled);
    setToggleTitle(toggle);
    attachToggleHandler(toggle, rule.id);
    node.addEventListener("click", (event) => {
      if (event.target.closest(".switch")) {
        return;
      }
      openRuleInOptions(rule.id);
    });
    rulesListEl.appendChild(node);
  });
};

const findMatches = (rules, url) => {
  return rules.filter(
    (rule) => rule.regexes?.length && rule.regexes.some((regex) => regex.test(url))
  );
};

const init = async () => {
  openOptionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  addNewRuleBtn.addEventListener("click", async () => {
    const tab = await getActiveTab();
    
    // Prevent creating rules on extension pages
    if (tab?.url && isExtensionPage(tab.url)) {
      describeStatus("Cannot create rules on extension pages.");
      return;
    }
    
    const url = chrome.runtime.getURL("create.html");
    const createUrl = tab?.url && validUrl(tab.url) 
      ? `${url}?url=${encodeURIComponent(tab.url)}`
      : url;
    chrome.tabs.create({ url: createUrl });
    window.close();
  });

  const tab = await getActiveTab();
  if (!tab?.url) {
    describeStatus("Unable to read the current tab URL.");
    addNewRuleBtn.disabled = true;
    return;
  }

  // Disable "Add new rule" button on extension pages
  if (isExtensionPage(tab.url)) {
    describeStatus("Cannot create rules on extension pages.");
    addNewRuleBtn.disabled = true;
    urlPreviewEl.textContent = tab.url;
    return;
  }

  urlPreviewEl.textContent = tab.url;
  addNewRuleBtn.disabled = false;

  const { rules = [] } = await chrome.storage.local.get({ rules: [] });
  const compiledRules = rules.map(compileRule);
  renderRules(rules, { url: tab.url, rules: findMatches(compiledRules, tab.url) });
};

document.addEventListener("DOMContentLoaded", init);

