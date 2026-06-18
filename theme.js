const THEME_KEY = "theme";
const DEFAULT_THEME = "light";
const CACHE_KEY = "codeInjector:theme";
const FAVICONS = {
  light: "icons/48px.png",
  dark: "icons/darkmode/48px.png",
};

const normalizeTheme = (value) => (value === "dark" ? "dark" : DEFAULT_THEME);

const cacheTheme = (theme) => {
  try {
    localStorage.setItem(CACHE_KEY, normalizeTheme(theme));
  } catch (error) {
    console.warn("[Code Injector] Unable to cache theme preference:", error);
  }
};

const getCachedTheme = () => {
  try {
    return localStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
};

const updateFavicon = (theme) => {
  const href = FAVICONS[normalizeTheme(theme)] ?? FAVICONS[DEFAULT_THEME];
  const head = document?.head;
  if (!href || !head) return;

  const resolvedHref = chrome?.runtime?.getURL ? chrome.runtime.getURL(href) : href;
  let link = head.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    head.appendChild(link);
  }
  link.href = resolvedHref;
  link.sizes = "48x48";
};

const applyDocumentTheme = (theme) => {
  const normalized = normalizeTheme(theme);
  const root = document?.documentElement;
  if (!root) return normalized;

  root.dataset.theme = normalized;
  // Keep native form controls aligned with our palette
  root.style.colorScheme = normalized;
  updateFavicon(normalized);
  return normalized;
};

export const applyCachedTheme = () => {
  const cached = getCachedTheme();
  if (cached) {
    applyDocumentTheme(cached);
  }
};

export const loadSavedTheme = async () => {
  try {
    const result = await chrome?.storage?.local?.get?.(THEME_KEY);
    const stored = result?.[THEME_KEY];
    const theme = normalizeTheme(stored ?? getCachedTheme() ?? DEFAULT_THEME);
    cacheTheme(theme);
    applyDocumentTheme(theme);
    return theme;
  } catch (error) {
    console.warn("[Code Injector] Failed to load saved theme, using fallback.", error);
    const theme = normalizeTheme(getCachedTheme() ?? DEFAULT_THEME);
    applyDocumentTheme(theme);
    return theme;
  }
};

export const saveTheme = async (theme) => {
  const normalized = normalizeTheme(theme);
  cacheTheme(normalized);
  applyDocumentTheme(normalized);
  try {
    await chrome?.storage?.local?.set?.({ [THEME_KEY]: normalized });
  } catch (error) {
    console.error("[Code Injector] Failed to save theme preference:", error);
  }
  return normalized;
};

export const initTheme = async () => {
  // Apply cached value first to reduce flash of incorrect theme.
  applyCachedTheme();

  // Then load the authoritative value from extension storage.
  await loadSavedTheme();

  // Keep page/theme in sync with changes from other views.
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[THEME_KEY]) return;
      const next = normalizeTheme(changes[THEME_KEY].newValue);
      cacheTheme(next);
      applyDocumentTheme(next);
    });
  }
};

