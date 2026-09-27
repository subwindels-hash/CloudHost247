<?php
/**
 * CloudHost247 Tools - Gaming Tools Implementation
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/../functions.php';

function CloudHost247_tool_minecraft_colors($post)
{
    $text = CloudHost247_tools_sanitize($post['text'] ?? '', 'string');
    $action = CloudHost247_tools_sanitize($post['mc_action'] ?? 'preview', 'string');

    $colors = [
        ['code' => '&0', 'name' => 'Black', 'hex' => '#000000', 'bg' => '#000000'],
        ['code' => '&1', 'name' => 'Dark Blue', 'hex' => '#0000AA', 'bg' => '#0000AA'],
        ['code' => '&2', 'name' => 'Dark Green', 'hex' => '#00AA00', 'bg' => '#00AA00'],
        ['code' => '&3', 'name' => 'Dark Aqua', 'hex' => '#00AAAA', 'bg' => '#00AAAA'],
        ['code' => '&4', 'name' => 'Dark Red', 'hex' => '#AA0000', 'bg' => '#AA0000'],
        ['code' => '&5', 'name' => 'Dark Purple', 'hex' => '#AA00AA', 'bg' => '#AA00AA'],
        ['code' => '&6', 'name' => 'Gold', 'hex' => '#FFAA00', 'bg' => '#FFAA00'],
        ['code' => '&7', 'name' => 'Gray', 'hex' => '#AAAAAA', 'bg' => '#AAAAAA'],
        ['code' => '&8', 'name' => 'Dark Gray', 'hex' => '#555555', 'bg' => '#555555'],
        ['code' => '&9', 'name' => 'Blue', 'hex' => '#5555FF', 'bg' => '#5555FF'],
        ['code' => '&a', 'name' => 'Green', 'hex' => '#55FF55', 'bg' => '#55FF55'],
        ['code' => '&b', 'name' => 'Aqua', 'hex' => '#55FFFF', 'bg' => '#55FFFF'],
        ['code' => '&c', 'name' => 'Red', 'hex' => '#FF5555', 'bg' => '#FF5555'],
        ['code' => '&d', 'name' => 'Light Purple', 'hex' => '#FF55FF', 'bg' => '#FF55FF'],
        ['code' => '&e', 'name' => 'Yellow', 'hex' => '#FFFF55', 'bg' => '#FFFF55'],
        ['code' => '&f', 'name' => 'White', 'hex' => '#FFFFFF', 'bg' => '#FFFFFF'],
    ];

    $formats = [
        ['code' => '&k', 'name' => 'Obfuscated/Magic'],
        ['code' => '&l', 'name' => 'Bold'],
        ['code' => '&m', 'name' => 'Strikethrough'],
        ['code' => '&n', 'name' => 'Underline'],
        ['code' => '&o', 'name' => 'Italic'],
        ['code' => '&r', 'name' => 'Reset'],
    ];

    if ($action === 'preview' && !empty($text)) {
        // Convert color codes to HTML preview
        $html = preg_replace_callback('/&([0-9a-fk-or])/', function ($matches) use ($colors) {
            $code = '&' . $matches[1];
            foreach ($colors as $c) {
                if ($c['code'] === $code) {
                    return '</span><span style="color:' . $c['hex'] . '">';
                }
            }
            if ($code === '&r') {
                return '</span><span>';
            }
            if ($code === '&l') {
                return '</span><span style="font-weight:bold">';
            }
            if ($code === '&o') {
                return '</span><span style="font-style:italic">';
            }
            if ($code === '&n') {
                return '</span><span style="text-decoration:underline">';
            }
            if ($code === '&m') {
                return '</span><span style="text-decoration:line-through">';
            }
            return '';
        }, $text);
        $html = '<span>' . $html . '</span>';
    } else {
        $html = '';
    }

    return [
        'colors' => $colors,
        'formats' => $formats,
        'input' => $text,
        'preview_html' => $html,
    ];
}
