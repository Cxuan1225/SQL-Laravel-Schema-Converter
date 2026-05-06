<?php

declare(strict_types=1);

namespace SqlLaravelSchemaConverter;

use Illuminate\Support\ServiceProvider;
use SqlLaravelSchemaConverter\Commands\ConvertSqlSchemaCommand;

class SqlLaravelSchemaConverterServiceProvider extends ServiceProvider
{
    public function register(): void
    {
    }

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([
                ConvertSqlSchemaCommand::class,
            ]);
        }
    }
}
