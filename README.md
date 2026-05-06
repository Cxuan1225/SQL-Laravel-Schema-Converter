# SQL Laravel Schema Converter

A browser-based tool for converting MySQL or MariaDB `CREATE TABLE` statements into Laravel migration schema code.

The app is a static HTML/CSS/JavaScript project. It runs entirely in the browser, so pasted SQL is processed locally by the client-side converter code.

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

## Local Usage

Open `sql_to_laravel_schema_creator.html` in a browser.

No build step is required. The page loads Tailwind CSS from the CDN and uses the local files in `assets/`.

## Deploying

This repository is ready for static deployment on Vercel. The `vercel.json` file rewrites `/` to `sql_to_laravel_schema_creator.html`, so the converter is available at the site root after deployment.

## Project Structure

```text
.
+-- sql_to_laravel_schema_creator.html
+-- assets/
|   +-- css/
|   |   +-- styles.css
|   +-- js/
|       +-- app.js
|       +-- tailwind-config.js
+-- vercel.json
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
