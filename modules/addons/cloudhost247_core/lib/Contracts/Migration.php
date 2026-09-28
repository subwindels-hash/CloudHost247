<?php
namespace CloudHost247\Foundation\Contracts;

interface Migration
{
    public function version();
    public function description();
    public function up();
}
