#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { convertSql } = require("../src/converter");

const USAGE = `Usage:
  sql-laravel convert <sql_path> [output_path] [options]

Options:
  --wrap / --no-wrap              Include or omit the migration class wrapper
  --timestamps / --no-timestamps  Combine created_at and updated_at columns
  --soft-deletes / --no-soft-deletes
                                  Convert deleted_at to softDeletes()
  --foreign-id                    Convert actual bigint unsigned FK columns to foreignId()
  --pk=legacy|laravel             Primary key strategy
  --tinyint=boolean|tinyInteger   tinyint(1) conversion behavior
  --zero-date=nullable|preserve   Zero-date default handling
  --connection=<name>             Emit Schema::connection('<name>')
  --ignore-crud                   Skip CRUD/data statements instead of blocking
  --migration-name=<name>         Name used when output_path is a directory
  --json                          Print JSON result instead of PHP code
  --quiet                         Suppress warning output
  --help                          Show this help

Examples:
  sql-laravel convert dump.sql generated.php --pk=laravel
  sql-laravel convert dump.sql database/migrations --migration-name=create_imported_schema
`;

main(process.argv.slice(2));

function main(argv) {
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  if (command !== "convert") {
    fail(`Unknown command: ${command}`);
  }

  const parsed = parseConvertArgs(argv.slice(1));
  const sql = fs.readFileSync(parsed.inputPath, "utf8");
  const result = convertSql(sql, parsed.options);

  if (!parsed.quiet && result.warnings.length) {
    result.warnings.forEach((warning) => {
      console.error(`Warning: ${warning}`);
    });
  }

  if (parsed.json) {
    writeOutput(parsed.outputPath, JSON.stringify(result, null, 2), parsed);
  } else {
    writeOutput(parsed.outputPath, result.code, parsed);
  }

  if (result.blocked) {
    process.exitCode = 2;
  }
}

function parseConvertArgs(argv) {
  const positional = [];
  const options = {};
  let json = false;
  let quiet = false;
  let migrationName = "create_imported_schema";

  argv.forEach((arg) => {
    if (!arg.startsWith("-")) {
      positional.push(arg);
      return;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    }

    if (arg === "--wrap") options.wrapMigration = true;
    else if (arg === "--no-wrap") options.wrapMigration = false;
    else if (arg === "--timestamps") options.combineTimestamps = true;
    else if (arg === "--no-timestamps") options.combineTimestamps = false;
    else if (arg === "--soft-deletes") options.combineSoftDeletes = true;
    else if (arg === "--no-soft-deletes") options.combineSoftDeletes = false;
    else if (arg === "--foreign-id") options.useForeignId = true;
    else if (arg === "--ignore-crud") options.ignoreCrud = true;
    else if (arg === "--json") json = true;
    else if (arg === "--quiet") quiet = true;
    else if (arg.startsWith("--pk=")) options.primaryKeyStrategy = arg.slice(5);
    else if (arg.startsWith("--tinyint=")) options.tinyIntOneMode = arg.slice(10);
    else if (arg.startsWith("--zero-date=")) options.zeroDateMode = arg.slice(12);
    else if (arg.startsWith("--connection=")) options.connectionName = arg.slice(13);
    else if (arg.startsWith("--migration-name=")) migrationName = arg.slice(17);
    else fail(`Unknown option: ${arg}`);
  });

  if (!positional[0]) fail("Missing sql_path.");

  return {
    inputPath: positional[0],
    outputPath: positional[1] || "",
    options,
    json,
    quiet,
    migrationName,
  };
}

function writeOutput(outputPath, content, parsed) {
  if (!outputPath) {
    process.stdout.write(`${content}\n`);
    return;
  }

  const resolvedOutput = resolveOutputPath(outputPath, parsed);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, `${content.trimEnd()}\n`, "utf8");

  if (!parsed.quiet) {
    console.error(`Wrote ${resolvedOutput}`);
  }
}

function resolveOutputPath(outputPath, parsed) {
  if (path.extname(outputPath).toLowerCase() === ".php") {
    return outputPath;
  }

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).isFile()) {
    return outputPath;
  }

  const timestamp = migrationTimestamp(new Date());
  const safeName = sanitizeMigrationName(parsed.migrationName);
  return path.join(outputPath, `${timestamp}_${safeName}.php`);
}

function migrationTimestamp(date) {
  const parts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ];

  return `${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}${parts[4]}${parts[5]}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function sanitizeMigrationName(value) {
  const safe = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return safe || "create_imported_schema";
}

function fail(message) {
  console.error(message);
  console.error("");
  console.error(USAGE);
  process.exit(1);
}
