# SQL Laravel Schema Converter

A browser, API, CLI, and Laravel Artisan tool for converting MySQL or MariaDB `CREATE TABLE` statements into Laravel migration schema code.

The browser app runs entirely in the client. The API and Node CLI share the same JavaScript converter core, and the Laravel Artisan command provides a PHP-native package entry point for Laravel applications.

## Features

- Convert one or more `CREATE TABLE` blocks into Laravel `Schema::create()` calls.
- Optionally wrap generated schema code in an anonymous Laravel migration class.
- Import `.sql` or `.txt` files, paste from the clipboard, copy output, and download the generated migration.
- Detect tables, warnings, SQL size, foreign keys, and conversion status while editing.
- Combine `created_at` and `updated_at` into `$table->timestamps()`.
- Convert `deleted_at` into `$table->softDeletes()`.
- Optionally convert actual foreign-key columns into `$table->foreignId()`.
- Move foreign key constraints into a second migration pass so referenced tables can be created first.
- Choose primary key strategy, `tinyint(1)` handling, zero-date handling, and an optional Laravel database connection name.
- Block or ignore CRUD/data statements such as `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `REPLACE`.

## Browser Usage

Open `sql_to_laravel_schema_creator.html` in a browser.

No build step is required. The page loads Tailwind CSS from the CDN and uses the local files in `assets/`.

## Installation

Use npm for the standalone Node CLI:

```bash
npm install -g sql-laravel-schema-converter
sql-laravel convert dump.sql generated.php --pk=laravel
```

Use Composer for the Laravel Artisan command:

```bash
composer require cxuan1225/sql-laravel-schema-converter
php artisan schema:convert-sql dump.sql database/migrations --pk=laravel
```

If the packages have not been published to npm or Packagist yet, install from GitHub instead:

```bash
npm install -g github:Cxuan1225/SQL-Laravel-Schema-Converter
```

```bash
composer config repositories.sql-laravel-schema-converter vcs https://github.com/Cxuan1225/SQL-Laravel-Schema-Converter.git
composer require cxuan1225/sql-laravel-schema-converter:dev-master
```

Composer uses `composer require` to download a package into a Laravel project. `composer install` is only for installing dependencies from an existing `composer.lock`.

## API Usage

Deploy the repository on Vercel and send JSON to:

```http
POST /api/convert
```

Example request:

```json
{
  "sql": "CREATE TABLE `users` (`id` bigint unsigned NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`));",
  "options": {
    "wrapMigration": true,
    "primaryKeyStrategy": "laravel",
    "ignoreCrud": false
  }
}
```

Example response shape:

```json
{
  "code": "<?php\n\nuse Illuminate\\Database\\Migrations\\Migration;\n...",
  "blocks": [
    {
      "table": "users",
      "definitions": []
    }
  ],
  "warnings": [],
  "blocked": false
}
```

## Node CLI Usage

Run the converter directly with Node:

```bash
node bin/sql-laravel.js convert dump.sql generated.php --pk=laravel
```

Write to a migration directory:

```bash
node bin/sql-laravel.js convert dump.sql database/migrations --migration-name=create_imported_schema
```

Print generated PHP to stdout by omitting the output path:

```bash
node bin/sql-laravel.js convert dump.sql --no-wrap
```

Available CLI options:

```text
--wrap / --no-wrap
--timestamps / --no-timestamps
--soft-deletes / --no-soft-deletes
--foreign-id
--pk=legacy|laravel
--tinyint=boolean|tinyInteger
--zero-date=nullable|preserve
--connection=<name>
--ignore-crud
--migration-name=<name>
--json
--quiet
```

## Laravel Artisan Usage

This repository can also be used as a Laravel package. Registering the package exposes:

```bash
php artisan schema:convert-sql {sql_path} {output_path?}
```

Examples:

```bash
php artisan schema:convert-sql dump.sql database/migrations --pk=laravel
php artisan schema:convert-sql dump.sql database/migrations/2026_05_06_000000_imported_schema.php --foreign-id
php artisan schema:convert-sql dump.sql --no-wrap --json
```

The Artisan command supports the same conversion options as the Node CLI. When `output_path` is a directory, the command creates a Laravel-style migration filename using `--migration-name`.

## Package Separation

The repository keeps the browser app, Vercel API, Node CLI, and Laravel package together, but published package contents are separated:

- The npm package includes only the JavaScript converter core, Node CLI, README, and license.
- The Composer package includes only the PHP converter, Laravel Artisan command, service provider, README, and license.
- The Vercel API is deployed from the repository and shares the JavaScript converter core without depending on browser files.
- Browser-only files such as `sql_to_laravel_schema_creator.html` and `assets/` are excluded from both CLI package archives.

## Deploying

This repository is ready for static deployment on Vercel. The `vercel.json` file rewrites `/` to `sql_to_laravel_schema_creator.html`, so the converter is available at the site root after deployment.

## Project Structure

```text
.
+-- api/
|   +-- convert.js
+-- bin/
|   +-- sql-laravel.js
+-- src/
|   +-- converter.js
|   +-- Commands/
|   |   +-- ConvertSqlSchemaCommand.php
|   +-- Support/
|   |   +-- SqlLaravelConverter.php
|   +-- SqlLaravelSchemaConverterServiceProvider.php
+-- sql_to_laravel_schema_creator.html
+-- assets/
|   +-- css/
|   |   +-- styles.css
|   +-- js/
|       +-- app.js
|       +-- tailwind-config.js
+-- composer.json
+-- package.json
+-- LICENSE
+-- vercel.json
```

## Verification

Run JavaScript syntax checks:

```bash
npm test
```

Validate Composer metadata:

```bash
composer validate --strict
```

## Conversion Notes

This is a practical converter, not a full SQL parser or database engine. Always review the generated migration before running it, especially for:

- indexes and composite keys
- foreign key actions
- enum values
- decimal precision
- generated columns
- check constraints
- default expressions
- legacy zero-date values

The converter is designed to accelerate migration drafting while keeping final schema review in the developer's hands.

## AI-Generated Content Notice

This project was generated with assistance from AI tools. It may contain mistakes, incomplete behavior, security issues, or misleading documentation. Users are solely responsible for reviewing, testing, and validating all code before use, especially in production environments. The repository owner, contributors, and any referenced authors make no warranties and accept no liability for errors, omissions, or any consequences arising from the use of this project. This notice is supplementary to and does not modify the terms of the MIT License.

## License

MIT
