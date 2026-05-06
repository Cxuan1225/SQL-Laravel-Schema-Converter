<?php

declare(strict_types=1);

namespace SqlLaravelSchemaConverter\Support;

final class SqlLaravelConverter
{
    /** @var array<string, mixed> */
    private const DEFAULT_OPTIONS = [
        'wrapMigration' => true,
        'combineTimestamps' => true,
        'combineSoftDeletes' => true,
        'useForeignId' => false,
        'primaryKeyStrategy' => 'legacy',
        'tinyIntOneMode' => 'boolean',
        'zeroDateMode' => 'nullable',
        'connectionName' => '',
        'ignoreCrud' => false,
    ];

    /** @var list<string> */
    private const CRUD_COMMANDS = ['select', 'insert', 'update', 'delete', 'replace'];

    /** @param array<string, mixed> $options @return array{code: string, blocks: list<array{table: string, definitions: list<string>}>, warnings: list<string>, blocked: bool} */
    public function convert(string $sql, array $options = []): array
    {
        $options = $this->normalizeOptions($options);
        $warnings = [];

        $crudStatements = $this->detectCrudStatements($sql);
        $ddl = $sql;

        if ($crudStatements !== [] && $options['ignoreCrud'] !== true) {
            foreach ($crudStatements as $statement) {
                $warnings[] = sprintf(
                    'Blocked %s statement #%d: %s',
                    $statement['command'],
                    $statement['index'],
                    $statement['preview'] !== '' ? $statement['preview'] : '(empty statement)',
                );
            }

            return [
                'code' => implode("\n", [
                    '// Conversion blocked.',
                    '// This tool only accepts schema DDL such as CREATE TABLE.',
                    '// Remove CRUD/data statements like SELECT, INSERT, UPDATE, DELETE, or REPLACE before converting.',
                ]),
                'blocks' => [],
                'warnings' => $warnings,
                'blocked' => true,
            ];
        }

        if ($crudStatements !== []) {
            $ddl = $this->removeCrudStatements($sql, $warnings);
        }

        $blocks = $this->findCreateTableBlocks($ddl);

        if ($blocks === []) {
            return [
                'code' => '// No CREATE TABLE statements found.',
                'blocks' => [],
                'warnings' => $warnings,
                'blocked' => false,
            ];
        }

        $tableResults = [];
        foreach ($blocks as $block) {
            $tableResults[] = $this->convertTable($block, $options, $warnings);
        }

        $schemas = array_map(
            static fn (array $result): string => $result['createCode'],
            $tableResults,
        );

        foreach ($tableResults as $index => $result) {
            $foreignSchema = $this->buildForeignKeyPass($blocks[$index], $result['foreignConstraints'], $options, $warnings);
            if ($foreignSchema !== '') {
                $schemas[] = $foreignSchema;
            }
        }

        $body = implode("\n\n", $schemas);
        $code = $options['wrapMigration'] ? $this->wrapMigration($body, $blocks) : $body;

        return [
            'code' => $code,
            'blocks' => array_map(
                static fn (array $block): array => [
                    'table' => $block['table'],
                    'definitions' => $block['definitions'],
                ],
                $blocks,
            ),
            'warnings' => $warnings,
            'blocked' => false,
        ];
    }

    /** @param array<string, mixed> $options @return array<string, mixed> */
    private function normalizeOptions(array $options): array
    {
        $merged = array_merge(self::DEFAULT_OPTIONS, $options);

        $merged['wrapMigration'] = $merged['wrapMigration'] !== false;
        $merged['combineTimestamps'] = $merged['combineTimestamps'] !== false;
        $merged['combineSoftDeletes'] = $merged['combineSoftDeletes'] !== false;
        $merged['useForeignId'] = $merged['useForeignId'] === true;
        $merged['ignoreCrud'] = $merged['ignoreCrud'] === true;

        if (! in_array($merged['primaryKeyStrategy'], ['legacy', 'laravel'], true)) {
            $merged['primaryKeyStrategy'] = self::DEFAULT_OPTIONS['primaryKeyStrategy'];
        }

        if (! in_array($merged['tinyIntOneMode'], ['boolean', 'tinyInteger'], true)) {
            $merged['tinyIntOneMode'] = self::DEFAULT_OPTIONS['tinyIntOneMode'];
        }

        if (! in_array($merged['zeroDateMode'], ['nullable', 'preserve'], true)) {
            $merged['zeroDateMode'] = self::DEFAULT_OPTIONS['zeroDateMode'];
        }

        $merged['connectionName'] = trim((string) $merged['connectionName']);

        return $merged;
    }

    private function stripSqlComments(string $sql): string
    {
        $sql = preg_replace('/\/\*[\s\S]*?\*\//', '', $sql) ?? $sql;
        $sql = preg_replace('/^\s*--.*$/m', '', $sql) ?? $sql;

        return preg_replace('/^\s*#.*$/m', '', $sql) ?? $sql;
    }

    /** @return list<string> */
    private function splitSqlStatements(string $sql): array
    {
        $statements = [];
        $current = '';
        $quote = null;
        $escaped = false;
        $lineComment = false;
        $blockComment = false;
        $length = strlen($sql);

        for ($i = 0; $i < $length; $i++) {
            $char = $sql[$i];
            $next = $sql[$i + 1] ?? '';

            if ($lineComment) {
                $current .= $char;
                if ($char === "\n") {
                    $lineComment = false;
                }
                continue;
            }

            if ($blockComment) {
                $current .= $char;
                if ($char === '*' && $next === '/') {
                    $current .= $next;
                    $i++;
                    $blockComment = false;
                }
                continue;
            }

            if ($quote !== null) {
                $current .= $char;
                if ($escaped) {
                    $escaped = false;
                } elseif ($char === '\\') {
                    $escaped = true;
                } elseif ($char === $quote) {
                    $quote = null;
                }
                continue;
            }

            if ($char === '-' && $next === '-') {
                $current .= $char . $next;
                $i++;
                $lineComment = true;
                continue;
            }

            if ($char === '#') {
                $current .= $char;
                $lineComment = true;
                continue;
            }

            if ($char === '/' && $next === '*') {
                $current .= $char . $next;
                $i++;
                $blockComment = true;
                continue;
            }

            if (in_array($char, ["'", '"', '`'], true)) {
                $quote = $char;
                $current .= $char;
                continue;
            }

            if ($char === ';') {
                if (trim($current) !== '') {
                    $statements[] = trim($current);
                }
                $current = '';
                continue;
            }

            $current .= $char;
        }

        if (trim($current) !== '') {
            $statements[] = trim($current);
        }

        return $statements;
    }

    private function firstSqlCommand(string $statement): string
    {
        $cleaned = trim($this->stripSqlComments($statement));

        return preg_match('/^([a-zA-Z]+)/', $cleaned, $matches) === 1
            ? strtolower($matches[1])
            : '';
    }

    /** @return list<array{index: int, command: string, preview: string}> */
    private function detectCrudStatements(string $sql): array
    {
        $blocked = [];
        foreach ($this->splitSqlStatements($sql) as $index => $statement) {
            $command = $this->firstSqlCommand($statement);
            if (! in_array($command, self::CRUD_COMMANDS, true)) {
                continue;
            }

            $blocked[] = [
                'index' => $index + 1,
                'command' => strtoupper($command),
                'preview' => substr((string) preg_replace('/\s+/', ' ', trim($this->stripSqlComments($statement))), 0, 140),
            ];
        }

        return $blocked;
    }

    /** @param list<string> $warnings */
    private function removeCrudStatements(string $sql, array &$warnings): string
    {
        $kept = [];
        foreach ($this->splitSqlStatements($sql) as $index => $statement) {
            $command = $this->firstSqlCommand($statement);
            if (in_array($command, self::CRUD_COMMANDS, true)) {
                $preview = trim((string) preg_replace('/\s+/', ' ', $this->stripSqlComments($statement)));
                $warnings[] = sprintf('Ignored %s statement #%d: %s', strtoupper($command), $index + 1, $preview !== '' ? $preview : '(empty statement)');
                continue;
            }
            $kept[] = $statement;
        }

        return $kept === [] ? '' : implode(";\n", $kept) . ';';
    }

    /** @return list<array{table: string, body: string, definitions: list<string>}> */
    private function findCreateTableBlocks(string $sql): array
    {
        $cleaned = $this->stripSqlComments($sql);
        $pattern = '/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:`[^`]+`)|(?:"[^"]+")|(?:\'[^\']+\')|(?:[a-zA-Z0-9_\.]+))\s*\(/i';
        $offset = 0;
        $blocks = [];

        while (preg_match($pattern, $cleaned, $matches, PREG_OFFSET_CAPTURE, $offset) === 1) {
            $table = $this->cleanIdentifier($matches[1][0]);
            $openParenIndex = $matches[0][1] + strlen($matches[0][0]) - 1;
            $closeParenIndex = $this->findMatchingParen($cleaned, $openParenIndex);

            if ($closeParenIndex === null) {
                $offset = $openParenIndex + 1;
                continue;
            }

            $body = substr($cleaned, $openParenIndex + 1, $closeParenIndex - $openParenIndex - 1);
            $blocks[] = [
                'table' => $table,
                'body' => $body,
                'definitions' => $this->splitTopLevel($body),
            ];
            $offset = $closeParenIndex + 1;
        }

        return $blocks;
    }

    private function findMatchingParen(string $input, int $openParenIndex): ?int
    {
        $depth = 0;
        $quote = null;
        $escaped = false;
        $length = strlen($input);

        for ($i = $openParenIndex; $i < $length; $i++) {
            $char = $input[$i];

            if ($quote !== null) {
                if ($escaped) {
                    $escaped = false;
                } elseif ($char === '\\') {
                    $escaped = true;
                } elseif ($char === $quote) {
                    $quote = null;
                }
                continue;
            }

            if (in_array($char, ["'", '"', '`'], true)) {
                $quote = $char;
                continue;
            }

            if ($char === '(') {
                $depth++;
            }

            if ($char === ')') {
                $depth--;
            }

            if ($depth === 0) {
                return $i;
            }
        }

        return null;
    }

    /** @return list<string> */
    private function splitTopLevel(string $input): array
    {
        $parts = [];
        $current = '';
        $depth = 0;
        $quote = null;
        $escaped = false;
        $length = strlen($input);

        for ($i = 0; $i < $length; $i++) {
            $char = $input[$i];

            if ($quote !== null) {
                $current .= $char;
                if ($escaped) {
                    $escaped = false;
                } elseif ($char === '\\') {
                    $escaped = true;
                } elseif ($char === $quote) {
                    $quote = null;
                }
                continue;
            }

            if (in_array($char, ["'", '"', '`'], true)) {
                $quote = $char;
                $current .= $char;
                continue;
            }

            if ($char === '(') {
                $depth++;
            }

            if ($char === ')') {
                $depth--;
            }

            if ($char === ',' && $depth === 0) {
                if (trim($current) !== '') {
                    $parts[] = trim($current);
                }
                $current = '';
                continue;
            }

            $current .= $char;
        }

        if (trim($current) !== '') {
            $parts[] = trim($current);
        }

        return $parts;
    }

    /** @param array{table: string, definitions: list<string>} $block @param array<string, mixed> $options @param list<string> $warnings @return array{createCode: string, foreignConstraints: list<array<string, mixed>>} */
    private function convertTable(array $block, array $options, array &$warnings): array
    {
        $columns = [];
        $constraints = [];
        $foreignConstraints = [];
        $primaryColumns = [];

        foreach ($block['definitions'] as $definition) {
            $trimmed = trim($definition);
            if ($trimmed === '') {
                continue;
            }

            if ($this->isConstraintDefinition($trimmed)) {
                $constraint = $this->parseConstraint($trimmed);
                if ($constraint === null) {
                    $warnings[] = sprintf('Skipped unsupported constraint in %s: %s', $block['table'], $trimmed);
                    continue;
                }
                if ($constraint['type'] === 'primary') {
                    $primaryColumns = array_merge($primaryColumns, $constraint['columns']);
                }
                if ($constraint['type'] === 'foreign') {
                    $foreignConstraints[] = $constraint;
                } else {
                    $constraints[] = $constraint;
                }
                continue;
            }

            $column = $this->parseColumnDefinition($trimmed, $warnings);
            if ($column === null) {
                continue;
            }
            if ($column['primaryInline']) {
                $primaryColumns[] = $column['name'];
            }
            $columns[] = $column;
        }

        $primaryColumns = array_values(array_unique($primaryColumns));
        $foreignColumns = array_values(array_unique(array_merge(...array_map(
            static fn (array $constraint): array => $constraint['columns'],
            $foreignConstraints,
        ))));
        $skipColumns = [];
        if ($options['combineTimestamps'] === true && $this->hasColumn($columns, 'created_at') && $this->hasColumn($columns, 'updated_at')) {
            $skipColumns[] = 'created_at';
            $skipColumns[] = 'updated_at';
        }
        if ($options['combineSoftDeletes'] === true && $this->hasColumn($columns, 'deleted_at')) {
            $skipColumns[] = 'deleted_at';
        }

        $autoIncrementPrimaryColumn = null;
        foreach ($columns as $column) {
            if ($column['autoIncrement'] && count($primaryColumns) === 1 && $primaryColumns[0] === $column['name']) {
                $autoIncrementPrimaryColumn = $column;
                break;
            }
        }

        $lines = [];
        foreach ($columns as $column) {
            if (in_array($column['name'], $skipColumns, true)) {
                continue;
            }
            $base = $this->columnMethod($column, $options, $primaryColumns, $foreignColumns);
            $lines[] = '            ' . $this->applyModifiers($base, $column, $options, $warnings, $block['table']);
        }

        if (in_array('created_at', $skipColumns, true) && in_array('updated_at', $skipColumns, true)) {
            $lines[] = '            $table->timestamps();';
        }

        if (in_array('deleted_at', $skipColumns, true)) {
            $lines[] = '            $table->softDeletes();';
        }

        foreach ($constraints as $constraint) {
            if (
                $constraint['type'] === 'primary'
                && $autoIncrementPrimaryColumn !== null
                && count($constraint['columns']) === 1
                && $constraint['columns'][0] === $autoIncrementPrimaryColumn['name']
            ) {
                continue;
            }
            $constraintCode = $this->constraintToLaravel($constraint);
            if ($constraintCode !== '') {
                $lines[] = '            ' . $constraintCode;
            }
        }

        return [
            'createCode' => sprintf(
                "        %s::create(%s, function (Blueprint \$table) {\n%s\n        });",
                $this->schemaExpression($options, $warnings),
                $this->phpString($block['table']),
                implode("\n", $lines),
            ),
            'foreignConstraints' => $foreignConstraints,
        ];
    }

    /** @param list<array<string, mixed>> $columns */
    private function hasColumn(array $columns, string $name): bool
    {
        foreach ($columns as $column) {
            if ($column['name'] === $name) {
                return true;
            }
        }

        return false;
    }

    /** @param list<string> $warnings @return array<string, mixed>|null */
    private function parseColumnDefinition(string $line, array &$warnings): ?array
    {
        if (preg_match('/^((?:`[^`]+`)|(?:"[^"]+")|(?:\'[^\']+\')|(?:[a-zA-Z0-9_]+))\s+([\s\S]+)$/i', $line, $matches) !== 1) {
            $warnings[] = sprintf('Could not parse column definition: %s', $line);
            return null;
        }

        $name = $this->cleanIdentifier($matches[1]);
        $typeInfo = $this->readType($matches[2]);
        if ($typeInfo === null) {
            $warnings[] = sprintf('Could not detect type for column: %s', $name);
            return null;
        }

        $rest = $typeInfo['rest'];

        return [
            'name' => $name,
            'type' => strtolower($typeInfo['type']),
            'args' => $typeInfo['args'],
            'rest' => $rest,
            'unsigned' => preg_match('/\bunsigned\b/i', $rest) === 1,
            'nullable' => preg_match('/\bnull\b/i', $rest) === 1 && preg_match('/\bnot\s+null\b/i', $rest) !== 1,
            'autoIncrement' => preg_match('/\bauto_increment\b/i', $rest) === 1,
            'primaryInline' => preg_match('/\bprimary\s+key\b/i', $rest) === 1,
            'uniqueInline' => preg_match('/\bunique\b/i', $rest) === 1,
            'defaultValue' => $this->readDefault($rest),
        ];
    }

    /** @return array{type: string, args: string, rest: string}|null */
    private function readType(string $rest): ?array
    {
        $knownTypes = [
            'mediumint', 'longtext', 'tinytext', 'mediumtext', 'tinyint', 'smallint',
            'bigint', 'integer', 'varchar', 'datetime', 'timestamp', 'decimal',
            'boolean', 'double', 'float', 'enum', 'char', 'text', 'json', 'date',
            'time', 'blob', 'int', 'bool', 'bit',
        ];
        $trimmed = ltrim($rest);
        $lower = strtolower($trimmed);
        $type = null;

        foreach ($knownTypes as $knownType) {
            if ($lower === $knownType || str_starts_with($lower, $knownType . ' ') || str_starts_with($lower, $knownType . '(')) {
                $type = $knownType;
                break;
            }
        }

        if ($type === null) {
            return null;
        }

        $remaining = ltrim(substr($trimmed, strlen($type)));
        $args = '';

        if (str_starts_with($remaining, '(')) {
            $close = $this->findMatchingParen($remaining, 0);
            if ($close !== null) {
                $args = substr($remaining, 1, $close - 1);
                $remaining = ltrim(substr($remaining, $close + 1));
            }
        }

        return ['type' => $type, 'args' => $args, 'rest' => $remaining];
    }

    private function readDefault(string $rest): ?string
    {
        return preg_match('/\bdefault\s+((?:\'[^\']*(?:\\\\.[^\']*)*\')|(?:"[^"]*(?:\\\\.[^"]*)*")|(?:\([^)]+\))|(?:[^\s,]+))/i', $rest, $matches) === 1
            ? $matches[1]
            : null;
    }

    /** @return array<string, mixed>|null */
    private function parseConstraint(string $line): ?array
    {
        $normalized = trim((string) preg_replace('/\s+/', ' ', $line));

        if (preg_match('/^primary\s+key\s*\(([^)]+)\)/i', $normalized, $matches) === 1) {
            return ['type' => 'primary', 'columns' => $this->extractIdentifiers($matches[1])];
        }

        if (preg_match('/^unique(?:\s+(?:key|index))?\s+(?:(`[^`]+`|"[^"]+"|\'[^\']+\'|[a-zA-Z0-9_]+)\s+)?\(([^)]+)\)/i', $normalized, $matches) === 1) {
            return [
                'type' => 'unique',
                'name' => isset($matches[1]) ? $this->cleanIdentifier($matches[1]) : null,
                'columns' => $this->extractIdentifiers($matches[2]),
            ];
        }

        if (preg_match('/^(?:key|index)\s+(?:(`[^`]+`|"[^"]+"|\'[^\']+\'|[a-zA-Z0-9_]+)\s+)?\(([^)]+)\)/i', $normalized, $matches) === 1) {
            return [
                'type' => 'index',
                'name' => isset($matches[1]) ? $this->cleanIdentifier($matches[1]) : null,
                'columns' => $this->extractIdentifiers($matches[2]),
            ];
        }

        if (preg_match('/^(?:constraint\s+((?:`[^`]+`)|(?:"[^"]+")|(?:\'[^\']+\')|(?:[a-zA-Z0-9_]+))\s+)?foreign\s+key\s*\(([^)]+)\)\s+references\s+((?:`[^`]+`)|(?:"[^"]+")|(?:\'[^\']+\')|(?:[a-zA-Z0-9_\.]+))\s*\(([^)]+)\)([\s\S]*)$/i', $normalized, $matches) === 1) {
            return [
                'type' => 'foreign',
                'name' => isset($matches[1]) && $matches[1] !== '' ? $this->cleanIdentifier($matches[1]) : null,
                'columns' => $this->extractIdentifiers($matches[2]),
                'referencesTable' => $this->cleanIdentifier($matches[3]),
                'referencesColumns' => $this->extractIdentifiers($matches[4]),
                'actions' => $matches[5] ?? '',
            ];
        }

        return null;
    }

    private function isConstraintDefinition(string $line): bool
    {
        return preg_match('/^(primary\s+key|unique\s+key|unique\s+index|unique\s*\(|key\s+|index\s+|constraint\s+|foreign\s+key|check\s*\()/i', $line) === 1;
    }

    /** @param array<string, mixed> $column @param array<string, mixed> $options @param list<string> $primaryColumns @param list<string> $foreignColumns */
    private function columnMethod(array $column, array $options, array $primaryColumns, array $foreignColumns): string
    {
        $name = $this->phpString($column['name']);
        $type = $column['type'];

        if ($column['autoIncrement']) {
            if ($options['primaryKeyStrategy'] === 'laravel' && count($primaryColumns) === 1 && $primaryColumns[0] === $column['name']) {
                return '$table->id()';
            }
            if ($type === 'bigint') {
                return sprintf('$table->bigIncrements(%s)', $name);
            }
            return sprintf('$table->increments(%s)', $name);
        }

        if ($options['useForeignId'] === true && in_array($column['name'], $foreignColumns, true) && $type === 'bigint' && $column['unsigned']) {
            return sprintf('$table->foreignId(%s)', $name);
        }

        if ($type === 'bigint') {
            return $column['unsigned'] ? sprintf('$table->unsignedBigInteger(%s)', $name) : sprintf('$table->bigInteger(%s)', $name);
        }

        if (in_array($type, ['int', 'integer'], true)) {
            return $column['unsigned'] ? sprintf('$table->unsignedInteger(%s)', $name) : sprintf('$table->integer(%s)', $name);
        }

        if ($type === 'tinyint') {
            if (trim((string) $column['args']) === '1' && $options['tinyIntOneMode'] === 'boolean') {
                return sprintf('$table->boolean(%s)', $name);
            }

            return $column['unsigned'] ? sprintf('$table->unsignedTinyInteger(%s)', $name) : sprintf('$table->tinyInteger(%s)', $name);
        }

        if ($type === 'varchar') {
            $length = trim((string) $column['args']) !== '' ? trim((string) $column['args']) : '255';
            return sprintf('$table->string(%s, %s)', $name, $length);
        }

        if ($type === 'char') {
            $length = trim((string) $column['args']) !== '' ? trim((string) $column['args']) : '255';
            return sprintf('$table->char(%s, %s)', $name, $length);
        }

        if (in_array($type, ['text', 'tinytext'], true)) {
            return sprintf('$table->text(%s)', $name);
        }

        if ($type === 'mediumtext') {
            return sprintf('$table->mediumText(%s)', $name);
        }

        if ($type === 'longtext') {
            return sprintf('$table->longText(%s)', $name);
        }

        if (in_array($type, ['timestamp', 'datetime', 'date', 'time', 'json'], true)) {
            return sprintf('$table->%s(%s)', $type === 'datetime' ? 'dateTime' : $type, $name);
        }

        if ($type === 'decimal') {
            $args = trim((string) $column['args']) !== '' ? trim((string) $column['args']) : '8, 2';
            return sprintf('$table->decimal(%s, %s)', $name, $args);
        }

        if ($type === 'enum') {
            return sprintf('$table->enum(%s, %s)', $name, $this->phpArray(array_map([$this, 'unquoteSql'], $this->splitTopLevel((string) $column['args']))));
        }

        if (in_array($type, ['bool', 'boolean', 'bit'], true)) {
            return sprintf('$table->boolean(%s)', $name);
        }

        return sprintf('$table->string(%s)', $name);
    }

    /** @param array<string, mixed> $column @param array<string, mixed> $options @param list<string> $warnings */
    private function applyModifiers(string $base, array $column, array $options, array &$warnings, string $table): string
    {
        $code = $base;
        $nullable = (bool) $column['nullable'];
        $default = $column['defaultValue'];

        if ($default !== null && $options['zeroDateMode'] === 'nullable' && $this->isZeroDateDefault($default)) {
            $nullable = true;
            $warnings[] = sprintf('Converted zero-date default on %s.%s to nullable with no default.', $table, $column['name']);
        }

        if ($nullable) {
            $code .= '->nullable()';
        }

        if ($default !== null && ! ($options['zeroDateMode'] === 'nullable' && $this->isZeroDateDefault($default)) && strtolower(trim($default)) !== 'null' && ! $column['autoIncrement']) {
            $code .= $this->defaultModifier($default);
        }

        if ($column['uniqueInline']) {
            $code .= '->unique()';
        }

        return $code . ';';
    }

    private function defaultModifier(string $value): string
    {
        $raw = trim($value);

        if (preg_match('/^current_timestamp(?:\([0-6]\))?$/i', $raw) === 1) {
            return '->useCurrent()';
        }

        if (preg_match('/^-?\d+(?:\.\d+)?$/', $raw) === 1) {
            return sprintf('->default(%s)', $raw);
        }

        return sprintf('->default(%s)', $this->phpString($this->unquoteSql($raw)));
    }

    private function isZeroDateDefault(string $value): bool
    {
        return preg_match('/^[\'"]?0{4}-0{2}-0{2}(?:\s+0{2}:0{2}:0{2})?[\'"]?$/i', trim($value)) === 1;
    }

    /** @param array<string, mixed> $constraint */
    private function constraintToLaravel(array $constraint): string
    {
        $columns = $this->columnArgument($constraint['columns']);

        if ($constraint['type'] === 'primary') {
            return sprintf('$table->primary(%s);', $columns);
        }

        if ($constraint['type'] === 'unique') {
            return sprintf('$table->unique(%s%s);', $columns, isset($constraint['name']) && $constraint['name'] ? ', ' . $this->phpString($constraint['name']) : '');
        }

        if ($constraint['type'] === 'index') {
            return sprintf('$table->index(%s%s);', $columns, isset($constraint['name']) && $constraint['name'] ? ', ' . $this->phpString($constraint['name']) : '');
        }

        if ($constraint['type'] === 'foreign') {
            return sprintf(
                '$table->foreign(%s%s)->references(%s)->on(%s)%s;',
                $columns,
                isset($constraint['name']) && $constraint['name'] ? ', ' . $this->phpString($constraint['name']) : '',
                $this->columnArgument($constraint['referencesColumns']),
                $this->phpString((string) $constraint['referencesTable']),
                $this->foreignActionModifiers((string) ($constraint['actions'] ?? '')),
            );
        }

        return '';
    }

    /** @param array{table: string} $block @param list<array<string, mixed>> $constraints @param array<string, mixed> $options @param list<string> $warnings */
    private function buildForeignKeyPass(array $block, array $constraints, array $options, array &$warnings): string
    {
        $lines = [];
        foreach ($constraints as $constraint) {
            $constraintCode = $this->constraintToLaravel($constraint);
            if ($constraintCode !== '') {
                $lines[] = '            ' . $constraintCode;
            }
        }

        if ($lines === []) {
            return '';
        }

        return sprintf(
            "        %s::table(%s, function (Blueprint \$table) {\n%s\n        });",
            $this->schemaExpression($options, $warnings),
            $this->phpString($block['table']),
            implode("\n", $lines),
        );
    }

    private function foreignActionModifiers(string $actions): string
    {
        $code = '';
        $normalized = strtolower($actions);

        if (preg_match('/on\s+delete\s+(cascade|set\s+null|restrict|no\s+action)/i', $normalized, $matches) === 1) {
            $code .= $this->foreignActionModifier($matches[1], 'Delete');
        }

        if (preg_match('/on\s+update\s+(cascade|set\s+null|restrict|no\s+action)/i', $normalized, $matches) === 1) {
            $code .= $this->foreignActionModifier($matches[1], 'Update');
        }

        return $code;
    }

    private function foreignActionModifier(string $action, string $suffix): string
    {
        return match (strtolower((string) preg_replace('/\s+/', ' ', trim($action)))) {
            'cascade' => sprintf('->cascadeOn%s()', $suffix),
            'set null' => sprintf('->nullOn%s()', $suffix),
            'restrict' => sprintf('->restrictOn%s()', $suffix),
            default => sprintf('->noActionOn%s()', $suffix),
        };
    }

    /** @param array<string, mixed> $options @param list<string> $warnings */
    private function schemaExpression(array $options, array &$warnings): string
    {
        if ($options['connectionName'] === '') {
            return 'Schema';
        }

        if (preg_match('/^[a-zA-Z0-9_.-]+$/', $options['connectionName']) !== 1) {
            $warnings[] = sprintf('Ignored invalid connection name "%s". Use letters, numbers, dots, underscores, or hyphens.', $options['connectionName']);
            return 'Schema';
        }

        return sprintf('Schema::connection(%s)', $this->phpString($options['connectionName']));
    }

    /** @param list<array{table: string}> $blocks */
    private function wrapMigration(string $code, array $blocks): string
    {
        $drops = array_map(
            fn (array $block): string => sprintf('        Schema::dropIfExists(%s);', $this->phpString($block['table'])),
            array_reverse($blocks),
        );

        return sprintf(
            "<?php\n\nuse Illuminate\\Database\\Migrations\\Migration;\nuse Illuminate\\Database\\Schema\\Blueprint;\nuse Illuminate\\Support\\Facades\\DB;\nuse Illuminate\\Support\\Facades\\Schema;\n\nreturn new class extends Migration\n{\n    public function up(): void\n    {\n%s\n    }\n\n    public function down(): void\n    {\n%s\n    }\n};",
            $code,
            implode("\n", $drops),
        );
    }

    private function cleanIdentifier(string $value): string
    {
        $name = trim($value);
        $name = preg_replace('/^[`"\'\[]|[`"\'\]]$/', '', $name) ?? $name;
        if (str_contains($name, '.')) {
            $parts = explode('.', $name);
            $name = end($parts) ?: $name;
        }

        return preg_replace('/^[`"\']|[`"\']$/', '', $name) ?? $name;
    }

    /** @return list<string> */
    private function extractIdentifiers(string $input): array
    {
        return array_values(array_filter(array_map(fn (string $value): string => $this->cleanIdentifier($value), $this->splitTopLevel($input))));
    }

    private function columnArgument(array $columns): string
    {
        return count($columns) === 1 ? $this->phpString((string) $columns[0]) : $this->phpArray($columns);
    }

    /** @param list<string> $items */
    private function phpArray(array $items): string
    {
        return '[' . implode(', ', array_map([$this, 'phpString'], $items)) . ']';
    }

    private function phpString(string $value): string
    {
        return "'" . str_replace(["\\", "'"], ["\\\\", "\\'"], $value) . "'";
    }

    private function unquoteSql(string $value): string
    {
        $text = trim($value);
        if ((str_starts_with($text, "'") && str_ends_with($text, "'")) || (str_starts_with($text, '"') && str_ends_with($text, '"'))) {
            return str_replace(["\\'", '\\"', '\\\\'], ["'", '"', '\\'], substr($text, 1, -1));
        }

        return $text;
    }
}
