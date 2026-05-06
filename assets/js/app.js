const converter = window.SqlLaravelConverter;

const els = {
  sqlInput: document.getElementById("sqlInput"),
  outputCode: document.getElementById("outputCode"),
  statusText: document.getElementById("statusText"),
  copyBtn: document.getElementById("copyBtn"),
  pasteBtn: document.getElementById("pasteBtn"),
  fileInput: document.getElementById("fileInput"),
  importFileBtn: document.getElementById("importFileBtn"),
  clearBtn: document.getElementById("clearBtn"),
  loadSampleBtn: document.getElementById("loadSampleBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  tableList: document.getElementById("tableList"),
  warningsPanel: document.getElementById("warningsPanel"),
  warningsList: document.getElementById("warningsList"),
  wrapMigration: document.getElementById("wrapMigration"),
  combineTimestamps: document.getElementById("combineTimestamps"),
  combineSoftDeletes: document.getElementById("combineSoftDeletes"),
  useForeignId: document.getElementById("useForeignId"),
};

const sampleSQL = `CREATE TABLE \`users\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`name\` varchar(255) NOT NULL,
  \`email\` varchar(255) NOT NULL,
  \`email_verified_at\` timestamp NULL DEFAULT NULL,
  \`password\` varchar(255) NOT NULL,
  \`role\` enum('admin','staff','user') NOT NULL DEFAULT 'user',
  \`is_active\` tinyint(1) NOT NULL DEFAULT 1,
  \`remember_token\` varchar(100) DEFAULT NULL,
  \`created_at\` timestamp NULL DEFAULT NULL,
  \`updated_at\` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`users_email_unique\` (\`email\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE \`posts\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`user_id\` bigint unsigned NOT NULL,
  \`title\` varchar(180) NOT NULL,
  \`slug\` varchar(180) NOT NULL,
  \`body\` longtext,
  \`views\` int unsigned NOT NULL DEFAULT 0,
  \`published_at\` datetime DEFAULT NULL,
  \`deleted_at\` timestamp NULL DEFAULT NULL,
  \`created_at\` timestamp NULL DEFAULT NULL,
  \`updated_at\` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`posts_slug_unique\` (\`slug\`),
  KEY \`posts_user_id_index\` (\`user_id\`),
  CONSTRAINT \`posts_user_id_foreign\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;

let latestResult = {
  code: "// Generated Laravel schema will appear here.",
  blocks: [],
  warnings: [],
  blocked: false,
};

function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const debouncedRender = debounce(render);

function addAdvancedControls() {
  if (document.getElementById("primaryKeyStrategy")) return;

  const optionsContainer = els.useForeignId.closest("div");
  if (!optionsContainer) return;

  optionsContainer.insertAdjacentHTML(
    "beforeend",
    `
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
        <label for="tinyIntOneMode" class="block text-sm font-semibold text-white">tinyint(1) behavior</label>
        <p class="mt-1 text-xs leading-5 text-slate-400">Boolean is Laravel-friendly. tinyInteger is more legacy-accurate.</p>
        <select id="tinyIntOneMode" class="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30">
          <option value="boolean">Convert tinyint(1) to boolean</option>
          <option value="tinyInteger">Keep as tinyInteger</option>
        </select>
      </div>

      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
        <label for="primaryKeyStrategy" class="block text-sm font-semibold text-white">Primary key strategy</label>
        <p class="mt-1 text-xs leading-5 text-slate-400">Legacy exact keeps original names. Laravel style converts one auto-increment PK to $table-&gt;id().</p>
        <select id="primaryKeyStrategy" class="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30">
          <option value="legacy">Legacy exact</option>
          <option value="laravel">Laravel style</option>
        </select>
      </div>

      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
        <label for="zeroDateMode" class="block text-sm font-semibold text-white">Zero-date defaults</label>
        <p class="mt-1 text-xs leading-5 text-slate-400">Recommended: convert zero dates to nullable with no default.</p>
        <select id="zeroDateMode" class="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30">
          <option value="nullable">Convert to nullable</option>
          <option value="preserve">Preserve legacy zero dates</option>
        </select>
      </div>

      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
        <label for="connectionName" class="block text-sm font-semibold text-white">DB connection name</label>
        <p class="mt-1 text-xs leading-5 text-slate-400">Optional. Example: main outputs Schema::connection('main').</p>
        <input id="connectionName" type="text" placeholder="main" class="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30" />
      </div>

      <label class="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-3">
        <input id="ignoreCrud" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500" />
        <span>
          <span class="block text-sm font-semibold text-white">Ignore CRUD/data statements</span>
          <span class="block text-xs leading-5 text-slate-400">If checked, INSERT/UPDATE/DELETE/SELECT are skipped instead of blocking conversion.</span>
        </span>
      </label>
    `,
  );

  const foreignIdHelp = els.useForeignId
    .closest("label")
    .querySelector("span span + span");
  if (foreignIdHelp) {
    foreignIdHelp.textContent = "Only actual foreign-key columns become foreignId().";
  }

  const notesPanel = els.warningsPanel.previousElementSibling;
  const notesText = notesPanel && notesPanel.querySelector("p");
  if (notesText) {
    notesText.textContent =
      "This converter creates all tables first, then adds foreign keys in a second pass. It blocks or skips CRUD/data statements and warns about unsupported SQL features.";
  }
}

function enhanceLayout() {
  const header = document.querySelector("header");
  const main = document.querySelector("main");

  if (header && !document.getElementById("uxReviewBar")) {
    header.insertAdjacentHTML(
      "afterend",
      `
        <section id="uxReviewBar" class="mb-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div class="rounded-2xl border border-white/10 bg-white/[0.05] p-4 shadow-xl shadow-black/10">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Tables</p>
              <p id="uxTablesCount" class="mt-1 text-2xl font-bold text-white">0</p>
            </div>
            <div class="rounded-2xl border border-white/10 bg-white/[0.05] p-4 shadow-xl shadow-black/10">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Foreign keys</p>
              <p id="uxForeignKeyCount" class="mt-1 text-2xl font-bold text-white">0</p>
            </div>
            <div class="rounded-2xl border border-white/10 bg-white/[0.05] p-4 shadow-xl shadow-black/10">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Warnings</p>
              <p id="uxWarningsCount" class="mt-1 text-2xl font-bold text-white">0</p>
            </div>
            <div class="rounded-2xl border border-white/10 bg-white/[0.05] p-4 shadow-xl shadow-black/10">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">SQL size</p>
              <p id="uxSqlSize" class="mt-1 text-2xl font-bold text-white">0 KB</p>
            </div>
            <div id="uxStatusCard" class="rounded-2xl border border-white/10 bg-white/[0.05] p-4 shadow-xl shadow-black/10">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</p>
              <p id="uxStatusLabel" class="mt-1 text-lg font-bold text-emerald-300">Ready</p>
            </div>
          </div>

          <div class="rounded-2xl border border-white/10 bg-white/[0.05] p-3 shadow-xl shadow-black/10">
            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">View</p>
            <div id="uxViewButtons" class="grid grid-cols-3 gap-2 text-xs font-semibold">
              <button data-view="split" class="ux-active-view rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-slate-200 transition hover:bg-white/15">Split</button>
              <button data-view="input" class="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-slate-200 transition hover:bg-white/15">Input</button>
              <button data-view="output" class="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-slate-200 transition hover:bg-white/15">Output</button>
            </div>
          </div>
        </section>
      `,
    );
  }

  if (els.pasteBtn && !document.getElementById("formatSqlBtn")) {
    els.pasteBtn.insertAdjacentHTML(
      "beforebegin",
      '<button id="formatSqlBtn" class="rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/30">Format</button>',
    );
  }

  if (els.copyBtn && !document.getElementById("copyInputBtn")) {
    els.copyBtn.insertAdjacentHTML(
      "beforebegin",
      '<button id="copyInputBtn" class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700">Copy SQL</button>',
    );
  }

  if (main && !document.getElementById("uxShortcutHint")) {
    main.insertAdjacentHTML(
      "afterend",
      `
        <div id="uxShortcutHint" class="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs leading-5 text-slate-400">
          Shortcuts: <span class="font-semibold text-slate-200">Ctrl/Cmd + Enter</span> copy output, <span class="font-semibold text-slate-200">Ctrl/Cmd + K</span> focus SQL input, <span class="font-semibold text-slate-200">Esc</span> return to split view.
        </div>
      `,
    );
  }

  if (!document.getElementById("uxToast")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="uxToast" class="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 translate-y-3 rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm font-semibold text-white opacity-0 shadow-2xl shadow-black/30 transition">Copied</div>',
    );
  }
}

function readOptions() {
  return {
    wrapMigration: els.wrapMigration.checked,
    combineTimestamps: els.combineTimestamps.checked,
    combineSoftDeletes: els.combineSoftDeletes.checked,
    useForeignId: els.useForeignId.checked,
    primaryKeyStrategy: valueOf("primaryKeyStrategy", "legacy"),
    tinyIntOneMode: valueOf("tinyIntOneMode", "boolean"),
    zeroDateMode: valueOf("zeroDateMode", "nullable"),
    connectionName: valueOf("connectionName", ""),
    ignoreCrud: checked("ignoreCrud"),
  };
}

function valueOf(id, fallback) {
  const input = document.getElementById(id);
  return input ? input.value : fallback;
}

function checked(id) {
  const input = document.getElementById(id);
  return input ? input.checked : false;
}

function render() {
  if (!converter) {
    latestResult = {
      code: "// Converter failed to load.",
      blocks: [],
      warnings: ["Converter failed to load."],
      blocked: true,
    };
  } else {
    latestResult = converter.convertSql(els.sqlInput.value, readOptions());
  }

  els.outputCode.textContent = latestResult.code;
  els.statusText.textContent = latestResult.blocked
    ? "Conversion blocked."
    : latestResult.blocks.length
      ? `${latestResult.blocks.length} table${latestResult.blocks.length > 1 ? "s" : ""} converted.`
      : "Ready.";

  updateTableList(latestResult.blocks);
  updateWarnings(latestResult.warnings);
  updateStats(latestResult);
}

function updateTableList(blocks) {
  if (!blocks.length) {
    els.tableList.innerHTML = '<p class="text-slate-500">No tables detected yet.</p>';
    return;
  }

  els.tableList.innerHTML = blocks
    .map(
      (block, index) => `
        <div class="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2">
          <span class="font-semibold text-slate-100">${escapeHtml(block.table)}</span>
          <span class="rounded-full bg-indigo-400/10 px-2 py-0.5 text-xs text-indigo-200">#${index + 1}</span>
        </div>
      `,
    )
    .join("");
}

function updateWarnings(warnings) {
  if (!warnings.length) {
    els.warningsPanel.classList.add("hidden");
    els.warningsList.innerHTML = "";
    return;
  }

  els.warningsPanel.classList.remove("hidden");
  els.warningsList.innerHTML = warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");
}

function updateStats(result) {
  setText("uxTablesCount", String(result.blocks.length));
  setText("uxForeignKeyCount", String(countOccurrences(result.code, "->foreign(")));
  setText("uxWarningsCount", String(result.warnings.length));
  setText("uxSqlSize", `${(new Blob([els.sqlInput.value]).size / 1024).toFixed(1)} KB`);
  setText("uxStatusLabel", result.blocked ? "Blocked" : result.blocks.length ? "Converted" : "Ready");

  const statusLabel = document.getElementById("uxStatusLabel");
  if (statusLabel) {
    statusLabel.className = result.blocked
      ? "mt-1 text-lg font-bold text-red-300"
      : "mt-1 text-lg font-bold text-emerald-300";
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function countOccurrences(text, needle) {
  return String(text || "").split(needle).length - 1;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setViewMode(mode) {
  const editorGrid = document.getElementById("editorGrid");
  if (!editorGrid) return;

  editorGrid.classList.remove("ux-view-input", "ux-view-output");
  if (mode === "input") editorGrid.classList.add("ux-view-input");
  if (mode === "output") editorGrid.classList.add("ux-view-output");

  document.querySelectorAll("#uxViewButtons button").forEach((button) => {
    button.classList.toggle("ux-active-view", button.dataset.view === mode);
  });
}

function formatSqlInput() {
  els.sqlInput.value = els.sqlInput.value
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",\n  ")
    .replace(/\s*\(\s*/g, " (\n  ")
    .replace(/\s*\)\s*;/g, "\n);")
    .replace(/;\s*/g, ";\n\n")
    .trim();
  render();
}

async function importSqlFile(file) {
  if (!file) return;
  els.sqlInput.value = await file.text();
  render();
  showToast("SQL imported");
}

async function copyText(text, successMessage) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    const selection = document.getSelection();
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    if (selection) selection.removeAllRanges();
  }
  showToast(successMessage);
}

function downloadOutput() {
  const blob = new Blob([latestResult.code], { type: "text/x-php;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "generated_laravel_migration.php";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Migration file downloaded");
}

function showToast(message) {
  const toast = document.getElementById("uxToast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("ux-toast-show");
  setTimeout(() => toast.classList.remove("ux-toast-show"), 1600);
}

function wireEvents() {
  els.sqlInput.addEventListener("input", debouncedRender);

  [
    els.wrapMigration,
    els.combineTimestamps,
    els.combineSoftDeletes,
    els.useForeignId,
    document.getElementById("tinyIntOneMode"),
    document.getElementById("primaryKeyStrategy"),
    document.getElementById("zeroDateMode"),
    document.getElementById("ignoreCrud"),
  ].forEach((input) => {
    if (input) input.addEventListener("change", render);
  });

  const connectionName = document.getElementById("connectionName");
  if (connectionName) connectionName.addEventListener("input", debouncedRender);

  els.importFileBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (event) => {
    importSqlFile(event.target.files[0]);
    event.target.value = "";
  });

  els.sqlInput.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.sqlInput.classList.add("ring-2", "ring-emerald-400");
  });
  els.sqlInput.addEventListener("dragleave", () => {
    els.sqlInput.classList.remove("ring-2", "ring-emerald-400");
  });
  els.sqlInput.addEventListener("drop", (event) => {
    event.preventDefault();
    els.sqlInput.classList.remove("ring-2", "ring-emerald-400");
    importSqlFile(event.dataTransfer.files[0]);
  });

  els.loadSampleBtn.addEventListener("click", () => {
    els.sqlInput.value = sampleSQL;
    render();
  });

  els.clearBtn.addEventListener("click", () => {
    els.sqlInput.value = "";
    render();
  });

  els.copyBtn.addEventListener("click", () => copyText(latestResult.code, "Output copied"));

  const copyInputBtn = document.getElementById("copyInputBtn");
  if (copyInputBtn) {
    copyInputBtn.addEventListener("click", () => copyText(els.sqlInput.value, "SQL copied"));
  }

  els.pasteBtn.addEventListener("click", async () => {
    if (!navigator.clipboard) return;
    els.sqlInput.value = await navigator.clipboard.readText();
    render();
  });

  const formatBtn = document.getElementById("formatSqlBtn");
  if (formatBtn) formatBtn.addEventListener("click", formatSqlInput);

  els.downloadBtn.addEventListener("click", downloadOutput);

  document.querySelectorAll("#uxViewButtons button").forEach((button) => {
    button.addEventListener("click", () => setViewMode(button.dataset.view));
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      copyText(latestResult.code, "Output copied");
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      els.sqlInput.focus();
    }
    if (event.key === "Escape") setViewMode("split");
  });
}

addAdvancedControls();
enhanceLayout();
wireEvents();
render();
