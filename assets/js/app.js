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

const debounce = (fn, delay = 250) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*#.*$/gm, "");
}

function cleanIdentifier(value) {
  if (!value) return "";
  let name = value.trim();
  name = name.replace(/^[`"'\[]|[`"'\]]$/g, "");
  if (name.includes(".")) name = name.split(".").pop();
  return name.replace(/^[`"']|[`"']$/g, "");
}

function phpString(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function phpArray(items) {
  return `[${items.map(phpString).join(", ")}]`;
}

function extractIdentifiers(input) {
  const result = [];
  const parts = splitTopLevel(input, ",");
  for (const raw of parts) {
    const item = cleanIdentifier(raw.trim());
    if (item) result.push(item);
  }
  return result;
}

function splitTopLevel(input, delimiter = ",") {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === "(") depth++;
    if (ch === ")") depth--;

    if (ch === delimiter && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      current += ch;
      if (ch === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        blockComment = false;
      }
      continue;
    }

    if (quote) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      current += ch + next;
      i++;
      lineComment = true;
      continue;
    }

    if (ch === "#") {
      current += ch;
      lineComment = true;
      continue;
    }

    if (ch === "/" && next === "*") {
      current += ch + next;
      i++;
      blockComment = true;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

function firstSqlCommand(statement) {
  const cleaned = stripSqlComments(statement).trim();
  const match = cleaned.match(/^([a-zA-Z]+)/);
  return match ? match[1].toLowerCase() : "";
}

function detectBlockedCrudStatements(sql) {
  const blockedCommands = new Set([
    "select",
    "insert",
    "update",
    "delete",
    "replace",
  ]);
  return splitSqlStatements(sql)
    .map((statement, index) => {
      const command = firstSqlCommand(statement);
      if (!blockedCommands.has(command)) return null;

      return {
        index: index + 1,
        command: command.toUpperCase(),
        preview: stripSqlComments(statement)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140),
      };
    })
    .filter(Boolean);
}

function findCreateTableBlocks(sql) {
  const cleaned = stripSqlComments(sql);
  const blocks = [];
  const regex =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:`[^`]+`)|(?:"[^"]+")|(?:'[^']+')|(?:[a-zA-Z0-9_\.]+))\s*\(/gi;
  let match;

  while ((match = regex.exec(cleaned)) !== null) {
    const table = cleanIdentifier(match[1]);
    const openParenIndex = regex.lastIndex - 1;
    let depth = 0;
    let quote = null;
    let escaped = false;
    let closeParenIndex = -1;

    for (let i = openParenIndex; i < cleaned.length; i++) {
      const ch = cleaned[i];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }

      if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
        continue;
      }

      if (ch === "(") depth++;
      if (ch === ")") depth--;

      if (depth === 0) {
        closeParenIndex = i;
        break;
      }
    }

    if (closeParenIndex > openParenIndex) {
      blocks.push({
        table,
        body: cleaned.slice(openParenIndex + 1, closeParenIndex),
      });
      regex.lastIndex = closeParenIndex + 1;
    }
  }

  return blocks;
}

function parseColumnDefinition(line, warnings) {
  const match = line.match(
    /^((?:`[^`]+`)|(?:"[^"]+")|(?:\[[^\]]+\])|(?:[a-zA-Z0-9_]+))\s+([\s\S]+)$/,
  );
  if (!match) return null;

  const name = cleanIdentifier(match[1]);
  const rest = match[2].trim();
  const lower = rest.toLowerCase();
  const typeInfo = readType(rest);

  if (!typeInfo) {
    warnings.push(`Could not detect type for column: ${name}`);
    return null;
  }

  const column = {
    name,
    raw: line,
    rawType: typeInfo.rawType,
    type: typeInfo.type,
    args: typeInfo.args,
    lower,
    nullable: /\bnull\b/i.test(rest) && !/\bnot\s+null\b/i.test(rest),
    notNull: /\bnot\s+null\b/i.test(rest),
    unsigned: /\bunsigned\b/i.test(rest),
    autoIncrement: /\bauto_increment\b/i.test(rest),
    primaryInline: /\bprimary\s+key\b/i.test(rest),
    uniqueInline: /\bunique\b/i.test(rest),
    defaultValue: readDefault(rest),
    onUpdateCurrentTimestamp:
      /\bon\s+update\s+current_timestamp(?:\(\))?\b/i.test(rest),
    comment: readComment(rest),
  };

  return column;
}

function readType(rest) {
  const words = rest.trim();
  const knownMulti = [
    "double precision",
    "character varying",
    "medium int",
    "tiny int",
    "small int",
    "big int",
  ];

  for (const phrase of knownMulti) {
    const re = new RegExp(
      `^${phrase.replace(/ /g, "\\s+")}(\\s*\\(([^)]*)\\))?`,
      "i",
    );
    const m = words.match(re);
    if (m)
      return {
        rawType: m[0].trim(),
        type: phrase.replace(/\s+/g, " "),
        args: m[2] || "",
      };
  }

  const match = words.match(/^([a-zA-Z]+)(\s*\(([^)]*)\))?/);
  if (!match) return null;
  return {
    rawType: match[0].trim(),
    type: match[1].toLowerCase(),
    args: match[3] || "",
  };
}

function readDefault(rest) {
  const match = rest.match(
    /\bdefault\s+((?:'([^'\\]|\\.)*')|(?:"([^"\\]|\\.)*")|(?:\([^)]*\))|(?:[^\s,]+))/i,
  );
  if (!match) return null;
  return match[1].trim();
}

function readComment(rest) {
  const match = rest.match(/\bcomment\s+('([^'\\]|\\.)*'|"([^"\\]|\\.)*")/i);
  if (!match) return null;
  return unquoteSql(match[1]);
}

function unquoteSql(value) {
  if (!value) return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function parseConstraint(line) {
  const normalized = line.trim();
  const lower = normalized.toLowerCase();

  if (lower.startsWith("primary key")) {
    const cols = normalized.match(/\(([^)]+)\)/);
    return {
      type: "primary",
      columns: cols ? extractIdentifiers(cols[1]) : [],
    };
  }

  const uniqueMatch = normalized.match(
    /^(?:unique\s+(?:key|index)?|unique key|unique index)\s+(?:`[^`]+`|"[^"]+"|'[^']+'|[a-zA-Z0-9_]+)?\s*\(([^)]+)\)/i,
  );
  if (uniqueMatch) {
    const nameMatch = normalized.match(
      /^(?:unique\s+(?:key|index)?|unique key|unique index)\s+((?:`[^`]+`)|(?:"[^"]+")|(?:'[^']+')|(?:[a-zA-Z0-9_]+))/i,
    );
    return {
      type: "unique",
      name: nameMatch ? cleanIdentifier(nameMatch[1]) : null,
      columns: extractIdentifiers(uniqueMatch[1]),
    };
  }

  const indexMatch = normalized.match(
    /^(?:key|index)\s+((?:`[^`]+`)|(?:"[^"]+")|(?:'[^']+')|(?:[a-zA-Z0-9_]+))?\s*\(([^)]+)\)/i,
  );
  if (indexMatch) {
    return {
      type: "index",
      name: indexMatch[1] ? cleanIdentifier(indexMatch[1]) : null,
      columns: extractIdentifiers(indexMatch[2]),
    };
  }

  const foreignMatch = normalized.match(
    /^(?:constraint\s+((?:`[^`]+`)|(?:"[^"]+")|(?:'[^']+')|(?:[a-zA-Z0-9_]+))\s+)?foreign\s+key\s*\(([^)]+)\)\s+references\s+((?:`[^`]+`)|(?:"[^"]+")|(?:'[^']+')|(?:[a-zA-Z0-9_\.]+))\s*\(([^)]+)\)([\s\S]*)$/i,
  );
  if (foreignMatch) {
    return {
      type: "foreign",
      name: foreignMatch[1] ? cleanIdentifier(foreignMatch[1]) : null,
      columns: extractIdentifiers(foreignMatch[2]),
      referencesTable: cleanIdentifier(foreignMatch[3]),
      referencesColumns: extractIdentifiers(foreignMatch[4]),
      actions: foreignMatch[5] || "",
    };
  }

  return null;
}

function methodForColumn(column, options) {
  const type = column.type.toLowerCase();
  const args = column.args;
  const nameArg = phpString(column.name);
  const isId = column.name === "id";
  const lower = column.lower;

  if (
    isId &&
    column.autoIncrement &&
    /big\s*int|bigint/.test(type) &&
    column.unsigned
  ) {
    return "$table->id()";
  }

  if (column.autoIncrement) {
    if (/big\s*int|bigint/.test(type))
      return `$table->bigIncrements(${nameArg})`;
    if (/small\s*int|smallint/.test(type))
      return `$table->smallIncrements(${nameArg})`;
    if (/medium\s*int|mediumint/.test(type))
      return `$table->mediumIncrements(${nameArg})`;
    if (/tiny\s*int|tinyint/.test(type))
      return `$table->tinyIncrements(${nameArg})`;
    return `$table->increments(${nameArg})`;
  }

  if (
    options.useForeignId &&
    /_id$/.test(column.name) &&
    /big\s*int|bigint/.test(type) &&
    column.unsigned
  ) {
    return `$table->foreignId(${nameArg})`;
  }

  if (type === "varchar" || type === "character varying") {
    const len = parseInt(args, 10);
    return len && len !== 255
      ? `$table->string(${nameArg}, ${len})`
      : `$table->string(${nameArg})`;
  }

  if (type === "char") {
    const len = parseInt(args, 10);
    return len
      ? `$table->char(${nameArg}, ${len})`
      : `$table->char(${nameArg})`;
  }

  if (type === "tinytext") return `$table->tinyText(${nameArg})`;
  if (type === "mediumtext") return `$table->mediumText(${nameArg})`;
  if (type === "longtext") return `$table->longText(${nameArg})`;
  if (type === "text") return `$table->text(${nameArg})`;

  if (type === "tinyint" || type === "tiny int") {
    if (args.trim() === "1" || lower.includes("boolean"))
      return `$table->boolean(${nameArg})`;
    return column.unsigned
      ? `$table->unsignedTinyInteger(${nameArg})`
      : `$table->tinyInteger(${nameArg})`;
  }

  if (type === "smallint" || type === "small int")
    return column.unsigned
      ? `$table->unsignedSmallInteger(${nameArg})`
      : `$table->smallInteger(${nameArg})`;
  if (type === "mediumint" || type === "medium int")
    return column.unsigned
      ? `$table->unsignedMediumInteger(${nameArg})`
      : `$table->mediumInteger(${nameArg})`;
  if (type === "int" || type === "integer")
    return column.unsigned
      ? `$table->unsignedInteger(${nameArg})`
      : `$table->integer(${nameArg})`;
  if (type === "bigint" || type === "big int")
    return column.unsigned
      ? `$table->unsignedBigInteger(${nameArg})`
      : `$table->bigInteger(${nameArg})`;

  if (type === "bool" || type === "boolean")
    return `$table->boolean(${nameArg})`;

  if (type === "decimal" || type === "numeric") {
    const [precision = "8", scale = "2"] = args
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    return column.unsigned
      ? `$table->unsignedDecimal(${nameArg}, ${precision}, ${scale})`
      : `$table->decimal(${nameArg}, ${precision}, ${scale})`;
  }

  if (type === "float")
    return args
      ? `$table->float(${nameArg}, ${args})`
      : `$table->float(${nameArg})`;
  if (type === "double" || type === "real" || type === "double precision")
    return args
      ? `$table->double(${nameArg}, ${args})`
      : `$table->double(${nameArg})`;

  if (type === "date") return `$table->date(${nameArg})`;
  if (type === "datetime") return `$table->dateTime(${nameArg})`;
  if (type === "timestamp") return `$table->timestamp(${nameArg})`;
  if (type === "time") return `$table->time(${nameArg})`;
  if (type === "year") return `$table->year(${nameArg})`;

  if (type === "json") return `$table->json(${nameArg})`;
  if (type === "jsonb") return `$table->jsonb(${nameArg})`;
  if (type === "uuid") return `$table->uuid(${nameArg})`;
  if (type === "ulid") return `$table->ulid(${nameArg})`;
  if (type === "binary" || type === "blob") return `$table->binary(${nameArg})`;
  if (type === "mediumblob") return `$table->mediumBlob(${nameArg})`;
  if (type === "longblob") return `$table->longBlob(${nameArg})`;

  if (type === "enum") {
    const values = splitTopLevel(args, ",")
      .map((v) => unquoteSql(v.trim()))
      .filter(Boolean);
    return `$table->enum(${nameArg}, ${phpArray(values)})`;
  }

  if (type === "set") {
    const values = splitTopLevel(args, ",")
      .map((v) => unquoteSql(v.trim()))
      .filter(Boolean);
    return `$table->set(${nameArg}, ${phpArray(values)})`;
  }

  return `$table->${type.replace(/\s+/g, "")}(${nameArg})`;
}

function applyModifiers(base, column) {
  let code = base;

  const shouldNullable =
    !column.notNull && !column.primaryInline && !column.autoIncrement;
  if (column.nullable || shouldNullable) code += "->nullable()";

  if (column.defaultValue !== null && !/^null$/i.test(column.defaultValue)) {
    const raw = column.defaultValue;
    if (/^current_timestamp(?:\(\))?$/i.test(raw)) {
      code += "->useCurrent()";
    } else if (/^\(.*\)$/i.test(raw)) {
      code += `->default(DB::raw(${phpString(raw)}))`;
    } else if (/^'.*'$/.test(raw) || /^".*"$/.test(raw)) {
      code += `->default(${phpString(unquoteSql(raw))})`;
    } else if (/^(true|false)$/i.test(raw)) {
      code += `->default(${raw.toLowerCase()})`;
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      code += `->default(${raw})`;
    } else {
      code += `->default(${phpString(raw)})`;
    }
  }

  if (column.onUpdateCurrentTimestamp) code += "->useCurrentOnUpdate()";
  if (column.uniqueInline) code += "->unique()";
  if (column.comment) code += `->comment(${phpString(column.comment)})`;

  return code + ";";
}

function constraintToLaravel(constraint) {
  if (!constraint || !constraint.columns.length) return null;
  const cols = constraint.columns;
  const colArg = cols.length === 1 ? phpString(cols[0]) : phpArray(cols);

  if (constraint.type === "primary") return `$table->primary(${colArg});`;
  if (constraint.type === "unique")
    return `$table->unique(${colArg}${constraint.name ? `, ${phpString(constraint.name)}` : ""});`;
  if (constraint.type === "index")
    return `$table->index(${colArg}${constraint.name ? `, ${phpString(constraint.name)}` : ""});`;

  if (constraint.type === "foreign") {
    const local = cols.length === 1 ? phpString(cols[0]) : phpArray(cols);
    const refs =
      constraint.referencesColumns.length === 1
        ? phpString(constraint.referencesColumns[0])
        : phpArray(constraint.referencesColumns);
    let code = `$table->foreign(${local}${constraint.name ? `, ${phpString(constraint.name)}` : ""})->references(${refs})->on(${phpString(constraint.referencesTable)})`;
    const actions = constraint.actions.toLowerCase();

    if (/on\s+delete\s+cascade/.test(actions)) code += "->cascadeOnDelete()";
    else if (/on\s+delete\s+set\s+null/.test(actions))
      code += "->nullOnDelete()";
    else if (/on\s+delete\s+restrict/.test(actions))
      code += "->restrictOnDelete()";
    else if (/on\s+delete\s+no\s+action/.test(actions))
      code += "->noActionOnDelete()";

    if (/on\s+update\s+cascade/.test(actions)) code += "->cascadeOnUpdate()";
    else if (/on\s+update\s+set\s+null/.test(actions))
      code += "->nullOnUpdate()";
    else if (/on\s+update\s+restrict/.test(actions))
      code += "->restrictOnUpdate()";
    else if (/on\s+update\s+no\s+action/.test(actions))
      code += "->noActionOnUpdate()";

    return code + ";";
  }

  return null;
}

function convertTable(block, options, warnings) {
  const definitions = splitTopLevel(block.body, ",");
  const columns = [];
  const constraints = [];

  for (const def of definitions) {
    const trimmed = def.trim().replace(/,$/, "");
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    if (
      /^(primary\s+key|unique\s+key|unique\s+index|unique\s*\(|key\s+|index\s+|constraint\s+|foreign\s+key|check\s*\()/i.test(
        lower,
      )
    ) {
      const constraint = parseConstraint(trimmed);
      if (constraint) constraints.push(constraint);
      else
        warnings.push(
          `Skipped unsupported constraint in ${block.table}: ${trimmed}`,
        );
      continue;
    }

    const column = parseColumnDefinition(trimmed, warnings);
    if (column) columns.push(column);
  }

  const primaryColumns = constraints
    .filter((c) => c.type === "primary")
    .flatMap((c) => c.columns);
  const hasPrimaryId =
    primaryColumns.length === 1 && primaryColumns[0] === "id";
  const lines = [];
  const skippedColumns = new Set();

  const createdAt = columns.find(
    (c) => c.name === "created_at" && /timestamp|datetime/.test(c.type),
  );
  const updatedAt = columns.find(
    (c) => c.name === "updated_at" && /timestamp|datetime/.test(c.type),
  );
  if (options.combineTimestamps && createdAt && updatedAt) {
    skippedColumns.add("created_at");
    skippedColumns.add("updated_at");
  }

  const deletedAt = columns.find(
    (c) => c.name === "deleted_at" && /timestamp|datetime/.test(c.type),
  );
  if (options.combineSoftDeletes && deletedAt) skippedColumns.add("deleted_at");

  for (const column of columns) {
    if (skippedColumns.has(column.name)) continue;
    const base = methodForColumn(column, options);
    lines.push(`            ${applyModifiers(base, column)}`);
  }

  if (options.combineTimestamps && createdAt && updatedAt)
    lines.push("            $table->timestamps();");
  if (options.combineSoftDeletes && deletedAt)
    lines.push("            $table->softDeletes();");

  for (const constraint of constraints) {
    if (constraint.type === "primary" && hasPrimaryId) continue;
    const line = constraintToLaravel(constraint);
    if (line) lines.push(`            ${line}`);
  }

  if (!lines.length)
    lines.push("            // No supported columns detected.");

  return `        Schema::create(${phpString(block.table)}, function (Blueprint $table) {\n${lines.join("\n")}\n        });`;
}

function convertSql(sql) {
  const warnings = [];
  const blockedCrud = detectBlockedCrudStatements(sql);

  if (blockedCrud.length) {
    blockedCrud.forEach((item) => {
      warnings.push(
        `Blocked ${item.command} statement #${item.index}: ${item.preview || "(empty statement)"}`,
      );
    });

    return {
      code: `// Conversion blocked.\n// This tool only accepts schema DDL such as CREATE TABLE.\n// Remove CRUD/data statements like SELECT, INSERT, UPDATE, DELETE, or REPLACE before converting.`,
      blocks: [],
      warnings,
      blocked: true,
    };
  }

  const options = {
    wrapMigration: els.wrapMigration.checked,
    combineTimestamps: els.combineTimestamps.checked,
    combineSoftDeletes: els.combineSoftDeletes.checked,
    useForeignId: els.useForeignId.checked,
  };

  const blocks = findCreateTableBlocks(sql);
  const schemas = blocks.map((block) => convertTable(block, options, warnings));

  let code;
  if (!blocks.length) {
    code = "// No CREATE TABLE statement detected.";
  } else if (options.wrapMigration) {
    code = `<?php\n\nuse Illuminate\\Database\\Migrations\\Migration;\nuse Illuminate\\Database\\Schema\\Blueprint;\nuse Illuminate\\Support\\Facades\\DB;\nuse Illuminate\\Support\\Facades\\Schema;\n\nreturn new class extends Migration\n{\n    public function up(): void\n    {\n${schemas.join("\n\n")}\n    }\n\n    public function down(): void\n    {\n${blocks
      .slice()
      .reverse()
      .map(
        (block) => `        Schema::dropIfExists(${phpString(block.table)});`,
      )
      .join("\n")}\n    }\n};`;
  } else {
    code = schemas.join("\n\n");
  }

  return { code, blocks, warnings, blocked: false };
}

function updateTableList(blocks) {
  if (!blocks.length) {
    els.tableList.innerHTML =
      '<p class="text-slate-500">No tables detected yet.</p>';
    return;
  }

  els.tableList.innerHTML = blocks
    .map(
      (block, index) => `
    <div class="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/70 px-3 py-2">
      <span class="font-mono text-slate-100">${escapeHtml(block.table)}</span>
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
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function render() {
  const sql = els.sqlInput.value;
  const { code, blocks, warnings, blocked } = convertSql(sql);
  els.outputCode.textContent = code;
  if (blocked) {
    els.statusText.textContent = "Blocked: CRUD/data statement detected.";
  } else {
    els.statusText.textContent = blocks.length
      ? `${blocks.length} table${blocks.length > 1 ? "s" : ""} converted.`
      : "Paste SQL to start.";
  }
  updateTableList(blocks);
  updateWarnings(warnings);
}

const debouncedRender = debounce(render, 200);

els.sqlInput.addEventListener("input", debouncedRender);
[
  els.wrapMigration,
  els.combineTimestamps,
  els.combineSoftDeletes,
  els.useForeignId,
].forEach((input) => {
  input.addEventListener("change", render);
});

async function importSqlFile(file) {
  if (!file) return;

  const allowed = /\.(sql|txt)$/i.test(file.name);
  if (!allowed) {
    els.statusText.textContent = "Please import a .sql or .txt file.";
    return;
  }

  try {
    els.sqlInput.value = await file.text();
    render();
    els.statusText.textContent = `Imported ${file.name}.`;
  } catch (error) {
    els.statusText.textContent = "Could not read the selected file.";
  }
}

els.importFileBtn.addEventListener("click", () => {
  els.fileInput.click();
});

els.fileInput.addEventListener("change", (event) => {
  importSqlFile(event.target.files && event.target.files[0]);
  event.target.value = "";
});

els.sqlInput.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.sqlInput.classList.add("ring-2", "ring-indigo-400");
});

els.sqlInput.addEventListener("dragleave", () => {
  els.sqlInput.classList.remove("ring-2", "ring-indigo-400");
});

els.sqlInput.addEventListener("drop", (event) => {
  event.preventDefault();
  els.sqlInput.classList.remove("ring-2", "ring-indigo-400");
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  importSqlFile(file);
});

els.loadSampleBtn.addEventListener("click", () => {
  els.sqlInput.value = sampleSQL;
  render();
  els.sqlInput.focus();
});

els.clearBtn.addEventListener("click", () => {
  els.sqlInput.value = "";
  render();
  els.sqlInput.focus();
});

els.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.outputCode.textContent);
    els.copyBtn.textContent = "Copied";
    setTimeout(() => (els.copyBtn.textContent = "Copy"), 1200);
  } catch (error) {
    const range = document.createRange();
    range.selectNodeContents(els.outputCode);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    els.copyBtn.textContent = "Select output";
    setTimeout(() => (els.copyBtn.textContent = "Copy"), 1600);
  }
});

els.pasteBtn.addEventListener("click", async () => {
  try {
    els.sqlInput.value = await navigator.clipboard.readText();
    render();
  } catch (error) {
    els.statusText.textContent =
      "Browser blocked clipboard paste. Use Ctrl + V.";
  }
});

els.downloadBtn.addEventListener("click", () => {
  const blob = new Blob([els.outputCode.textContent], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "generated_laravel_migration.php";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Advanced conversion patch: required cleanup rules.
(function installAdvancedConversionPatch() {
  const NL = String.fromCharCode(10);
  const NS = String.fromCharCode(92);
  const CRUD_COMMANDS = new Set([
    "select",
    "insert",
    "update",
    "delete",
    "replace",
  ]);

  function addAdvancedControls() {
    if (document.getElementById("primaryKeyStrategy")) return;

    const optionsContainer = els.useForeignId.closest("div");
    if (!optionsContainer) return;

    optionsContainer.insertAdjacentHTML(
      "beforeend",
      `
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

    els.primaryKeyStrategy = document.getElementById("primaryKeyStrategy");
    els.zeroDateMode = document.getElementById("zeroDateMode");
    els.connectionName = document.getElementById("connectionName");
    els.ignoreCrud = document.getElementById("ignoreCrud");

    const foreignIdHelp = els.useForeignId
      .closest("label")
      .querySelector("span span + span");
    if (foreignIdHelp) {
      foreignIdHelp.textContent =
        "Only actual foreign-key columns become foreignId().";
    }

    const notesPanel = els.warningsPanel.previousElementSibling;
    const notesText = notesPanel && notesPanel.querySelector("p");
    if (notesText) {
      notesText.textContent =
        "This converter creates all tables first, then adds foreign keys in a second pass. It blocks or skips CRUD/data statements and warns about unsupported SQL features.";
    }

    [els.primaryKeyStrategy, els.zeroDateMode, els.ignoreCrud].forEach(
      (input) => {
        input.addEventListener("change", render);
      },
    );
    els.connectionName.addEventListener("input", debouncedRender);
  }

  addAdvancedControls();

  const originalMethodForColumn = methodForColumn;
  const originalApplyModifiers = applyModifiers;
  const originalConstraintToLaravel = constraintToLaravel;

  function isCrudStatement(statement) {
    return CRUD_COMMANDS.has(firstSqlCommand(statement));
  }

  function removeCrudStatements(sql) {
    const kept = splitSqlStatements(sql).filter(
      (statement) => !isCrudStatement(statement),
    );
    if (!kept.length) return "";
    return kept.join(";" + NL) + ";";
  }

  function isValidConnectionName(value) {
    if (!value) return false;
    const allowed =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-";
    for (const char of value) {
      if (!allowed.includes(char)) return false;
    }
    return true;
  }

  function schemaExpression(options) {
    return options.connectionName
      ? `Schema::connection(${phpString(options.connectionName)})`
      : "Schema";
  }

  function isZeroDateDefault(value) {
    const plain = unquoteSql(value).trim();
    return plain === "0000-00-00" || plain === "0000-00-00 00:00:00";
  }

  function sanitizeIndexColumn(column, warnings, tableName) {
    const open = column.indexOf("(");
    const close = column.lastIndexOf(")");

    if (open > 0 && close > open) {
      const baseColumn = cleanIdentifier(column.slice(0, open).trim());
      warnings.push(
        `Index prefix length detected in ${tableName}: ${column}. Laravel output uses ${baseColumn}; review manually.`,
      );
      return baseColumn;
    }

    return column;
  }

  function sanitizeConstraint(constraint, warnings, tableName) {
    if (!constraint) return null;

    if (
      constraint.type === "primary" ||
      constraint.type === "unique" ||
      constraint.type === "index"
    ) {
      return {
        ...constraint,
        columns: constraint.columns.map((column) =>
          sanitizeIndexColumn(column, warnings, tableName),
        ),
      };
    }

    return constraint;
  }

  function rewriteForeignReferenceIfNeeded(
    constraint,
    renamedPrimaryKeys,
    warnings,
  ) {
    if (!constraint || constraint.type !== "foreign") return constraint;

    const renamed = renamedPrimaryKeys[constraint.referencesTable];
    if (!renamed) return constraint;

    if (
      constraint.referencesColumns.length === 1 &&
      constraint.referencesColumns[0] === renamed.from
    ) {
      warnings.push(
        `Foreign key ${constraint.name || constraint.columns.join(", ")} references ${constraint.referencesTable}.${renamed.from}; Laravel style rewrote it to ${constraint.referencesTable}.id.`,
      );
      return {
        ...constraint,
        referencesColumns: ["id"],
      };
    }

    return constraint;
  }

  function shouldSkipUnsupportedDefinition(trimmed, tableName, warnings) {
    const lower = trimmed.toLowerCase();

    if (lower.startsWith("check")) {
      warnings.push(`Skipped CHECK constraint in ${tableName}: ${trimmed}`);
      return true;
    }

    if (lower.startsWith("fulltext") || lower.startsWith("spatial")) {
      warnings.push(`Skipped unsupported index in ${tableName}: ${trimmed}`);
      return true;
    }

    if (lower.includes("generated always") || lower.includes(" as (")) {
      warnings.push(`Skipped generated column in ${tableName}: ${trimmed}`);
      return true;
    }

    return false;
  }

  function buildOptions(warnings) {
    const rawConnectionName = els.connectionName
      ? els.connectionName.value.trim()
      : "";
    const validConnectionName =
      rawConnectionName && isValidConnectionName(rawConnectionName);

    if (rawConnectionName && !validConnectionName) {
      warnings.push(
        "Invalid connection name. Use only letters, numbers, underscore, dash, or dot. Connection wrapping was skipped.",
      );
    }

    return {
      wrapMigration: els.wrapMigration.checked,
      combineTimestamps: els.combineTimestamps.checked,
      combineSoftDeletes: els.combineSoftDeletes.checked,
      useForeignId: els.useForeignId.checked,
      primaryKeyStrategy: els.primaryKeyStrategy
        ? els.primaryKeyStrategy.value
        : "legacy",
      zeroDateMode: els.zeroDateMode ? els.zeroDateMode.value : "nullable",
      ignoreCrud: els.ignoreCrud ? els.ignoreCrud.checked : false,
      connectionName: validConnectionName ? rawConnectionName : "",
    };
  }

  methodForColumn = function patchedMethodForColumn(column, options) {
    if (column.forceLaravelId) return "$table->id()";

    const nextOptions = {
      ...options,
      useForeignId: Boolean(
        options.useForeignId &&
        options.actualForeignKeyColumns &&
        options.actualForeignKeyColumns.has(column.name),
      ),
    };

    return originalMethodForColumn(column, nextOptions);
  };

  applyModifiers = function patchedApplyModifiers(
    base,
    column,
    options,
    warnings,
  ) {
    if (
      column.defaultValue !== null &&
      isZeroDateDefault(column.defaultValue)
    ) {
      if (options.zeroDateMode === "preserve") {
        warnings.push(
          `Preserved legacy zero-date default on ${column.name}: ${column.defaultValue}. MySQL strict mode may reject this value.`,
        );
        return originalApplyModifiers(base, column);
      }

      warnings.push(
        `Converted zero-date default on ${column.name}: ${column.defaultValue}. Output uses nullable with no default.`,
      );
      return originalApplyModifiers(base, {
        ...column,
        nullable: true,
        notNull: false,
        defaultValue: null,
      });
    }

    return originalApplyModifiers(base, column);
  };

  constraintToLaravel = function patchedConstraintToLaravel(
    constraint,
    options,
    warnings,
    renamedPrimaryKeys,
  ) {
    const rewritten = rewriteForeignReferenceIfNeeded(
      constraint,
      renamedPrimaryKeys || {},
      warnings || [],
    );
    return originalConstraintToLaravel(rewritten);
  };

  convertTable = function patchedConvertTable(
    block,
    options,
    warnings,
    renamedPrimaryKeys,
  ) {
    const definitions = splitTopLevel(block.body, ",");
    const columns = [];
    const constraints = [];
    const foreignConstraints = [];

    for (const def of definitions) {
      const trimmed = def.trim().replace(/,$/, "");
      if (!trimmed) continue;
      if (shouldSkipUnsupportedDefinition(trimmed, block.table, warnings))
        continue;

      const lower = trimmed.toLowerCase();
      const isConstraint =
        lower.startsWith("primary key") ||
        lower.startsWith("unique key") ||
        lower.startsWith("unique index") ||
        lower.startsWith("unique ") ||
        lower.startsWith("key ") ||
        lower.startsWith("index ") ||
        lower.startsWith("constraint ") ||
        lower.startsWith("foreign key");

      if (isConstraint) {
        const constraint = sanitizeConstraint(
          parseConstraint(trimmed),
          warnings,
          block.table,
        );
        if (constraint) {
          constraints.push(constraint);
          if (constraint.type === "foreign")
            foreignConstraints.push(constraint);
        } else {
          warnings.push(
            `Skipped unsupported constraint in ${block.table}: ${trimmed}`,
          );
        }
        continue;
      }

      const column = parseColumnDefinition(trimmed, warnings);
      if (column) columns.push(column);
    }

    const primaryColumns = constraints
      .filter((c) => c.type === "primary")
      .flatMap((c) => c.columns);
    const autoIncrementPrimaryColumn =
      primaryColumns.length === 1
        ? columns.find((c) => c.name === primaryColumns[0] && c.autoIncrement)
        : null;
    const primaryAlreadyCreatedByIncrement = Boolean(
      autoIncrementPrimaryColumn,
    );

    if (autoIncrementPrimaryColumn) {
      if (options.primaryKeyStrategy === "laravel") {
        autoIncrementPrimaryColumn.forceLaravelId = true;
        if (autoIncrementPrimaryColumn.name !== "id") {
          renamedPrimaryKeys[block.table] = {
            from: autoIncrementPrimaryColumn.name,
            to: "id",
          };
          warnings.push(
            `Laravel style changed ${block.table}.${autoIncrementPrimaryColumn.name} to ${block.table}.id. Review related foreign keys and model code.`,
          );
        }
      } else if (autoIncrementPrimaryColumn.name !== "id") {
        warnings.push(
          `Kept legacy auto-increment primary key ${block.table}.${autoIncrementPrimaryColumn.name}.`,
        );
      }
    }

    const actualForeignKeyColumns = new Set(
      foreignConstraints.flatMap((constraint) => constraint.columns),
    );
    const tableOptions = { ...options, actualForeignKeyColumns };
    const lines = [];
    const skippedColumns = new Set();

    const createdAt = columns.find(
      (c) =>
        c.name === "created_at" &&
        (c.type.includes("timestamp") || c.type.includes("datetime")),
    );
    const updatedAt = columns.find(
      (c) =>
        c.name === "updated_at" &&
        (c.type.includes("timestamp") || c.type.includes("datetime")),
    );
    if (options.combineTimestamps && createdAt && updatedAt) {
      skippedColumns.add("created_at");
      skippedColumns.add("updated_at");
    }

    const deletedAt = columns.find(
      (c) =>
        c.name === "deleted_at" &&
        (c.type.includes("timestamp") || c.type.includes("datetime")),
    );
    if (options.combineSoftDeletes && deletedAt)
      skippedColumns.add("deleted_at");

    for (const column of columns) {
      if (skippedColumns.has(column.name)) continue;
      const base = methodForColumn(column, tableOptions);
      lines.push(
        `            ${applyModifiers(base, column, tableOptions, warnings)}`,
      );
    }

    if (options.combineTimestamps && createdAt && updatedAt)
      lines.push("            $table->timestamps();");
    if (options.combineSoftDeletes && deletedAt)
      lines.push("            $table->softDeletes();");

    for (const constraint of constraints) {
      if (constraint.type === "foreign") continue;
      if (constraint.type === "primary" && primaryAlreadyCreatedByIncrement)
        continue;

      const line = constraintToLaravel(
        constraint,
        tableOptions,
        warnings,
        renamedPrimaryKeys,
      );
      if (line) lines.push(`            ${line}`);
    }

    if (!lines.length)
      lines.push("            // No supported columns detected.");

    return {
      createCode: `        ${schemaExpression(options)}->create(${phpString(block.table)}, function (Blueprint $table) {
${lines.join(NL)}
    });`,
      foreignConstraints,
    };
  };

  function buildForeignKeyPass(
    block,
    tableResult,
    options,
    warnings,
    renamedPrimaryKeys,
  ) {
    const lines = tableResult.foreignConstraints
      .map((constraint) =>
        constraintToLaravel(constraint, options, warnings, renamedPrimaryKeys),
      )
      .filter(Boolean);

    if (!lines.length) return null;

    return `        ${schemaExpression(options)}->table(${phpString(block.table)}, function (Blueprint $table) {
${lines.map((line) => `            ${line}`).join(NL)}
    });`;
  }

  convertSql = function patchedConvertSql(sql) {
    const warnings = [];
    const options = buildOptions(warnings);
    const blockedCrud = detectBlockedCrudStatements(sql);
    let sourceSql = sql;

    if (blockedCrud.length && !options.ignoreCrud) {
      blockedCrud.forEach((item) => {
        warnings.push(
          `Blocked ${item.command} statement #${item.index}: ${item.preview || "(empty statement)"}`,
        );
      });

      return {
        code: `// Conversion blocked.
// This tool only accepts schema DDL such as CREATE TABLE.
// Enable "Ignore CRUD/data statements" to skip SELECT, INSERT, UPDATE, DELETE, or REPLACE statements.`,
        blocks: [],
        warnings,
        blocked: true,
      };
    }

    if (blockedCrud.length && options.ignoreCrud) {
      blockedCrud.forEach((item) => {
        warnings.push(
          `Ignored ${item.command} statement #${item.index}: ${item.preview || "(empty statement)"}`,
        );
      });
      sourceSql = removeCrudStatements(sql);
    }

    const blocks = findCreateTableBlocks(sourceSql);
    const renamedPrimaryKeys = {};
    const tableResults = blocks.map((block) =>
      convertTable(block, options, warnings, renamedPrimaryKeys),
    );
    const createSchemas = tableResults.map((result) => result.createCode);
    const foreignSchemas = tableResults
      .map((result, index) =>
        buildForeignKeyPass(
          blocks[index],
          result,
          options,
          warnings,
          renamedPrimaryKeys,
        ),
      )
      .filter(Boolean);
    const allSchemas = [...createSchemas, ...foreignSchemas];
    const usesDbRaw = allSchemas.some((schema) => schema.includes("DB::raw("));

    const imports = [
      "use Illuminate" +
        NS +
        "Database" +
        NS +
        "Migrations" +
        NS +
        "Migration;",
      "use Illuminate" + NS + "Database" + NS + "Schema" + NS + "Blueprint;",
      ...(usesDbRaw
        ? ["use Illuminate" + NS + "Support" + NS + "Facades" + NS + "DB;"]
        : []),
      "use Illuminate" + NS + "Support" + NS + "Facades" + NS + "Schema;",
    ].join(NL);

    let code;
    if (!blocks.length) {
      code = "// No CREATE TABLE statement detected.";
    } else if (options.wrapMigration) {
      code = `<?php

${imports}

return new class extends Migration
{
public function up(): void
{
${allSchemas.join(NL + NL)}
}

public function down(): void
{
${blocks
  .slice()
  .reverse()
  .map(
    (block) =>
      `        ${schemaExpression(options)}->dropIfExists(${phpString(block.table)});`,
  )
  .join(NL)}
}
};`;
    } else {
      code = allSchemas.join(NL + NL);
    }

    return { code, blocks, warnings, blocked: false };
  };
})();

// Final review patch: tinyint mode, date/time precision, CURRENT_TIMESTAMP precision,
// import hints, stronger rename warnings, and generated summary.
(function installFinalReviewPatch() {
  const NL = String.fromCharCode(10);

  function addFinalControls() {
    if (document.getElementById("tinyIntOneMode")) return;

    const primaryKeyBox = document.getElementById("primaryKeyStrategy")
      ? document.getElementById("primaryKeyStrategy").closest("div")
      : null;
    const target = primaryKeyBox || els.useForeignId.closest("label");
    if (!target) return;

    target.insertAdjacentHTML(
      "beforebegin",
      `
      <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
        <label for="tinyIntOneMode" class="block text-sm font-semibold text-white">tinyint(1) behavior</label>
        <p class="mt-1 text-xs leading-5 text-slate-400">Boolean is Laravel-friendly. tinyInteger is more legacy-accurate.</p>
        <select id="tinyIntOneMode" class="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30">
          <option value="boolean">Convert tinyint(1) to boolean</option>
          <option value="tinyInteger">Keep as tinyInteger</option>
        </select>
      </div>
    `,
    );

    els.tinyIntOneMode = document.getElementById("tinyIntOneMode");
    els.tinyIntOneMode.addEventListener("change", render);
  }

  addFinalControls();

  function isSmallPrecision(value) {
    const text = String(value || "").trim();
    return text.length === 1 && "0123456".includes(text);
  }

  function columnPrecision(column) {
    const args = String(column.args || "").trim();
    return isSmallPrecision(args) ? args : "";
  }

  function currentTimestampPrecision(value) {
    const text = String(value || "")
      .trim()
      .toUpperCase();
    if (!text.startsWith("CURRENT_TIMESTAMP")) return "";
    const open = text.indexOf("(");
    const close = text.indexOf(")", open + 1);
    if (open < 0 || close < 0) return "";
    const precision = text.slice(open + 1, close).trim();
    return isSmallPrecision(precision) ? precision : "";
  }

  function onUpdateCurrentTimestampPrecision(column) {
    const text = String(column.raw || column.lower || "").toUpperCase();
    const needle = "ON UPDATE CURRENT_TIMESTAMP";
    const index = text.indexOf(needle);
    if (index < 0) return "";
    const after = text.slice(index + needle.length).trim();
    if (!after.startsWith("(")) return "";
    const close = after.indexOf(")");
    if (close < 0) return "";
    const precision = after.slice(1, close).trim();
    return isSmallPrecision(precision) ? precision : "";
  }

  function countText(haystack, needle) {
    if (!needle) return 0;
    return String(haystack || "").split(needle).length - 1;
  }

  const previousMethodForColumn = methodForColumn;
  methodForColumn = function finalMethodForColumn(column, options) {
    const type = String(column.type || "").toLowerCase();
    const nameArg = phpString(column.name);
    const precision = columnPrecision(column);

    if (
      (type === "tinyint" || type === "tiny int") &&
      String(column.args || "").trim() === "1"
    ) {
      const tinyMode = els.tinyIntOneMode
        ? els.tinyIntOneMode.value
        : "boolean";
      if (tinyMode === "tinyInteger") {
        return column.unsigned
          ? `$table->unsignedTinyInteger(${nameArg})`
          : `$table->tinyInteger(${nameArg})`;
      }
    }

    if (type === "timestamp") {
      return precision
        ? `$table->timestamp(${nameArg}, ${precision})`
        : `$table->timestamp(${nameArg})`;
    }

    if (type === "datetime") {
      return precision
        ? `$table->dateTime(${nameArg}, ${precision})`
        : `$table->dateTime(${nameArg})`;
    }

    if (type === "time") {
      return precision
        ? `$table->time(${nameArg}, ${precision})`
        : `$table->time(${nameArg})`;
    }

    return previousMethodForColumn(column, options);
  };

  const previousApplyModifiers = applyModifiers;
  applyModifiers = function finalApplyModifiers(
    base,
    column,
    options,
    warnings,
  ) {
    let actualOptions = options;
    let actualWarnings = warnings;

    if (Array.isArray(options) && !warnings) {
      actualWarnings = options;
      actualOptions = {};
    }

    actualWarnings = actualWarnings || [];
    actualOptions = actualOptions || {};

    const nextColumn = { ...column };
    const columnP = columnPrecision(column);
    const defaultP = currentTimestampPrecision(nextColumn.defaultValue);
    const updateP = onUpdateCurrentTimestampPrecision(nextColumn);

    if (defaultP) {
      nextColumn.defaultValue = "CURRENT_TIMESTAMP";
      if (!columnP) {
        actualWarnings.push(
          `CURRENT_TIMESTAMP(${defaultP}) detected on ${nextColumn.name}, but the column type has no precision. Review manually.`,
        );
      }
    }

    if (
      String(nextColumn.raw || nextColumn.lower || "")
        .toUpperCase()
        .includes("ON UPDATE CURRENT_TIMESTAMP")
    ) {
      nextColumn.onUpdateCurrentTimestamp = true;
      if (updateP && !columnP) {
        actualWarnings.push(
          `ON UPDATE CURRENT_TIMESTAMP(${updateP}) detected on ${nextColumn.name}, but the column type has no precision. Review manually.`,
        );
      }
    }

    return previousApplyModifiers(
      base,
      nextColumn,
      actualOptions,
      actualWarnings,
    );
  };

  const previousConvertSql = convertSql;
  convertSql = function finalConvertSql(sql) {
    const result = previousConvertSql(sql);
    const warnings = (result.warnings || []).map((message) => {
      if (
        message.includes("Laravel style changed") &&
        !message.includes(
          "Related application code/model references must be updated manually",
        )
      ) {
        return (
          message +
          " Related application code/model references must be updated manually; schema conversion alone cannot safely rename code references."
        );
      }
      return message;
    });

    let code = result.code || "";
    const wrapMigration = els.wrapMigration ? els.wrapMigration.checked : true;
    const hasDbRaw = code.includes("DB::raw(");
    const blocked = Boolean(result.blocked);
    const tableCount = result.blocks ? result.blocks.length : 0;

    if (!blocked && tableCount > 0) {
      const zeroDateConverted = warnings.filter((message) =>
        message.includes("Converted zero-date default"),
      ).length;
      const legacyPkRenamed = warnings.filter((message) =>
        message.includes("Laravel style changed"),
      ).length;
      const unsupportedSkipped = warnings.filter(
        (message) =>
          message.includes("Skipped CHECK") ||
          message.includes("Skipped generated column") ||
          message.includes("Skipped unsupported"),
      ).length;
      const foreignKeysMoved = countText(code, "->foreign(");

      const summaryLines = [
        "Generated output summary:",
        `Tables converted: ${tableCount}`,
        `Foreign keys moved to second pass: ${foreignKeysMoved}`,
        `Zero dates converted: ${zeroDateConverted}`,
        `Legacy PK renamed to id: ${legacyPkRenamed}`,
        `Unsupported constraints skipped: ${unsupportedSkipped}`,
      ];

      if (!wrapMigration && hasDbRaw) {
        summaryLines.push("Requires: use Illuminate\Support\Facades\DB;");
        warnings.push(
          "Output contains DB::raw() but migration wrapper is off. Add: use Illuminate\Support\Facades\DB;",
        );
      }

      if (code.startsWith("<?php")) {
        code =
          "<?php" +
          NL +
          NL +
          "/*" +
          NL +
          summaryLines.map((line) => " * " + line).join(NL) +
          NL +
          " */" +
          code.slice(5);
      } else {
        code =
          summaryLines.map((line) => "// " + line).join(NL) + NL + NL + code;
      }
    }

    return {
      ...result,
      code,
      warnings,
    };
  };
})();

// Inline primary-key patch: handles `unique_id int AUTO_INCREMENT PRIMARY KEY`.
(function installInlinePrimaryKeyPatch() {
  const NL = String.fromCharCode(10);

  function localSchemaExpression(options) {
    return options.connectionName
      ? `Schema::connection(${phpString(options.connectionName)})`
      : "Schema";
  }

  function localSanitizeIndexColumn(column, warnings, tableName) {
    const open = column.indexOf("(");
    const close = column.lastIndexOf(")");

    if (open > 0 && close > open) {
      const baseColumn = cleanIdentifier(column.slice(0, open).trim());
      warnings.push(
        `Index prefix length detected in ${tableName}: ${column}. Laravel output uses ${baseColumn}; review manually.`,
      );
      return baseColumn;
    }

    return column;
  }

  function localSanitizeConstraint(constraint, warnings, tableName) {
    if (!constraint) return null;

    if (
      constraint.type === "primary" ||
      constraint.type === "unique" ||
      constraint.type === "index"
    ) {
      return {
        ...constraint,
        columns: constraint.columns.map((column) =>
          localSanitizeIndexColumn(column, warnings, tableName),
        ),
      };
    }

    return constraint;
  }

  function shouldSkipUnsupportedDefinitionInline(trimmed, tableName, warnings) {
    const lower = trimmed.toLowerCase();

    if (lower.startsWith("check")) {
      warnings.push(`Skipped CHECK constraint in ${tableName}: ${trimmed}`);
      return true;
    }

    if (lower.startsWith("fulltext") || lower.startsWith("spatial")) {
      warnings.push(`Skipped unsupported index in ${tableName}: ${trimmed}`);
      return true;
    }

    if (lower.includes("generated always") || lower.includes(" as (")) {
      warnings.push(`Skipped generated column in ${tableName}: ${trimmed}`);
      return true;
    }

    return false;
  }

  function isConstraintDefinition(trimmed) {
    const lower = trimmed.toLowerCase();
    return (
      lower.startsWith("primary key") ||
      lower.startsWith("unique key") ||
      lower.startsWith("unique index") ||
      lower.startsWith("unique ") ||
      lower.startsWith("key ") ||
      lower.startsWith("index ") ||
      lower.startsWith("constraint ") ||
      lower.startsWith("foreign key")
    );
  }

  const previousInlineMethodForColumn = methodForColumn;
  methodForColumn = function inlineAwareMethodForColumn(column, options) {
    if (
      options &&
      options.primaryKeyStrategy === "laravel" &&
      column.autoIncrement &&
      column.primaryInline
    ) {
      return "$table->id()";
    }

    return previousInlineMethodForColumn(column, options);
  };

  convertTable = function inlineAwareConvertTable(
    block,
    options,
    warnings,
    renamedPrimaryKeys,
  ) {
    const definitions = splitTopLevel(block.body, ",");
    const columns = [];
    const constraints = [];
    const foreignConstraints = [];

    for (const def of definitions) {
      const trimmed = def.trim().replace(/,$/, "");
      if (!trimmed) continue;
      if (shouldSkipUnsupportedDefinitionInline(trimmed, block.table, warnings))
        continue;

      if (isConstraintDefinition(trimmed)) {
        const constraint = localSanitizeConstraint(
          parseConstraint(trimmed),
          warnings,
          block.table,
        );
        if (constraint) {
          constraints.push(constraint);
          if (constraint.type === "foreign")
            foreignConstraints.push(constraint);
        } else {
          warnings.push(
            `Skipped unsupported constraint in ${block.table}: ${trimmed}`,
          );
        }
        continue;
      }

      const column = parseColumnDefinition(trimmed, warnings);
      if (column) columns.push(column);
    }

    const primaryColumns = constraints
      .filter((c) => c.type === "primary")
      .flatMap((c) => c.columns);
    const tableLevelAutoIncrementPrimary =
      primaryColumns.length === 1
        ? columns.find((c) => c.name === primaryColumns[0] && c.autoIncrement)
        : null;
    const inlineAutoIncrementPrimaryColumns = columns.filter(
      (c) => c.autoIncrement && c.primaryInline,
    );
    const inlineAutoIncrementPrimary =
      inlineAutoIncrementPrimaryColumns.length === 1
        ? inlineAutoIncrementPrimaryColumns[0]
        : null;
    const autoIncrementPrimaryColumn =
      tableLevelAutoIncrementPrimary || inlineAutoIncrementPrimary;
    const primaryAlreadyCreatedByIncrement = Boolean(
      autoIncrementPrimaryColumn,
    );

    if (inlineAutoIncrementPrimaryColumns.length > 1) {
      warnings.push(
        `Multiple inline auto-increment primary keys detected in ${block.table}. Review manually.`,
      );
    }

    if (autoIncrementPrimaryColumn) {
      if (options.primaryKeyStrategy === "laravel") {
        autoIncrementPrimaryColumn.forceLaravelId = true;

        if (autoIncrementPrimaryColumn.name !== "id") {
          renamedPrimaryKeys[block.table] = {
            from: autoIncrementPrimaryColumn.name,
            to: "id",
          };
          warnings.push(
            `Laravel style changed ${block.table}.${autoIncrementPrimaryColumn.name} to ${block.table}.id. Related application code/model references must be updated manually; schema conversion alone cannot safely rename code references.`,
          );
        }
      } else if (autoIncrementPrimaryColumn.name !== "id") {
        warnings.push(
          `Kept legacy auto-increment primary key ${block.table}.${autoIncrementPrimaryColumn.name}.`,
        );
      }
    }

    const actualForeignKeyColumns = new Set(
      foreignConstraints.flatMap((constraint) => constraint.columns),
    );
    const tableOptions = { ...options, actualForeignKeyColumns };
    const lines = [];
    const skippedColumns = new Set();

    const createdAt = columns.find(
      (c) =>
        c.name === "created_at" &&
        (c.type.includes("timestamp") || c.type.includes("datetime")),
    );
    const updatedAt = columns.find(
      (c) =>
        c.name === "updated_at" &&
        (c.type.includes("timestamp") || c.type.includes("datetime")),
    );
    if (options.combineTimestamps && createdAt && updatedAt) {
      skippedColumns.add("created_at");
      skippedColumns.add("updated_at");
    }

    const deletedAt = columns.find(
      (c) =>
        c.name === "deleted_at" &&
        (c.type.includes("timestamp") || c.type.includes("datetime")),
    );
    if (options.combineSoftDeletes && deletedAt)
      skippedColumns.add("deleted_at");

    for (const column of columns) {
      if (skippedColumns.has(column.name)) continue;
      const base = methodForColumn(column, tableOptions);
      lines.push(
        `            ${applyModifiers(base, column, tableOptions, warnings)}`,
      );
    }

    if (options.combineTimestamps && createdAt && updatedAt)
      lines.push("            $table->timestamps();");
    if (options.combineSoftDeletes && deletedAt)
      lines.push("            $table->softDeletes();");

    for (const constraint of constraints) {
      if (constraint.type === "foreign") continue;
      if (constraint.type === "primary" && primaryAlreadyCreatedByIncrement)
        continue;

      const line = constraintToLaravel(
        constraint,
        tableOptions,
        warnings,
        renamedPrimaryKeys,
      );
      if (line) lines.push(`            ${line}`);
    }

    if (!lines.length)
      lines.push("            // No supported columns detected.");

    return {
      createCode: `        ${localSchemaExpression(options)}->create(${phpString(block.table)}, function (Blueprint $table) {
${lines.join(NL)}
    });`,
      foreignConstraints,
    };
  };
})();

// UI/UX enhancement patch.
(function installUxEnhancementPatch() {
  const NL = String.fromCharCode(10);

  function countOccurrences(text, needle) {
    if (!needle) return 0;
    return String(text || "").split(needle).length - 1;
  }

  function createStyle() {
    return;
  }

  function enhanceLayout() {
    const header = document.querySelector("header");
    const main = document.querySelector("main");
    const editorGrid = document.querySelector("main section.grid");
    const panels = editorGrid
      ? editorGrid.querySelectorAll(":scope > div")
      : [];

    if (editorGrid) editorGrid.id = "editorGrid";
    if (panels[0]) panels[0].id = "inputPanel";
    if (panels[1]) panels[1].id = "outputPanel";

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
        `
        <button id="formatSqlBtn" class="rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/30">Format</button>
      `,
      );
    }

    if (els.copyBtn && !document.getElementById("copyInputBtn")) {
      els.copyBtn.insertAdjacentHTML(
        "beforebegin",
        `
        <button id="copyInputBtn" class="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700">Copy SQL</button>
      `,
      );
    }

    if (main && !document.getElementById("uxShortcutHint")) {
      main.insertAdjacentHTML(
        "afterend",
        `
        <div id="uxShortcutHint" class="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs leading-5 text-slate-400">
          Shortcuts: <span class="font-semibold text-slate-200">Ctrl/⌘ + Enter</span> copy output, <span class="font-semibold text-slate-200">Ctrl/⌘ + K</span> focus SQL input, <span class="font-semibold text-slate-200">Esc</span> return to split view.
        </div>
      `,
      );
    }
  }

  function createToast() {
    if (document.getElementById("uxToast")) return;

    document.body.insertAdjacentHTML(
      "beforeend",
      `
      <div id="uxToast" class="pointer-events-none fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 px-4 py-3 text-sm font-semibold text-white opacity-0 shadow-2xl shadow-black/40 transition duration-200" style="transform: translateY(12px)"></div>
    `,
    );
  }

  function showToast(message) {
    const toast = document.getElementById("uxToast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("ux-toast-show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.classList.remove("ux-toast-show");
    }, 1600);
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
    const raw = els.sqlInput.value.trim();
    if (!raw) {
      showToast("Nothing to format");
      return;
    }

    const statements = splitSqlStatements(raw)
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) =>
        statement.endsWith(";") ? statement : statement + ";",
      );

    els.sqlInput.value = statements.join(NL + NL);
    render();
    showToast("SQL statement spacing formatted");
  }

  function updateUxStats() {
    const code = els.outputCode.textContent || "";
    const sql = els.sqlInput.value || "";
    const tableCount = els.tableList.querySelectorAll("div").length;
    const warningCount = els.warningsList.querySelectorAll("li").length;
    const fkCount = countOccurrences(code, "->foreign(");
    const blocked = code.includes("Conversion blocked");
    const sqlKb = Math.max(0, sql.length / 1024);

    const tablesEl = document.getElementById("uxTablesCount");
    const fkEl = document.getElementById("uxForeignKeyCount");
    const warningsEl = document.getElementById("uxWarningsCount");
    const sizeEl = document.getElementById("uxSqlSize");
    const statusEl = document.getElementById("uxStatusLabel");
    const statusCard = document.getElementById("uxStatusCard");

    if (tablesEl) tablesEl.textContent = String(tableCount);
    if (fkEl) fkEl.textContent = String(fkCount);
    if (warningsEl) warningsEl.textContent = String(warningCount);
    if (sizeEl)
      sizeEl.textContent =
        sqlKb < 1 ? `${Math.round(sql.length)} B` : `${sqlKb.toFixed(1)} KB`;

    if (statusEl) {
      statusEl.textContent = blocked
        ? "Blocked"
        : warningCount > 0
          ? "Review"
          : tableCount > 0
            ? "Clean"
            : "Ready";
      statusEl.className =
        "mt-1 text-lg font-bold " +
        (blocked
          ? "text-red-300"
          : warningCount > 0
            ? "text-amber-300"
            : tableCount > 0
              ? "text-emerald-300"
              : "text-slate-300");
    }

    if (statusCard) {
      statusCard.className =
        "rounded-2xl border p-4 shadow-xl shadow-black/10 " +
        (blocked
          ? "border-red-400/30 bg-red-500/10"
          : warningCount > 0
            ? "border-amber-400/30 bg-amber-500/10"
            : "border-white/10 bg-white/[0.05]");
    }
  }

  function wireUxEvents() {
    const formatBtn = document.getElementById("formatSqlBtn");
    const copyInputBtn = document.getElementById("copyInputBtn");

    if (formatBtn && !formatBtn.dataset.wired) {
      formatBtn.dataset.wired = "1";
      formatBtn.addEventListener("click", formatSqlInput);
    }

    if (copyInputBtn && !copyInputBtn.dataset.wired) {
      copyInputBtn.dataset.wired = "1";
      copyInputBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(els.sqlInput.value);
          showToast("SQL copied");
        } catch (error) {
          showToast("Clipboard blocked");
        }
      });
    }

    document.querySelectorAll("#uxViewButtons button").forEach((button) => {
      if (button.dataset.wired) return;
      button.dataset.wired = "1";
      button.addEventListener("click", () => setViewMode(button.dataset.view));
    });

    if (!document.body.dataset.uxGlobalShortcuts) {
      document.body.dataset.uxGlobalShortcuts = "1";
      document.addEventListener("keydown", (event) => {
        const command = event.ctrlKey || event.metaKey;

        if (command && event.key === "Enter") {
          event.preventDefault();
          els.copyBtn.click();
          showToast("Output copied");
        }

        if (command && event.key.toLowerCase() === "k") {
          event.preventDefault();
          setViewMode("input");
          els.sqlInput.focus();
        }

        if (event.key === "Escape") {
          setViewMode("split");
        }
      });
    }

    if (!els.copyBtn.dataset.uxToast) {
      els.copyBtn.dataset.uxToast = "1";
      els.copyBtn.addEventListener("click", () => showToast("Output copied"));
    }

    if (!els.downloadBtn.dataset.uxToast) {
      els.downloadBtn.dataset.uxToast = "1";
      els.downloadBtn.addEventListener("click", () =>
        showToast("Migration file downloaded"),
      );
    }
  }

  createStyle();
  enhanceLayout();
  createToast();
  wireUxEvents();

  const previousRender = render;
  render = function uxRender() {
    previousRender();
    updateUxStats();
    wireUxEvents();
  };
})();

render();
