<?php
namespace CloudHost247\Builder\Render;

use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Schema\Node;
use CloudHost247\Builder\Widgets\WidgetCatalog;

/**
 * The one renderer.
 *
 * The visual editor canvas, the draft preview and the published page are all
 * produced here from the same validated document, which is what makes "preview
 * matches published" structurally true rather than a promise: the editor does
 * not own a second copy of the layout logic.
 *
 * Output is built from escaped values only. Identifiers are re-checked before
 * they reach a class name or a data attribute, so nothing in a stored document
 * can break out of the markup it belongs to.
 */
final class Renderer
{
    private $catalog;
    private $compiler;
    private $widgets;

    public function __construct(WidgetCatalog $catalog = null, StyleCompiler $compiler = null, WidgetRenderer $widgets = null)
    {
        $this->catalog = $catalog ? $catalog : new WidgetCatalog();
        $this->compiler = $compiler ? $compiler : new StyleCompiler();
        $this->widgets = $widgets ? $widgets : new WidgetRenderer($this->catalog);
    }

    public function catalog() { return $this->catalog; }

    public function compiler() { return $this->compiler; }

    /**
     * @return array array('html', 'css', 'notices')
     */
    public function render(Document $document, RenderContext $context)
    {
        $html = $this->nodes($document->children(), $context);
        if ($html === '' && $context->isEditor()) {
            $html = '<div class="ch247-empty-page" data-ch247-dropzone="root" data-ch247-index="0">'
                . '<p>This page is empty. Drag a section from the left, or start from a template.</p></div>';
        }
        return array(
            'html' => $html,
            'css' => $this->compiler->document($document),
            'notices' => $context->notices(),
        );
    }

    /** Render a list of sibling nodes. */
    public function nodes(array $nodes, RenderContext $context)
    {
        $html = '';
        foreach ($nodes as $node) {
            if (!Node::isNode($node)) { continue; }
            $html .= $this->node($node, $context);
        }
        return $html;
    }

    public function node(array $node, RenderContext $context)
    {
        $type = Node::type($node);
        $key = Node::catalogKey($node);
        if (!$this->catalog->has($key)) { return ''; }

        switch ($type) {
            case 'section': return $this->section($node, $context);
            case 'container': return $this->container($node, $context);
            case 'column': return $this->column($node, $context);
            default: return $this->widget($node, $context);
        }
    }

    /* ------------------------------------------------------------ structure */

    private function section(array $node, RenderContext $context)
    {
        $props = $this->props($node);
        $tag = $this->tag(isset($props['html_tag']) ? $props['html_tag'] : 'section');
        $boxed = (isset($props['content_width']) ? $props['content_width'] : 'boxed') !== 'full';
        $inner = '<div class="ch247-section__inner' . ($boxed ? ' ch247-boxed' : ' ch247-full') . '">'
            . $this->children($node, $context, 'container')
            . '</div>';
        return '<' . $tag . $this->attributes($node, array('ch247-node', 'ch247-section'), $context) . '>' . $inner . '</' . $tag . '>';
    }

    private function container(array $node, RenderContext $context)
    {
        $props = $this->props($node);
        $tag = $this->tag(isset($props['html_tag']) ? $props['html_tag'] : 'div');
        $layout = isset($props['layout']) ? $props['layout'] : 'flex';
        $classes = array('ch247-node', 'ch247-container', 'ch247-layout-' . ($layout === 'grid' ? 'grid' : ($layout === 'block' ? 'block' : 'flex')));
        return '<' . $tag . $this->attributes($node, $classes, $context) . '>'
            . $this->children($node, $context, 'element')
            . '</' . $tag . '>';
    }

    private function column(array $node, RenderContext $context)
    {
        $props = $this->props($node);
        $tag = $this->tag(isset($props['html_tag']) ? $props['html_tag'] : 'div');
        $align = isset($props['vertical_align']) ? $props['vertical_align'] : 'flex-start';
        $classes = array('ch247-node', 'ch247-column');
        $style = in_array($align, array('flex-start', 'center', 'flex-end'), true) ? ' style="justify-content:' . $align . '"' : '';
        return '<' . $tag . $this->attributes($node, $classes, $context) . $style . '>'
            . $this->children($node, $context, 'element')
            . '</' . $tag . '>';
    }

    private function widget(array $node, RenderContext $context)
    {
        $key = Node::catalogKey($node);
        $inner = $this->widgets->render($key, $node, $context, $this);
        if ($inner === '' && $context->isPublish()) {
            // Nothing verifiable to show: leave no empty shell on the live page.
            return '';
        }
        $classes = array('ch247-node', 'ch247-widget', 'ch247-widget--' . preg_replace('/[^a-z0-9_]/', '', $key));
        return '<div' . $this->attributes($node, $classes, $context) . '>' . $inner . '</div>';
    }

    private function children(array $node, RenderContext $context, $expects)
    {
        $html = $this->nodes(Node::children($node), $context);
        if ($html === '' && $context->isEditor()) {
            $id = Node::id($node);
            $label = $expects === 'container' ? 'Drop a container here' : 'Drop elements here';
            $html = '<div class="ch247-dropzone" data-ch247-dropzone="' . $this->e($id) . '" data-ch247-index="0">'
                . $this->e($label) . '</div>';
        }
        return $html;
    }

    /* --------------------------------------------------------------- helpers */

    private function props(array $node)
    {
        return isset($node['props']) && is_array($node['props']) ? $node['props'] : array();
    }

    /** Only the tags the catalogue offers may be emitted. */
    private function tag($tag)
    {
        $allowed = array('div', 'section', 'header', 'footer', 'main', 'article', 'aside', 'nav');
        return in_array($tag, $allowed, true) ? $tag : 'div';
    }

    private function attributes(array $node, array $classes, RenderContext $context)
    {
        $id = Node::id($node);
        if (preg_match('/^[a-z][a-z0-9]{3,31}$/', $id) === 1) { $classes[] = 'ch247-n-' . $id; }

        $settings = isset($node['settings']) && is_array($node['settings']) ? $node['settings'] : array();
        if (!empty($settings['css_class'])) {
            foreach (preg_split('/\s+/', (string) $settings['css_class']) as $class) {
                if (preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,63}$/', $class) === 1) { $classes[] = $class; }
            }
        }

        $attributes = ' class="' . $this->e(implode(' ', array_unique($classes))) . '"';
        if (!empty($settings['anchor']) && preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,63}$/', (string) $settings['anchor']) === 1) {
            $attributes .= ' id="' . $this->e($settings['anchor']) . '"';
        }
        if ($context->isEditor()) {
            $attributes .= ' data-ch247-id="' . $this->e($id) . '"'
                . ' data-ch247-type="' . $this->e(Node::type($node)) . '"'
                . ' data-ch247-widget="' . $this->e(Node::catalogKey($node)) . '"';
        }
        return $attributes;
    }

    private function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
