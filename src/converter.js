(function initConverter(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SqlLaravelConverter = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function buildConverter() {
  const CRUD_COMMANDS = new Set([
    "select",
    "insert",
    "update",
    "delete",
    "replace",
  ]);

  const DEFAULT_OPTIONS = Object.freeze({
    wrapMigration: true,
    combineTimestamps: true,
    combineSoftDeletes: true,
    useForeignId: false,
    primaryKeyStrategy: "legacy",
    tinyIntOneMode: "boolean",
    zeroDateMode: "nullable",
    connectionName: "",
    ignoreCrud: false,
  });

  function normalizeOptions(options) {
    const merged = Object.assign({}, DEFAULT_OPTIONS, options || {});

    merged.wrapMigration = merged.wrapMigration !== false;
    merged.combineTimestamps = merged.combineTimestamps !== false;
    merged.combineSoftDeletes = merged.combineSoftDeletes !== false;
    merged.useForeignId = merged.useForeignId === true;
    merged.ignoreCrud = merged.ignoreCrud === true;

    if (!["legacy", "laravel"].includes(merged.primaryKeyStrategy)) {
      merged.primaryKeyStrategy = DEFAULT_OPTIONS.primaryKeyStrategy;
    }

    if (!["boolean", "tinyInteger"].includes(merged.tinyIntOneMode)) {
      merged.tinyIntOneMode = DEFAULT_OPTIONS.tinyIntOneMode;
    }

    if (!["nullable", "preserve"].includes(merged.zeroDateMode)) {
      merged.zeroDateMode = DEFAULT_OPTIONS.zeroDateMode;
    }

    merged.connectionName = String(merged.connectionName || "").trim();

    return merged;
  }

  function stripSqlComments(sql) {
    return String(sql || "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "")
      .replace(/^\s*#.*$/gm, "");
  }

  function cleanIdentifier(value) {
    if (!value) return "";
    let name = String(value).trim();
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

  function columnArgument(columns) {
    return columns.length === 1 ? phpString(columns[0]) : phpArray(columns);
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
        if (current.trim()) parts.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function extractIdentifiers(input) {
    return splitTopLevel(input, ",")
      .map((item) => cleanIdentifier(item))
      .filter(Boolean);
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

  function detectCrudStatements(sql) {
    return splitSqlStatements(sql)
      .map((statement, index) => {
        const command = firstSqlCommand(statement);
        if (!CRUD_COMMANDS.has(command)) return null;

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

  function removeCrudStatements(sql, warnings) {
    const kept = [];

    splitSqlStatements(sql).forEach((statement, index) => {
      const command = firstSqlCommand(statement);
      if (CRUD_COMMANDS.has(command)) {
        warnings.push(
          `Ignored ${command.toUpperCase()} statement #${index + 1}: ${
            stripSqlComments(statement).replace(/\s+/g, " ").trim() ||
            "(empty statement)"
          }`,
        );
      } else {
        kept.push(statement);
      }
    });

    return kept.length ? `${kept.join(";\n")};` : "";
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

      if (closeParenIndex === -1) continue;

      const body = cleaned.slice(openParenIndex + 1, closeParenIndex);
      blocks.push({
        table,
        body,
        definitions: splitTopLevel(body, ","),
      });
      regex.lastIndex = closeParenIndex + 1;
    }

    return blocks;
  }

  function readType(rest) {
    const knownTypes = [
      "double precision",
      "mediumint",
      "mediumtext",
      "longtext",
      "tinyint",
      "smallint",
      "bigint",
      "integer",
      "varchar",
      "datetime",
      "timestamp",
      "decimal",
      "boolean",
      "mediumblob",
      "longblob",
      "tinyblob",
      "tinytext",
      "varbinary",
      "unsigned",
      "binary",
      "float",
      "double",
      "enum",
      "char",
      "text",
      "json",
      "date",
      "time",
      "blob",
      "int",
      "bit",
      "bool",
    ];

    const lower = rest.toLowerCase().trimStart();
    const typeName =
      knownTypes.find(
        (type) =>
          lower === type ||
          lower.startsWith(`${type} `) ||
          lower.startsWith(`${type}(`),
      ) || "";

    if (!typeName) return null;

    let remaining = rest.trimStart().slice(typeName.length).trimStart();
    let args = "";

    if (remaining.startsWith("(")) {
      let depth = 0;
      let quote = null;
      let escaped = false;

      for (let i = 0; i < remaining.length; i++) {
        const ch = remaining[i];

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
          args = remaining.slice(1, i);
          remaining = remaining.slice(i + 1).trimStart();
          break;
        }
      }
    }

    return {
      type: typeName,
      args,
      rest: remaining,
    };
  }

  function readDefault(rest) {
    const match = rest.match(
      /\bdefault\s+((?:'[^']*(?:\\.[^']*)*')|(?:"[^"]*(?:\\.[^"]*)*")|(?:\([^)]+\))|(?:[^\s,]+))/i,
    );
    return match ? match[1] : null;
  }

  function readComment(rest) {
    const match = rest.match(/\bcomment\s+('([^']*(?:\\.[^']*)*)'|"([^"]*)")/i);
    if (!match) return "";
    return unquoteSql(match[1]);
  }

  function unquoteSql(value) {
    const text = String(value || "").trim();
    if (
      (text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"'))
    ) {
      return text
        .slice(1, -1)
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    return text;
  }

  function parseColumnDefinition(line, warnings) {
    const trimmed = line.trim();
    const match = trimmed.match(
      /^((?:`[^`]+`)|(?:"[^"]+")|(?:'[^']+')|(?:[a-zA-Z0-9_]+))\s+([\s\S]+)$/i,
    );

    if (!match) {
      warnings.push(`Could not parse column definition: ${trimmed}`);
      return null;
    }

    const name = cleanIdentifier(match[1]);
    const typeInfo = readType(match[2]);

    if (!typeInfo) {
      warnings.push(`Could not detect type for column: ${name}`);
      return null;
    }

    const rest = typeInfo.rest;
    const lower = rest.toLowerCase();

    return {
      name,
      type: typeInfo.type.toLowerCase(),
      args: typeInfo.args,
      rest,
      raw: trimmed,
      lower: `${typeInfo.type} ${rest}`.toLowerCase(),
      unsigned: /\bunsigned\b/i.test(rest),
      nullable: /\bnull\b/i.test(rest) && !/\bnot\s+null\b/i.test(rest),
      autoIncrement: /\bauto_increment\b/i.test(rest),
      primaryInline: /\bprimary\s+key\b/i.test(rest),
      uniqueInline: /\bunique\b/i.test(rest),
      defaultValue: readDefault(rest),
      comment: readComment(rest),
      onUpdateCurrentTimestamp: /\bon\s+update\s+current_timestamp/i.test(lower),
    };
  }

  function parseConstraint(line) {
    const normalized = line.trim().replace(/\s+/g, " ");

    const primaryMatch = normalized.match(/^primary\s+key\s*\(([^)]+)\)/i);
    if (primaryMatch) {
      return {
        type: "primary",
        columns: extractIdentifiers(primaryMatch[1]),
      };
    }

    const uniqueMatch = normalized.match(
      /^unique(?:\s+(?:key|index))?\s+(?:(`[^`]+`|"[^"]+"|'[^']+'|[a-zA-Z0-9_]+)\s+)?\(([^)]+)\)/i,
    );
    if (uniqueMatch) {
      return {
        type: "unique",
        name: uniqueMatch[1] ? cleanIdentifier(uniqueMatch[1]) : null,
        columns: extractIdentifiers(uniqueMatch[2]),
      };
    }

    const indexMatch = normalized.match(
      /^(?:key|index)\s+(?:(`[^`]+`|"[^"]+"|'[^']+'|[a-zA-Z0-9_]+)\s+)?\(([^)]+)\)/i,
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

  function isConstraintDefinition(trimmed) {
    return /^(primary\s+key|unique\s+key|unique\s+index|unique\s*\(|key\s+|index\s+|constraint\s+|foreign\s+key|check\s*\()/i.test(
      trimmed,
    );
  }

  function shouldSkipUnsupportedDefinition(trimmed, tableName, warnings) {
    if (/^check\s*\(/i.test(trimmed)) {
      warnings.push(`Skipped CHECK constraint in ${tableName}: ${trimmed}`);
      return true;
    }

    if (/\b(fulltext|spatial)\b/i.test(trimmed)) {
      warnings.push(`Skipped unsupported index in ${tableName}: ${trimmed}`);
      return true;
    }

    if (/\b(generated\s+always| as \()/i.test(trimmed)) {
      warnings.push(`Skipped generated column in ${tableName}: ${trimmed}`);
      return true;
    }

    return false;
  }

  function isZeroDateDefault(value) {
    return /^['"]?0{4}-0{2}-0{2}(?:\s+0{2}:0{2}:0{2})?['"]?$/i.test(
      String(value || "").trim(),
    );
  }

  function isCurrentTimestamp(value) {
    return /^current_timestamp(?:\([0-6]\))?$/i.test(
      String(value || "").trim(),
    );
  }

  function isNumericDefault(value) {
    return /^-?\d+(?:\.\d+)?$/.test(String(value || "").trim());
  }

  function typeMethod(column, options, tableContext) {
    const nameArg = phpString(column.name);
    const type = column.type;
    const args = column.args;
    const unsigned = column.unsigned;

    if (column.autoIncrement) {
      if (
        options.primaryKeyStrategy === "laravel" &&
        tableContext.primaryKeyColumns.length === 1 &&
        tableContext.primaryKeyColumns[0] === column.name
      ) {
        return "$table->id()";
      }

      if (type === "bigint") return `$table->bigIncrements(${nameArg})`;
      if (["int", "integer"].includes(type)) return `$table->increments(${nameArg})`;
      if (type === "smallint") return `$table->smallIncrements(${nameArg})`;
      if (type === "tinyint") return `$table->tinyIncrements(${nameArg})`;
    }

    if (
      options.useForeignId &&
      tableContext.foreignKeyColumns.has(column.name) &&
      type === "bigint" &&
      unsigned
    ) {
      return `$table->foreignId(${nameArg})`;
    }

    if (type === "bigint")
      return unsigned
        ? `$table->unsignedBigInteger(${nameArg})`
        : `$table->bigInteger(${nameArg})`;
    if (["int", "integer"].includes(type))
      return unsigned
        ? `$table->unsignedInteger(${nameArg})`
        : `$table->integer(${nameArg})`;
    if (type === "smallint")
      return unsigned
        ? `$table->unsignedSmallInteger(${nameArg})`
        : `$table->smallInteger(${nameArg})`;
    if (type === "mediumint")
      return unsigned
        ? `$table->unsignedMediumInteger(${nameArg})`
        : `$table->mediumInteger(${nameArg})`;
    if (type === "tinyint") {
      if (String(args).trim() === "1" && options.tinyIntOneMode === "boolean") {
        return `$table->boolean(${nameArg})`;
      }
      return unsigned
        ? `$table->unsignedTinyInteger(${nameArg})`
        : `$table->tinyInteger(${nameArg})`;
    }

    if (type === "varchar") {
      const length = String(args || "255").trim() || "255";
      return `$table->string(${nameArg}, ${length})`;
    }
    if (type === "char") {
      const length = String(args || "255").trim() || "255";
      return `$table->char(${nameArg}, ${length})`;
    }
    if (type === "text" || type === "tinytext") return `$table->text(${nameArg})`;
    if (type === "mediumtext") return `$table->mediumText(${nameArg})`;
    if (type === "longtext") return `$table->longText(${nameArg})`;
    if (type === "json") return `$table->json(${nameArg})`;
    if (type === "date") return `$table->date(${nameArg})`;
    if (type === "time") return `$table->time(${nameArg})`;
    if (type === "datetime") return precisionMethod("dateTime", nameArg, args);
    if (type === "timestamp") return precisionMethod("timestamp", nameArg, args);
    if (type === "decimal") return numericMethod("decimal", nameArg, args, "8, 2");
    if (type === "float") return numericMethod("float", nameArg, args, "");
    if (type === "double" || type === "double precision")
      return numericMethod("double", nameArg, args, "");
    if (type === "enum") return `$table->enum(${nameArg}, ${phpArray(splitEnumArgs(args))})`;
    if (type === "bool" || type === "boolean" || type === "bit")
      return `$table->boolean(${nameArg})`;
    if (
      ["blob", "tinyblob", "mediumblob", "longblob", "binary", "varbinary"].includes(
        type,
      )
    ) {
      return `$table->binary(${nameArg})`;
    }

    return `$table->string(${nameArg})`;
  }

  function precisionMethod(method, nameArg, args) {
    const precision = String(args || "").trim();
    return precision && /^[0-6]$/.test(precision)
      ? `$table->${method}(${nameArg}, ${precision})`
      : `$table->${method}(${nameArg})`;
  }

  function numericMethod(method, nameArg, args, fallback) {
    const cleaned = String(args || "").trim() || fallback;
    return cleaned
      ? `$table->${method}(${nameArg}, ${cleaned})`
      : `$table->${method}(${nameArg})`;
  }

  function splitEnumArgs(args) {
    return splitTopLevel(args || "", ",").map(unquoteSql);
  }

  function applyModifiers(base, column, options, warnings, tableName) {
    let code = base;
    let nullable = column.nullable;
    const defaultValue = column.defaultValue;

    if (
      defaultValue !== null &&
      options.zeroDateMode === "nullable" &&
      isZeroDateDefault(defaultValue)
    ) {
      nullable = true;
      warnings.push(
        `Converted zero-date default on ${tableName}.${column.name} to nullable with no default.`,
      );
    }

    if (nullable) code += "->nullable()";

    if (
      defaultValue !== null &&
      !(options.zeroDateMode === "nullable" && isZeroDateDefault(defaultValue)) &&
      !/^null$/i.test(String(defaultValue).trim()) &&
      !column.autoIncrement
    ) {
      code += defaultModifier(defaultValue);
    }

    if (column.onUpdateCurrentTimestamp) code += "->useCurrentOnUpdate()";
    if (column.uniqueInline) code += "->unique()";
    if (column.comment) code += `->comment(${phpString(column.comment)})`;

    return `${code};`;
  }

  function defaultModifier(value) {
    const raw = String(value).trim();
    const lower = raw.toLowerCase();

    if (isCurrentTimestamp(raw)) return "->useCurrent()";
    if (isNumericDefault(raw)) return `->default(${raw})`;
    if (lower === "true" || lower === "false") return `->default(${lower})`;
    if (raw.startsWith("(") && raw.endsWith(")")) {
      return `->default(DB::raw(${phpString(raw.slice(1, -1))}))`;
    }

    return `->default(${phpString(unquoteSql(raw))})`;
  }

  function constraintToLaravel(constraint, options, warnings, renamedPrimaryKeys) {
    if (!constraint || !constraint.columns || !constraint.columns.length) {
      return "";
    }

    if (constraint.type === "primary") {
      return `$table->primary(${columnArgument(constraint.columns)});`;
    }

    if (constraint.type === "unique") {
      return `$table->unique(${columnArgument(constraint.columns)}${
        constraint.name ? `, ${phpString(constraint.name)}` : ""
      });`;
    }

    if (constraint.type === "index") {
      return `$table->index(${columnArgument(constraint.columns)}${
        constraint.name ? `, ${phpString(constraint.name)}` : ""
      });`;
    }

    if (constraint.type === "foreign") {
      const rewritten = rewriteForeignReference(
        constraint,
        warnings,
        renamedPrimaryKeys,
      );
      let code = `$table->foreign(${columnArgument(rewritten.columns)}${
        rewritten.name ? `, ${phpString(rewritten.name)}` : ""
      })->references(${columnArgument(rewritten.referencesColumns)})->on(${phpString(
        rewritten.referencesTable,
      )})`;

      code += foreignActionModifiers(rewritten.actions);
      return `${code};`;
    }

    return "";
  }

  function rewriteForeignReference(constraint, warnings, renamedPrimaryKeys) {
    const renamed = renamedPrimaryKeys[constraint.referencesTable];
    if (!renamed) return constraint;

    const referencesColumns = constraint.referencesColumns.map((column) =>
      column === renamed.from ? renamed.to : column,
    );

    if (referencesColumns.join("|") !== constraint.referencesColumns.join("|")) {
      warnings.push(
        `Rewrote foreign key reference ${constraint.referencesTable}.${renamed.from} to ${constraint.referencesTable}.${renamed.to} because Laravel primary key strategy is enabled.`,
      );
    }

    return Object.assign({}, constraint, { referencesColumns });
  }

  function foreignActionModifiers(actions) {
    const text = String(actions || "").toLowerCase();
    let code = "";

    const deleteMatch = text.match(/on\s+delete\s+(cascade|set\s+null|restrict|no\s+action)/i);
    if (deleteMatch) {
      code += actionModifier(deleteMatch[1], "Delete");
    }

    const updateMatch = text.match(/on\s+update\s+(cascade|set\s+null|restrict|no\s+action)/i);
    if (updateMatch) {
      code += actionModifier(updateMatch[1], "Update");
    }

    return code;
  }

  function actionModifier(action, suffix) {
    const normalized = action.toLowerCase().replace(/\s+/g, " ");
    if (normalized === "cascade") return `->cascadeOn${suffix}()`;
    if (normalized === "set null") return `->nullOn${suffix}()`;
    if (normalized === "restrict") return `->restrictOn${suffix}()`;
    return `->noActionOn${suffix}()`;
  }

  function schemaExpression(options, warnings) {
    if (!options.connectionName) return "Schema";

    if (!/^[a-zA-Z0-9_.-]+$/.test(options.connectionName)) {
      warnings.push(
        `Ignored invalid connection name "${options.connectionName}". Use letters, numbers, dots, underscores, or hyphens.`,
      );
      return "Schema";
    }

    return `Schema::connection(${phpString(options.connectionName)})`;
  }

  function detectRenamedPrimaryKeys(blocks, options, warnings) {
    const renamed = {};
    if (options.primaryKeyStrategy !== "laravel") return renamed;

    blocks.forEach((block) => {
      const columns = [];
      const primaryColumns = [];

      block.definitions.forEach((definition) => {
        const trimmed = definition.trim();
        if (!trimmed) return;

        if (isConstraintDefinition(trimmed)) {
          const constraint = parseConstraint(trimmed);
          if (constraint && constraint.type === "primary") {
            primaryColumns.push(...constraint.columns);
          }
          return;
        }

        const column = parseColumnDefinition(trimmed, []);
        if (!column) return;
        columns.push(column);
        if (column.primaryInline) primaryColumns.push(column.name);
      });

      const autoPrimary = columns.filter(
        (column) =>
          column.autoIncrement &&
          primaryColumns.length === 1 &&
          primaryColumns[0] === column.name,
      );

      if (autoPrimary.length === 1 && autoPrimary[0].name !== "id") {
        renamed[block.table] = { from: autoPrimary[0].name, to: "id" };
        warnings.push(
          `Laravel primary key strategy changed ${block.table}.${autoPrimary[0].name} to ${block.table}.id. Review related model code.`,
        );
      }
    });

    return renamed;
  }

  function convertTable(block, options, warnings, renamedPrimaryKeys) {
    const constraints = [];
    const foreignConstraints = [];
    const columns = [];
    const primaryKeyColumns = [];

    block.definitions.forEach((definition) => {
      const trimmed = definition.trim();
      if (!trimmed) return;
      if (shouldSkipUnsupportedDefinition(trimmed, block.table, warnings)) return;

      if (isConstraintDefinition(trimmed)) {
        const constraint = parseConstraint(trimmed);
        if (!constraint) {
          warnings.push(`Skipped unsupported constraint in ${block.table}: ${trimmed}`);
          return;
        }

        if (constraint.type === "primary") {
          primaryKeyColumns.push(...constraint.columns);
        }

        if (constraint.type === "foreign") {
          foreignConstraints.push(constraint);
        } else {
          constraints.push(constraint);
        }

        return;
      }

      const column = parseColumnDefinition(trimmed, warnings);
      if (!column) return;
      columns.push(column);
      if (column.primaryInline) primaryKeyColumns.push(column.name);
    });

    const uniquePrimaryKeys = Array.from(new Set(primaryKeyColumns));
    const foreignKeyColumns = new Set(
      foreignConstraints.flatMap((constraint) => constraint.columns),
    );
    const tableContext = {
      primaryKeyColumns: uniquePrimaryKeys,
      foreignKeyColumns,
    };

    const autoIncrementPrimaryColumns = columns.filter(
      (column) =>
        column.autoIncrement &&
        uniquePrimaryKeys.length === 1 &&
        uniquePrimaryKeys[0] === column.name,
    );
    const autoIncrementPrimaryHandled = autoIncrementPrimaryColumns.length === 1;
    const lines = [];
    const skipColumns = new Set();

    if (options.combineTimestamps) {
      const created = columns.find((column) => column.name === "created_at");
      const updated = columns.find((column) => column.name === "updated_at");
      if (created && updated) {
        skipColumns.add("created_at");
        skipColumns.add("updated_at");
      }
    }

    if (options.combineSoftDeletes && columns.some((column) => column.name === "deleted_at")) {
      skipColumns.add("deleted_at");
    }

    columns.forEach((column) => {
      if (skipColumns.has(column.name)) return;
      const base = typeMethod(column, options, tableContext);
      lines.push(
        `            ${applyModifiers(base, column, options, warnings, block.table)}`,
      );
    });

    if (skipColumns.has("created_at") && skipColumns.has("updated_at")) {
      lines.push("            $table->timestamps();");
    }

    if (skipColumns.has("deleted_at")) {
      lines.push("            $table->softDeletes();");
    }

    constraints.forEach((constraint) => {
      if (
        constraint.type === "primary" &&
        autoIncrementPrimaryHandled &&
        constraint.columns.length === 1 &&
        constraint.columns[0] === autoIncrementPrimaryColumns[0].name
      ) {
        return;
      }

      const code = constraintToLaravel(
        constraint,
        options,
        warnings,
        renamedPrimaryKeys,
      );
      if (code) lines.push(`            ${code}`);
    });

    const schema = schemaExpression(options, warnings);
    return {
      createCode: `        ${schema}::create(${phpString(
        block.table,
      )}, function (Blueprint $table) {\n${lines.join("\n")}\n        });`,
      foreignConstraints,
    };
  }

  function buildForeignKeyPass(block, constraints, options, warnings, renamedPrimaryKeys) {
    const lines = constraints
      .map((constraint) =>
        constraintToLaravel(constraint, options, warnings, renamedPrimaryKeys),
      )
      .filter(Boolean)
      .map((line) => `            ${line}`);

    if (!lines.length) return "";

    return `        ${schemaExpression(options, warnings)}::table(${phpString(
      block.table,
    )}, function (Blueprint $table) {\n${lines.join("\n")}\n        });`;
  }

  function wrapMigration(code, blocks) {
    const drops = blocks
      .slice()
      .reverse()
      .map((block) => `        Schema::dropIfExists(${phpString(block.table)});`)
      .join("\n");

    return `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\DB;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
${code}
    }

    public function down(): void
    {
${drops}
    }
};`;
  }

  function convertSql(sql, rawOptions) {
    const options = normalizeOptions(rawOptions);
    const warnings = [];
    const input = String(sql || "");

    const crudStatements = detectCrudStatements(input);
    let ddl = input;

    if (crudStatements.length && !options.ignoreCrud) {
      crudStatements.forEach((item) => {
        warnings.push(
          `Blocked ${item.command} statement #${item.index}: ${
            item.preview || "(empty statement)"
          }`,
        );
      });

      return {
        code: `// Conversion blocked.
// This tool only accepts schema DDL such as CREATE TABLE.
// Remove CRUD/data statements like SELECT, INSERT, UPDATE, DELETE, or REPLACE before converting.`,
        blocks: [],
        warnings,
        blocked: true,
      };
    }

    if (crudStatements.length) {
      ddl = removeCrudStatements(input, warnings);
    }

    const blocks = findCreateTableBlocks(ddl);

    if (!blocks.length) {
      return {
        code: "// No CREATE TABLE statements found.",
        blocks: [],
        warnings,
        blocked: false,
      };
    }

    const renamedPrimaryKeys = detectRenamedPrimaryKeys(blocks, options, warnings);
    const tableResults = blocks.map((block) =>
      convertTable(block, options, warnings, renamedPrimaryKeys),
    );
    const createSchemas = tableResults.map((result) => result.createCode);
    const foreignSchemas = tableResults
      .map((result, index) =>
        buildForeignKeyPass(
          blocks[index],
          result.foreignConstraints,
          options,
          warnings,
          renamedPrimaryKeys,
        ),
      )
      .filter(Boolean);
    const body = [...createSchemas, ...foreignSchemas].join("\n\n");
    const code = options.wrapMigration ? wrapMigration(body, blocks) : body;

    return {
      code,
      blocks: blocks.map((block) => ({
        table: block.table,
        definitions: block.definitions,
      })),
      warnings,
      blocked: false,
    };
  }

  return {
    DEFAULT_OPTIONS,
    normalizeOptions,
    convertSql,
    stripSqlComments,
    splitSqlStatements,
    findCreateTableBlocks,
  };
});
