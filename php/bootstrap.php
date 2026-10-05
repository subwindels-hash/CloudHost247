<?php
/**
 * CloudHost247 — single include for every public PHP page.
 *
 *   require __DIR__ . '/php/bootstrap.php';
 *   echo ch247_page([...meta...], $contentHtml);
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/api.php';
require_once __DIR__ . '/layout.php';
require_once __DIR__ . '/blocks.php';
