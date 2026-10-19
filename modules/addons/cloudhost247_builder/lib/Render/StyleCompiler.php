<?php
namespace CloudHost247\Builder\Render;

use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Schema\Node;
use CloudHost247\Builder\Schema\StyleSchema;

/**
 * Turns validated styles into a stylesheet.
 *
 * Each element gets one generated class (.ch247-n-<id>). Desktop rules are the
 * base, tablet and mobile rules are collected into two max-width media queries,
 * and responsive visibility is emitted as its own device-scoped rule. Because
 * the compiler only ever reads values that StyleSchema has already approved,
 * the output cannot contain anything an administrator typed verbatim.
 */
final class StyleCompiler
{
    /**
     * Palette and typography defaults, overridden by the global styles record.
     *
     * These are the brand tokens from shared/site/design-system.css, not the builder's own
     * colours: a page compiled with no global styles is still a CloudHost247 page, and it
     * must not open on a palette the rest of the site stopped using.
     */
    const DEFAULT_VARIABLES = array(
        'color-primary' => '#16704b',
        'color-primary-dark' => '#0f5338',
        'color-secondary' => '#0f172a',
        'color-accent' => '#7ff0b4',
        'color-text' => '#1f2937',
        'color-heading' => '#0f172a',
        'color-muted' => '#52646f',
        'color-surface' => '#ffffff',
        'color-background' => '#f3f7f8',
        'color-border' => '#dbe5e8',
        'color-inverse' => '#ffffff',
        'color-success' => '#16704b',
        'color-warning' => '#b4581b',
        'color-danger' => '#a32b2b',
        'font-body' => "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
        'font-heading' => "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
        'font-mono' => "ui-monospace, SFMono-Regular, Menlo, monospace",
        'container-width' => '1180px',
        'radius' => '10px',
        'base-size' => '16px',
    );

    private $variables;

    public function __construct(array $variables = array())
    {
        $this->variables = array_merge(self::DEFAULT_VARIABLES, $this->filter($variables));
    }

    public function variables() { return $this->variables; }

    /** :root custom properties for the page. */
    public function rootCss($scope = ':root')
    {
        $declarations = array();
        foreach ($this->variables as $name => $value) {
            $declarations[] = '--ch247-' . $name . ':' . $value;
        }
        return $scope . '{' . implode(';', $declarations) . '}';
    }

    /** Compile every node in a document into one stylesheet. */
    public function document(Document $document)
    {
        $base = array();
        $tablet = array();
        $mobile = array();
        $desktopOnly = array();

        Node::walk($document->children(), function ($node) use (&$base, &$tablet, &$mobile, &$desktopOnly) {
            $id = Node::id($node);
            if ($id === '') { return; }
            $selector = '.ch247-n-' . $id;
            $style = isset($node['style']) && is_array($node['style']) ? $node['style'] : array();

            foreach (array('desktop' => &$base, 'tablet' => &$tablet, 'mobile' => &$mobile) as $device => &$bucket) {
                if (empty($style[$device]) || !is_array($style[$device])) { continue; }
                $declarations = StyleSchema::declarations($style[$device]);
                if ($declarations) { $bucket[] = $selector . '{' . implode(';', $declarations) . '}'; }
                $overlay = StyleSchema::overlayDeclarations($style[$device]);
                if ($overlay) {
                    $bucket[] = $selector . '{position:relative}';
                    $bucket[] = $selector . '::before{' . implode(';', $overlay) . '}';
                    $bucket[] = $selector . '>*{position:relative;z-index:1}';
                }
            }
            unset($bucket);

            $hidden = isset($node['settings']['hidden']) && is_array($node['settings']['hidden'])
                ? $node['settings']['hidden'] : array();
            if (!empty($hidden['desktop'])) { $desktopOnly[] = $selector . '{display:none !important}'; }
            if (!empty($hidden['tablet'])) { $tablet[] = $selector . '{display:none !important}'; }
            if (!empty($hidden['mobile'])) { $mobile[] = $selector . '{display:none !important}'; }
        });

        $css = implode('', $base);
        if ($desktopOnly) {
            $css .= '@media (min-width:' . (StyleSchema::BREAKPOINTS['tablet'] + 1) . 'px){' . implode('', $desktopOnly) . '}';
        }
        if ($tablet) {
            $css .= '@media (max-width:' . StyleSchema::BREAKPOINTS['tablet'] . 'px){' . implode('', $tablet) . '}';
        }
        if ($mobile) {
            $css .= '@media (max-width:' . StyleSchema::BREAKPOINTS['mobile'] . 'px){' . implode('', $mobile) . '}';
        }
        return $css;
    }

    /** Only accept variables this compiler knows how to emit. */
    private function filter(array $variables)
    {
        $clean = array();
        foreach ($variables as $name => $value) {
            if (!isset(self::DEFAULT_VARIABLES[$name])) { continue; }
            $value = trim((string) $value);
            if ($value === '' || strlen($value) > 160) { continue; }
            if (strncmp($name, 'color-', 6) === 0) {
                $color = StyleSchema::color($value);
                if ($color === null || strncmp($color, '#', 1) !== 0 && strncmp($color, 'rgb', 3) !== 0) { continue; }
                $clean[$name] = $color;
                continue;
            }
            if (strncmp($name, 'font-', 5) === 0) {
                // Font stacks: letters, digits, spaces, quotes, hyphens and commas only.
                if (preg_match('/^[A-Za-z0-9 ,\'"_-]+$/', $value) !== 1) { continue; }
                $clean[$name] = $value;
                continue;
            }
            $length = StyleSchema::length($value);
            if ($length !== null) { $clean[$name] = $length; }
        }
        return $clean;
    }
}
