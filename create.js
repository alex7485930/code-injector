import { initTheme } from "./theme.js";
import { enhanceCodeEditor, formatCode } from "./editor-utils.js";

initTheme();

const form = document.getElementById("ruleForm");
const jsEditor = document.getElementById("ruleJs");
const cssEditor = document.getElementById("ruleCss");

const extractDomainPattern = (urlString) => {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname;
    
    // Extract root domain (e.g., "www.example.com" -> "example.com")
    // This is a simple approach - for more complex cases, you might want a library
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      // Take the last two parts for the root domain
      const rootDomain = parts.slice(-2).join('.');
      return `*://*.${rootDomain}/*`;
    }
    return `*://${hostname}/*`;
  } catch (err) {
    return '';
  }
};

const init = () => {
  enhanceCodeEditor(jsEditor, "js");
  enhanceCodeEditor(cssEditor, "css");

  // Check if URL parameter is present
  const urlParams = new URLSearchParams(window.location.search);
  const sourceUrl = urlParams.get('url');
  
  if (sourceUrl) {
    const pattern = extractDomainPattern(sourceUrl);
    if (pattern) {
      form.rulePatterns.value = pattern;
    }
  }
};

const createRulePayload = () => {
  const formattedJs = formatCode("js", jsEditor.value);
  const formattedCss = formatCode("css", cssEditor.value);
  jsEditor.value = formattedJs;
  cssEditor.value = formattedCss;

  const name = form.ruleName.value.trim();
  const patterns = form.rulePatterns.value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const now = Date.now();
  return {
    id: crypto.randomUUID?.() ?? `rule-${now}`,
    name,
    patterns,
    jsCode: formattedJs,
    cssCode: formattedCss,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rule = createRulePayload();
  const { rules = [] } = await chrome.storage.local.get({ rules: [] });
  await chrome.storage.local.set({ rules: [...rules, rule] });
  
  // Redirect to options page with the new rule focused
  window.location.href = `rules.html#rule=${encodeURIComponent(rule.id)}`;
});

// Initialize on page load
document.addEventListener("DOMContentLoaded", init);

