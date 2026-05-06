<?php

declare(strict_types=1);

namespace SqlLaravelSchemaConverter\Commands;

use Illuminate\Console\Command;
use SqlLaravelSchemaConverter\Support\SqlLaravelConverter;

class ConvertSqlSchemaCommand extends Command
{
    protected $signature = 'schema:convert-sql
        {sql_path : Path to a .sql or .txt file containing CREATE TABLE statements}
        {output_path? : Output PHP file or migration directory. Omit to print to stdout}
        {--wrap : Include the anonymous migration class wrapper}
        {--no-wrap : Omit the anonymous migration class wrapper}
        {--timestamps : Combine created_at and updated_at columns}
        {--no-timestamps : Keep created_at and updated_at as individual columns}
        {--soft-deletes : Convert deleted_at to softDeletes()}
        {--no-soft-deletes : Keep deleted_at as an individual column}
        {--foreign-id : Convert actual bigint unsigned FK columns to foreignId()}
        {--pk=legacy : Primary key strategy: legacy or laravel}
        {--tinyint=boolean : tinyint(1) behavior: boolean or tinyInteger}
        {--zero-date=nullable : Zero-date handling: nullable or preserve}
        {--connection= : Optional Laravel database connection name}
        {--ignore-crud : Skip CRUD/data statements instead of blocking conversion}
        {--migration-name=create_imported_schema : Migration filename suffix when output_path is a directory}
        {--json : Output the full conversion result as JSON}';

    protected $description = 'Convert MySQL or MariaDB CREATE TABLE SQL into Laravel migration schema code.';

    public function handle(): int
    {
        $inputPath = (string) $this->argument('sql_path');
        $outputPath = $this->argument('output_path');

        if (! is_file($inputPath)) {
            $this->error(sprintf('SQL file not found: %s', $inputPath));

            return Command::FAILURE;
        }

        $sql = file_get_contents($inputPath);
        if ($sql === false) {
            $this->error(sprintf('Unable to read SQL file: %s', $inputPath));

            return Command::FAILURE;
        }

        $converter = new SqlLaravelConverter();
        $result = $converter->convert($sql, $this->buildOptions());

        foreach ($result['warnings'] as $warning) {
            $this->warn($warning);
        }

        $content = $this->option('json') === true
            ? json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
            : $result['code'];

        if (! is_string($content)) {
            $this->error('Unable to encode conversion result.');

            return Command::FAILURE;
        }

        if (is_string($outputPath) && $outputPath !== '') {
            $resolvedOutput = $this->resolveOutputPath($outputPath);
            $directory = dirname($resolvedOutput);

            if (! is_dir($directory) && ! mkdir($directory, 0775, true) && ! is_dir($directory)) {
                $this->error(sprintf('Unable to create output directory: %s', $directory));

                return Command::FAILURE;
            }

            if (file_put_contents($resolvedOutput, rtrim($content) . PHP_EOL) === false) {
                $this->error(sprintf('Unable to write output file: %s', $resolvedOutput));

                return Command::FAILURE;
            }

            $this->info(sprintf('Wrote %s', $resolvedOutput));
        } else {
            $this->line($content);
        }

        return $result['blocked'] ? Command::FAILURE : Command::SUCCESS;
    }

    /** @return array<string, mixed> */
    private function buildOptions(): array
    {
        $wrap = true;
        if ($this->option('wrap') === true) {
            $wrap = true;
        }
        if ($this->option('no-wrap') === true) {
            $wrap = false;
        }

        $timestamps = true;
        if ($this->option('timestamps') === true) {
            $timestamps = true;
        }
        if ($this->option('no-timestamps') === true) {
            $timestamps = false;
        }

        $softDeletes = true;
        if ($this->option('soft-deletes') === true) {
            $softDeletes = true;
        }
        if ($this->option('no-soft-deletes') === true) {
            $softDeletes = false;
        }

        return [
            'wrapMigration' => $wrap,
            'combineTimestamps' => $timestamps,
            'combineSoftDeletes' => $softDeletes,
            'useForeignId' => $this->option('foreign-id') === true,
            'primaryKeyStrategy' => (string) ($this->option('pk') ?: 'legacy'),
            'tinyIntOneMode' => (string) ($this->option('tinyint') ?: 'boolean'),
            'zeroDateMode' => (string) ($this->option('zero-date') ?: 'nullable'),
            'connectionName' => (string) ($this->option('connection') ?: ''),
            'ignoreCrud' => $this->option('ignore-crud') === true,
        ];
    }

    private function resolveOutputPath(string $outputPath): string
    {
        if (strtolower(pathinfo($outputPath, PATHINFO_EXTENSION)) === 'php') {
            return $outputPath;
        }

        if (is_file($outputPath)) {
            return $outputPath;
        }

        return rtrim($outputPath, DIRECTORY_SEPARATOR . '/\\') . DIRECTORY_SEPARATOR
            . date('Y_m_d_His') . '_' . $this->sanitizeMigrationName((string) $this->option('migration-name')) . '.php';
    }

    private function sanitizeMigrationName(string $value): string
    {
        $safe = strtolower(trim($value));
        $safe = preg_replace('/[^a-z0-9_]+/', '_', $safe) ?? '';
        $safe = trim($safe, '_');

        return $safe !== '' ? $safe : 'create_imported_schema';
    }
}
