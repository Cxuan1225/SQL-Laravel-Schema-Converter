# SQL Laravel Schema Converter

Convert MySQL or MariaDB `CREATE TABLE` statements into Laravel migration code.

Use this when you have an existing SQL dump and want a faster starting point for Laravel migrations. The converter can run as an npm CLI, Laravel Artisan command, browser tool, or Vercel API. The npm and Composer package contents are kept separate so each installation gets only the files it needs.

## Quick Start

### Node CLI

Install the standalone CLI:

```bash
npm install -g sql-laravel-schema-converter
```

Convert a SQL dump into a Laravel migration file:

```bash
sql-laravel convert dump.sql database/migrations --pk=laravel
```

Print generated PHP to stdout instead:

```bash
sql-laravel convert dump.sql --no-wrap
```

### Laravel Artisan

Install the Laravel package:

```bash
composer require cxuan1225/sql-laravel-schema-converter
```

Convert a SQL dump from inside a Laravel application:

```bash
php artisan schema:convert-sql dump.sql database/migrations --pk=laravel
```

When the output path is a directory, the CLI and Artisan command create a Laravel-style migration filename automatically.

## Example

Input SQL:

```sql
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`)
);
```

Command:

```bash
sql-laravel convert users.sql --pk=laravel
```

Output excerpt:

```php
Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->string('email', 255);
    $table->timestamps();

    $table->unique('email', 'users_email_unique');
});
```

## What It Converts

- One or more MySQL/MariaDB `CREATE TABLE` blocks.
- Columns, nullable/default modifiers, primary keys, unique keys, indexes, and foreign keys.
- `created_at` and `updated_at` columns into `$table->timestamps()`.
- `deleted_at` columns into `$table->softDeletes()`.
- Optional `bigint unsigned` foreign key columns into `$table->foreignId()`.
- Optional anonymous Laravel migration class wrappers.
- Optional Laravel database connection names through `Schema::connection(...)`.

The converter also detects warnings, SQL size, table names, foreign keys, and conversion status while editing in the browser UI.

## Safety Checks

By default, conversion is blocked when the input contains CRUD or data statements such as `SELECT`, `INSERT`, `UPDATE`, `DELETE`, or `REPLACE`. Use `--ignore-crud` when you want those statements skipped instead.

Foreign key constraints are moved into a second migration pass so referenced tables can be created first.

## Installation From GitHub

If the packages have not been published to npm or Packagist yet, install directly from GitHub.

```bash
npm install -g github:Cxuan1225/SQL-Laravel-Schema-Converter
```

```bash
composer config repositories.sql-laravel-schema-converter vcs https://github.com/Cxuan1225/SQL-Laravel-Schema-Converter.git
composer require cxuan1225/sql-laravel-schema-converter:dev-master
```

Composer uses `composer require` to download a package into a Laravel project. `composer install` is only for installing dependencies from an existing `composer.lock`.

## Node CLI Reference

Run the converter directly from the repository:

```bash
node bin/sql-laravel.js convert dump.sql generated.php --pk=laravel
```

Write to a migration directory:

```bash
node bin/sql-laravel.js convert dump.sql database/migrations --migration-name=create_imported_schema
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

## Laravel Artisan Reference

The Composer package registers this command in Laravel applications:

```bash
php artisan schema:convert-sql {sql_path} {output_path?}
```

Examples:

```bash
php artisan schema:convert-sql dump.sql database/migrations --pk=laravel
php artisan schema:convert-sql dump.sql database/migrations/2026_05_06_000000_imported_schema.php --foreign-id
php artisan schema:convert-sql dump.sql --no-wrap --json
```

The Artisan command supports the same conversion options as the Node CLI.

## Browser Usage

Open `sql_to_laravel_schema_creator.html` in a browser.

No build step is required. The page loads Tailwind CSS from the CDN and uses the local files in `assets/`.

The browser app supports importing `.sql` or `.txt` files, pasting from the clipboard, copying output, and downloading the generated migration.

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

## Package Contents

The repository keeps the browser app, Vercel API, Node CLI, and Laravel package together, but published package contents are separated:

- The npm package includes only the JavaScript converter core, Node CLI, README, and license.
- The Composer package includes only the PHP converter, Laravel Artisan command, service provider, README, and license.
- The Vercel API is deployed from the repository and shares the JavaScript converter core without depending on browser files.
- Browser-only files such as `sql_to_laravel_schema_creator.html` and `assets/` are excluded from both CLI package archives.

## Deployment

This repository is ready for static deployment on Vercel. The `vercel.json` file rewrites `/` to `sql_to_laravel_schema_creator.html`, so the browser converter is available at the site root after deployment.

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
+-- assets/
|   +-- css/
|   |   +-- styles.css
|   +-- js/
|       +-- app.js
|       +-- tailwind-config.js
+-- tests/
|   +-- converter.test.js
|   +-- php_converter_test.php
|   +-- fixtures/
|       +-- sample.sql
+-- sql_to_laravel_schema_creator.html
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

Run the JavaScript converter/API/CLI tests:

```bash
node --test tests/converter.test.js
```

Validate Composer metadata:

```bash
composer validate --strict
```

Run the PHP converter smoke test:

```bash
php tests/php_converter_test.php
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
