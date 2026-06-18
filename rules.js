import { initTheme } from "./theme.js";
import { enhanceCodeEditor, formatCode } from "./editor-utils.js";

initTheme();

const rulesListEl = document.getElementById("rulesList");
const ruleItemTemplate = document.getElementById("ruleItemTemplate");
const saveAllBtn = document.getElementById("saveAll");
const deleteRuleBtn = document.getElementById("deleteRule");
const exportRuleBtn = document.getElementById("exportRule");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const exportSelectedBtn = document.getElementById("exportSelectedBtn");
const selectionActions = document.getElementById("selectionActions");
const selectAllBtn = document.getElementById("selectAllBtn");
const deselectAllBtn = document.getElementById("deselectAllBtn");
const emptyState = document.getElementById("emptyState");
const ruleEditor = document.getElementById("ruleEditor");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");
const settingsBtn = document.getElementById("settingsBtn");
const rulesSidebar = document.getElementById("rulesSidebar");
const sidebarResizeHandle = document.getElementById("sidebarResizeHandle");

// Editor inputs
const editorRuleName = document.getElementById("editorRuleName");
const editorRulePatterns = document.getElementById("editorRulePatterns");
const editorRuleJs = document.getElementById("editorRuleJs");
const editorRuleCss = document.getElementById("editorRuleCss");

// State
let rules = [];
let currentRuleId = null;
let autoSaveTimeout = null;
let isSaving = false;
const AUTO_SAVE_DELAY = 800;
let currentSearchQuery = "";
let selectedRuleIds = new Set();
let formatJsEditor;
let formatCssEditor;
let draggedRuleId = null;
let draggedOverIndex = null;
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_MOBILE_BREAKPOINT = 720;
const SIDEBAR_WIDTH_STORAGE_KEY = "rulesSidebarWidth";

const getHashParams = () => new URLSearchParams(window.location.hash.replace(/^#/, ""));

const getHashRuleId = () => {
  const params = getHashParams();
  return params.get("rule");
};

const setHashRuleId = (ruleId) => {
  const params = getHashParams();
  if (ruleId) {
    params.set("rule", ruleId);
  } else {
    params.delete("rule");
  }
  const next = params.toString();
  const hash = next ? `#${next}` : "";
  history.replaceState(null, "", `${window.location.pathname}${hash}`);
};

const loadRules = async () => {
  const { rules: storedRules = [] } = await chrome.storage.local.get({ rules: [] });
  // Migrate old rules without timestamps
  rules = storedRules.map(rule => {
    if (!rule.createdAt) {
      rule.createdAt = Date.now();
    }
    if (!rule.updatedAt) {
      rule.updatedAt = rule.createdAt;
    }
    return rule;
  });
  renderRulesList();
  updateSaveStatus(null);
  focusRuleFromHash();
};

const updateExportButtonState = () => {
  if (exportBtn) {
    exportBtn.disabled = rules.length === 0;
  }
};

const openSettingsPage = () => {
  const settingsUrl = chrome.runtime.getURL("settings.html");
  if (chrome?.tabs?.create) {
    chrome.tabs.create({ url: settingsUrl });
  } else {
    window.location.href = settingsUrl;
  }
};

const updateSelectionUI = () => {
  const selectedCount = selectedRuleIds.size;

  if (deleteSelectedBtn) {
    if (selectedCount > 0) {
      deleteSelectedBtn.style.display = "inline-flex";
      deleteSelectedBtn.textContent = `Delete (${selectedCount})`;
    } else {
      deleteSelectedBtn.style.display = "none";
    }
  }

  if (exportSelectedBtn) {
    if (selectedCount > 0) {
      exportSelectedBtn.style.display = "inline-flex";
      exportSelectedBtn.textContent = `Export (${selectedCount})`;
    } else {
      exportSelectedBtn.style.display = "none";
    }
  }

  if (selectionActions) {
    selectionActions.style.display = selectedCount > 0 ? "flex" : "none";
  }
};

const getFilteredRules = () =>
  currentSearchQuery
    ? rules.filter((rule) =>
        (rule.name || "").toLowerCase().includes(currentSearchQuery.toLowerCase())
      )
    : rules;

const renderRulesList = () => {
  rulesListEl.innerHTML = "";

  const filteredRules = getFilteredRules();

  filteredRules.forEach((rule) => {
    const item = ruleItemTemplate.content.firstElementChild.cloneNode(true);
    const toggleInput = item.querySelector(".rule-item-toggle-input");
    const toggleLabel = item.querySelector(".rule-item-toggle");
    const selectorInput = item.querySelector(".rule-item-selector-input");
    const selectorLabel = item.querySelector(".rule-item-selector");

    item.dataset.id = rule.id;
    item.dataset.ruleName = (rule.name || "").toLowerCase();
    const ruleName = rule.name || "Unnamed rule";
    const nameEl = item.querySelector(".rule-item-name");
    nameEl.textContent = ruleName;
    nameEl.title = ruleName;
    item.dataset.enabled = rule.enabled ? "true" : "false";
    toggleInput.checked = Boolean(rule.enabled);
    toggleInput.dataset.ruleId = rule.id;
    const toggleTitle = rule.enabled ? "Turn rule OFF" : "Turn rule ON";
    toggleLabel.title = toggleTitle;
    toggleInput.title = toggleTitle;

    // Add drag-and-drop reordering
    item.draggable = true;
    item.addEventListener("dragstart", (e) => {
      draggedRuleId = rule.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", rule.id);
      e.target.classList.add("dragging");
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      // Only process if we're dragging something
      if (!draggedRuleId) return;

      const rect = item.getBoundingClientRect();
      const midPoint = rect.top + rect.height / 2;

      if (e.clientY < midPoint) {
        item.classList.add("drag-over-top");
        item.classList.remove("drag-over-bottom");
        draggedOverIndex = Array.from(rulesListEl.children).indexOf(item);
      } else {
        item.classList.add("drag-over-bottom");
        item.classList.remove("drag-over-top");
        draggedOverIndex = Array.from(rulesListEl.children).indexOf(item) + 1;
      }
    });
    item.addEventListener("dragleave", (e) => {
      item.classList.remove("drag-over-top", "drag-over-bottom");
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();

      if (!draggedRuleId) return;

      item.classList.remove("drag-over-top", "drag-over-bottom");

      if (draggedOverIndex === null) return;

      const draggedRuleIndex = rules.findIndex((r) => r.id === draggedRuleId);
      if (draggedRuleIndex === -1) return;

      // Remove the dragged rule from its current position
      const [draggedRule] = rules.splice(draggedRuleIndex, 1);

      // Insert it at the new position
      rules.splice(draggedOverIndex, 0, draggedRule);

      // Update timestamps to reflect the reordering
      rules.forEach((r) => {
        r.updatedAt = Date.now();
      });

      // Directly manipulate DOM to avoid re-render flicker
      const draggedElement = document.querySelector(".rule-item.dragging");
      if (draggedElement) {
        rulesListEl.removeChild(draggedElement);
        if (draggedOverIndex >= rulesListEl.children.length) {
          rulesListEl.appendChild(draggedElement);
        } else {
          rulesListEl.insertBefore(draggedElement, rulesListEl.children[draggedOverIndex]);
        }
      }

      draggedRuleId = null;
      draggedOverIndex = null;

      // Persist the new order
      persistRules(true);
    });
    item.addEventListener("dragend", (e) => {
      document.querySelectorAll(".rule-item").forEach(i => {
        i.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
      });
      draggedRuleId = null;
      draggedOverIndex = null;
    });

    item.addEventListener("click", (e) => {
      // Don't select rule if clicking on the toggle or selector
      if (e.target.closest(".rule-item-toggle") || e.target.closest(".rule-item-selector")) {
        return;
      }
      selectRule(rule.id);
    });

    // Handle toggle click - stop propagation to prevent selecting the rule
    toggleLabel.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Handle selector click - stop propagation to prevent selecting the rule
    selectorLabel.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Handle selector checkbox change - track selected rules
    selectorInput.addEventListener("change", (e) => {
      e.stopPropagation();
      const ruleId = rule.id;
      if (e.target.checked) {
        selectedRuleIds.add(ruleId);
      } else {
        selectedRuleIds.delete(ruleId);
      }
      updateSelectionUI();
    });

    // Set initial checkbox state if rule is already selected
    if (selectedRuleIds.has(rule.id)) {
      selectorInput.checked = true;
    }

    toggleInput.addEventListener("change", async (e) => {
      e.stopPropagation();
      const ruleId = e.target.dataset.ruleId;
      const ruleIndex = rules.findIndex((r) => r.id === ruleId);
      if (ruleIndex !== -1) {
        rules[ruleIndex].enabled = e.target.checked;
        rules[ruleIndex].updatedAt = Date.now();
        // Update visual indicator
        item.dataset.enabled = rules[ruleIndex].enabled ? "true" : "false";
        // If this is the currently selected rule, update editor state
        if (currentRuleId === ruleId) {
          // No need to update editor since toggle is removed from there
        }
        await persistRules(true);
        renderRulesList();
        // Re-select current rule if it still exists
        if (currentRuleId) {
          const activeItem = rulesListEl.querySelector(`.rule-item[data-id="${currentRuleId}"]`);
          if (activeItem) {
            activeItem.classList.add("active");
          }
        }
      }
    });

    rulesListEl.appendChild(item);
  });

  // Update active state
  if (currentRuleId) {
    const activeItem = rulesListEl.querySelector(`.rule-item[data-id="${currentRuleId}"]`);
    if (activeItem) {
      activeItem.classList.add("active");
    }
  }

  // Update clear button visibility
  if (clearSearchBtn) {
    clearSearchBtn.style.display = currentSearchQuery ? "flex" : "none";
  }

  // Update export button state
  updateExportButtonState();

  // Update selection UI
  updateSelectionUI();
};

const selectRule = (ruleId) => {
  currentRuleId = ruleId;
  setHashRuleId(ruleId);

  // Update active state in sidebar
  rulesListEl.querySelectorAll(".rule-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.id === ruleId);
  });

  // Load rule data into editor
  const rule = rules.find((r) => r.id === ruleId);
  if (rule) {
    editorRuleName.value = rule.name || "";
    editorRulePatterns.value = rule.patterns.join(", ") || "";
    editorRuleJs.value = rule.jsCode || "";
    editorRuleCss.value = rule.cssCode || "";
    formatJsEditor?.();
    formatCssEditor?.();

    emptyState.style.display = "none";
    ruleEditor.style.display = "flex";
  }
};

const updateSaveStatus = (status) => {
  if (status === "saving") {
    saveAllBtn.textContent = "Saving...";
    saveAllBtn.disabled = true;
    saveAllBtn.classList.remove("saved");
  } else if (status === "saved") {
    saveAllBtn.textContent = "Saved";
    saveAllBtn.disabled = false;
    saveAllBtn.classList.add("saved");
    // Reset the saved state after 1.5 seconds
    setTimeout(() => {
      saveAllBtn.textContent = "Save changes";
      saveAllBtn.classList.remove("saved");
    }, 1500);
  } else if (status === "unsaved") {
    saveAllBtn.textContent = "Save changes";
    saveAllBtn.disabled = false;
    saveAllBtn.classList.remove("saved");
  } else {
    saveAllBtn.textContent = "Save changes";
    saveAllBtn.disabled = false;
    saveAllBtn.classList.remove("saved");
  }
};

const saveCurrentRule = () => {
  if (!currentRuleId) return;

  const ruleIndex = rules.findIndex((r) => r.id === currentRuleId);
  if (ruleIndex === -1) return;

  const rule = rules.find((r) => r.id === currentRuleId);
  const formattedJs = formatCode("js", editorRuleJs.value);
  const formattedCss = formatCode("css", editorRuleCss.value);
  if (formattedJs !== editorRuleJs.value) {
    editorRuleJs.value = formattedJs;
  }
  if (formattedCss !== editorRuleCss.value) {
    editorRuleCss.value = formattedCss;
  }
  rules[ruleIndex] = {
    ...rules[ruleIndex],
    name: editorRuleName.value.trim(),
    patterns: editorRulePatterns.value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    jsCode: formattedJs,
    cssCode: formattedCss,
    enabled: rule ? rule.enabled : true, // Keep existing enabled state
    updatedAt: Date.now(),
  };

  // Update sidebar item
  const sidebarItem = rulesListEl.querySelector(`.rule-item[data-id="${currentRuleId}"]`);
  if (sidebarItem) {
    const toggleInput = sidebarItem.querySelector(`.rule-item-toggle-input[data-rule-id="${currentRuleId}"]`);

    sidebarItem.querySelector(".rule-item-name").textContent = rules[ruleIndex].name || "Unnamed rule";
    sidebarItem.dataset.ruleName = (rules[ruleIndex].name || "").toLowerCase();
    sidebarItem.dataset.enabled = rules[ruleIndex].enabled ? "true" : "false";
    if (toggleInput) {
      toggleInput.checked = Boolean(rules[ruleIndex].enabled);
    }
  }
};

const persistRules = async (showStatus = false) => {
  if (isSaving) return;

  // Save current rule changes first
  if (currentRuleId) {
    saveCurrentRule();
  }

  isSaving = true;
  if (showStatus) {
    updateSaveStatus("saving");
  }

  try {
    await chrome.storage.local.set({ rules });

    if (showStatus) {
      updateSaveStatus("saved");
    } else {
      updateSaveStatus(null);
    }
  } catch (error) {
    console.error("Failed to save rules:", error);
    updateSaveStatus("unsaved");
    alert("Failed to save rules. Please try again.");
  } finally {
    isSaving = false;
  }
};

const scheduleAutoSave = () => {
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
  }

  if (!isSaving) {
    updateSaveStatus("unsaved");
  }

  autoSaveTimeout = setTimeout(() => {
    persistRules(true);
    autoSaveTimeout = null;
  }, AUTO_SAVE_DELAY);
};

const initializeEditors = () => {
  formatJsEditor = enhanceCodeEditor(editorRuleJs, "js", { onEdit: scheduleAutoSave });
  formatCssEditor = enhanceCodeEditor(editorRuleCss, "css", { onEdit: scheduleAutoSave });
};

const initializeSidebarResize = () => {
  if (!rulesSidebar || !sidebarResizeHandle) return;

  let isResizing = false;

  const clampSidebarWidth = (value) =>
    Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, value));

  const isMobileLayout = () => window.innerWidth <= SIDEBAR_MOBILE_BREAKPOINT;
  const saveSidebarWidth = (width) => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    } catch (error) {
      console.warn("Failed to persist sidebar width:", error);
    }
  };

  const applySidebarWidth = (width) => {
    rulesSidebar.style.width = `${width}px`;
    rulesSidebar.style.minWidth = `${width}px`;
  };

  const restoreSidebarWidth = () => {
    if (isMobileLayout()) return;
    const rawWidth = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!rawWidth) return;
    const parsedWidth = parseInt(rawWidth, 10);
    if (Number.isNaN(parsedWidth)) return;
    const safeWidth = clampSidebarWidth(parsedWidth);
    applySidebarWidth(safeWidth);
  };

  const onPointerMove = (event) => {
    if (!isResizing) return;
    const nextWidth = clampSidebarWidth(event.clientX);
    applySidebarWidth(nextWidth);
  };

  const stopResizing = () => {
    if (!isResizing) return;
    isResizing = false;
    sidebarResizeHandle.classList.remove("is-resizing");
    document.body.style.userSelect = "";
    const finalWidth = parseInt(window.getComputedStyle(rulesSidebar).width, 10);
    if (!Number.isNaN(finalWidth)) {
      saveSidebarWidth(clampSidebarWidth(finalWidth));
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResizing);
  };

  sidebarResizeHandle.addEventListener("pointerdown", (event) => {
    if (isMobileLayout() || event.button !== 0) return;
    event.preventDefault();
    isResizing = true;
    sidebarResizeHandle.classList.add("is-resizing");
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
  });

  window.addEventListener("resize", () => {
    if (isMobileLayout()) {
      rulesSidebar.style.width = "";
      rulesSidebar.style.minWidth = "";
      return;
    }

    const currentWidth = parseInt(window.getComputedStyle(rulesSidebar).width, 10);
    if (!Number.isNaN(currentWidth)) {
      const safeWidth = clampSidebarWidth(currentWidth);
      applySidebarWidth(safeWidth);
    }
  });

  restoreSidebarWidth();
};

const deleteCurrentRule = async () => {
  if (!currentRuleId) return;

  if (!confirm("Are you sure you want to delete this rule?")) {
    return;
  }

  rules = rules.filter((r) => r.id !== currentRuleId);
  currentRuleId = null;
  setHashRuleId(null);

  // Clear editor
  emptyState.style.display = "flex";
  ruleEditor.style.display = "none";

  // Re-render sidebar
  renderRulesList();

  // Save changes
  await persistRules(true);

  // Update export button state
  updateExportButtonState();

  // Update selection UI
  updateSelectionUI();
};

const deleteSelectedRules = async () => {
  if (selectedRuleIds.size === 0) return;

  const count = selectedRuleIds.size;
  if (!confirm(`Are you sure you want to delete ${count} selected rule(s)?`)) {
    return;
  }

  // Check if currently selected rule will be deleted
  const willDeleteCurrentRule = currentRuleId && selectedRuleIds.has(currentRuleId);

  // Remove selected rules
  rules = rules.filter((r) => !selectedRuleIds.has(r.id));

  // Clear selection
  selectedRuleIds.clear();

  // If currently selected rule was deleted, clear selection
  if (willDeleteCurrentRule) {
    currentRuleId = null;
    setHashRuleId(null);
    emptyState.style.display = "flex";
    ruleEditor.style.display = "none";
  }

  // Re-render sidebar
  renderRulesList();

  // Save changes
  await persistRules(true);

  // Update export button state
  updateExportButtonState();

  // Update selection UI
  updateSelectionUI();
};

const deleteAllRules = async () => {
  const count = rules.length;
  if (count === 0) return false;

  const confirmed = confirm(`Are you sure you want to delete ALL ${count} rule(s)? This action cannot be undone.`);
  if (!confirmed) {
    return false;
  }

  // Clear all rules
  rules = [];
  currentRuleId = null;
  setHashRuleId(null);
  selectedRuleIds.clear();

  // Clear editor
  emptyState.style.display = "flex";
  ruleEditor.style.display = "none";

  // Clear search
  if (searchInput) {
    searchInput.value = "";
    currentSearchQuery = "";
  }

  // Re-render sidebar
  renderRulesList();

  // Save changes
  await persistRules(true);

  // Update export button state
  updateExportButtonState();

  // Update selection UI
  updateSelectionUI();

  return true;
};

const focusRuleFromHash = () => {
  const targetId = getHashRuleId();
  if (!targetId) {
    emptyState.style.display = "flex";
    ruleEditor.style.display = "none";
    currentRuleId = null;
    return;
  }

  const rule = rules.find((r) => r.id === targetId);
  if (rule) {
    selectRule(targetId);
  }
};

const filterRules = () => {
  renderRulesList();
  // If current rule is filtered out, clear selection
  if (currentRuleId) {
    const currentItem = rulesListEl.querySelector(`.rule-item[data-id="${currentRuleId}"]`);
    if (!currentItem || currentItem.style.display === "none") {
      currentRuleId = null;
      setHashRuleId(null);
      emptyState.style.display = "flex";
      ruleEditor.style.display = "none";
    }
  }
};

const clearSearch = () => {
  if (searchInput) {
    searchInput.value = "";
    currentSearchQuery = "";
    filterRules();
    searchInput.focus();
  }
};

const exportRules = (rulesToExport = rules, filenamePrefix = "code-injector-rules") => {
  if (rulesToExport.length === 0) return;

  const exportData = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    rules: rulesToExport
  };

  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const exportSelectedRules = () => {
  if (selectedRuleIds.size === 0) return;

  const selectedRules = rules.filter((rule) => selectedRuleIds.has(rule.id));
  exportRules(selectedRules, "code-injector-selected-rules");
};

const exportCurrentRule = () => {
  if (!currentRuleId) return;
  const currentRule = rules.find((rule) => rule.id === currentRuleId);
  if (!currentRule) return;
  const safeRuleName = (currentRule.name || "unnamed-rule")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unnamed-rule";
  exportRules([currentRule], `code-injector-rule-${safeRuleName}`);
};

const selectAllVisibleRules = () => {
  const visibleRules = getFilteredRules();
  visibleRules.forEach((rule) => selectedRuleIds.add(rule.id));
  renderRulesList();
};

const deselectAllRules = () => {
  if (selectedRuleIds.size === 0) return;
  selectedRuleIds.clear();
  renderRulesList();
};

const importRules = async (file) => {
  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    // Validate the import data structure
    if (!importData.rules || !Array.isArray(importData.rules)) {
      throw new Error("Invalid file format. Expected a JSON file with a 'rules' array.");
    }

    const importedRules = importData.rules;

    if (importedRules.length === 0) {
      alert("The imported file contains no rules.");
      return;
    }

    // Generate new IDs for imported rules to avoid conflicts
    const existingIds = new Set(rules.map(r => r.id));
    const newRules = importedRules.map(rule => {
      // Create a new ID if the imported rule's ID already exists
      let newId = rule.id;
      if (existingIds.has(newId)) {
        newId = `${rule.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
      existingIds.add(newId);

      return {
        ...rule,
        id: newId,
        createdAt: rule.createdAt || Date.now(),
        updatedAt: Date.now(),
        enabled: rule.enabled !== undefined ? rule.enabled : true
      };
    });

    // Add the new rules to the existing rules array
    rules = [...rules, ...newRules];

    // Save the updated rules
    await persistRules(true);

    // Re-render the list
    renderRulesList();

    alert(`Successfully imported ${newRules.length} rule(s).`);
  } catch (error) {
    console.error("Failed to import rules:", error);
    alert(`Failed to import rules: ${error.message}`);
  }
};

// Event listeners
saveAllBtn.addEventListener("click", async () => {
  if (saveAllBtn.disabled || isSaving) return;

  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
  }

  await persistRules(true);
});

deleteRuleBtn.addEventListener("click", deleteCurrentRule);
if (exportRuleBtn) {
  exportRuleBtn.addEventListener("click", exportCurrentRule);
}

// Delete selected button handler
if (deleteSelectedBtn) {
  deleteSelectedBtn.addEventListener("click", deleteSelectedRules);
}

// Export/Import button handlers
if (exportBtn) {
  exportBtn.addEventListener("click", () => exportRules());
}

if (exportSelectedBtn) {
  exportSelectedBtn.addEventListener("click", exportSelectedRules);
}

if (selectAllBtn) {
  selectAllBtn.addEventListener("click", selectAllVisibleRules);
}

if (deselectAllBtn) {
  deselectAllBtn.addEventListener("click", deselectAllRules);
}

if (importBtn && importFileInput) {
  importBtn.addEventListener("click", () => {
    importFileInput.click();
  });

  importFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) {
      await importRules(file);
      // Reset the input so the same file can be imported again if needed
      importFileInput.value = "";
    }
  });
}

if (settingsBtn) {
  settingsBtn.addEventListener("click", openSettingsPage);
}

// Editor input listeners
[editorRuleName, editorRulePatterns, editorRuleJs, editorRuleCss].forEach((input) => {
  input.addEventListener("input", () => {
    scheduleAutoSave();
  });
});

window.addEventListener("hashchange", focusRuleFromHash);

document.addEventListener("DOMContentLoaded", () => {
  initializeEditors();
  initializeSidebarResize();
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      currentSearchQuery = e.target.value;
      filterRules();
    });

    // Secret feature: detect "/reset" command
    searchInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && e.target.value.trim() === "/reset") {
        e.preventDefault();
        e.target.value = "";
        currentSearchQuery = "";
        const deleted = await deleteAllRules();
        // If user cancels deletion, ensure the cleared search also resets the list
        if (!deleted) {
          filterRules();
        }
      }
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", clearSearch);
  }

  loadRules();
  updateExportButtonState();
});
