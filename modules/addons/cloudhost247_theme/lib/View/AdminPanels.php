<?php
namespace CloudHost247\Theme\View;

use CloudHost247\Theme\ThemeRepository;

/**
 * Admin panels for the Theme Manager that are too large to inline in the addon
 * output function: the per-type ordering list and the visual preview.
 *
 * Both build all markup through one escaping helper, so an operator-supplied
 * title, slug or note cannot break out of the panel.
 */
final class AdminPanels
{
    /**
     * Drag-and-drop ordering, one panel per content type.
     *
     * The dragged order is what gets saved: the list posts `ids[]` in DOM order.
     * The number field beside each row is the no-JavaScript fallback and is
     * rewritten by the drag handler after every drop, so both shapes describe
     * the same order.
     */
    public static function order(array $content, $token)
    {
        $groups = array();
        foreach (ThemeRepository::TYPES as $type) {
            $rows = array();
            foreach ($content as $item) {
                if (isset($item['content_type']) && $item['content_type'] === $type) { $rows[] = $item; }
            }
            if ($rows) { $groups[$type] = $rows; }
        }
        if (!$groups) { return '<p>No content to order yet.</p>'; }
        $html = '<p class="help-block">Ordering is per content type and is validated server-side: a list that omits, repeats or invents an item is refused whole, so a half-applied order is impossible.</p>';
        foreach ($groups as $type => $rows) {
            $html .= '<div class="panel panel-default"><div class="panel-heading"><strong>' . self::e(ucfirst($type)) . '</strong> <small>' . count($rows) . ' item(s) &mdash; drag the rows, then save</small></div><div class="panel-body">'
                . '<form method="post"><input type="hidden" name="token" value="' . self::e($token) . '"><input type="hidden" name="operation" value="reorder"><input type="hidden" name="content_type" value="' . self::e($type) . '">'
                . '<ul class="list-group ch247-order-list" data-type="' . self::e($type) . '">';
            foreach ($rows as $position => $item) {
                $html .= '<li class="list-group-item" draggable="true" style="cursor:move">'
                    . '<input type="hidden" name="ids[]" value="' . self::e($item['id']) . '">'
                    . '<span class="glyphicon glyphicon-menu-hamburger" aria-hidden="true"></span> '
                    . self::e($item['title']) . ' <span class="text-muted">(' . self::e($item['slug']) . ')</span>'
                    . (empty($item['published']) ? ' <span class="label label-default">Draft</span>' : '')
                    . '<input class="form-control" style="width:90px;float:right" type="number" name="order[' . self::e($item['id']) . ']" value="' . self::e($position) . '" aria-label="Position of ' . self::e($item['title']) . '">'
                    . '</li>';
            }
            $html .= '</ul><button class="btn btn-primary">Save order</button></form></div></div>';
        }
        return $html . self::script();
    }

    /**
     * Visual preview of unsaved values: the custom properties the live head hook
     * emits, a structural sketch of the client theme, and the notes explaining
     * anything the preview could not show.
     */
    public static function visual(array $visual)
    {
        $html = '<div class="panel panel-default" style="margin-top:20px"><div class="panel-heading">Visual preview <small>unsaved values &mdash; a layout sketch; no stored markup is executed</small></div><div class="panel-body">'
            . '<style>' . self::e($visual['css']) . '</style>' . $visual['markup'];
        if (!empty($visual['notes'])) {
            $html .= '<ul class="text-warning" style="margin-top:12px">';
            foreach ($visual['notes'] as $note) { $html .= '<li>' . self::e($note) . '</li>'; }
            $html .= '</ul>';
        }
        return $html . '</div></div>';
    }

    /** Drag to reorder; the drop rewrites every position field to match the DOM. */
    private static function script()
    {
        return '<script>(function(){var lists=document.querySelectorAll(".ch247-order-list");'
            . 'function attach(list){var dragging=null;'
            . 'list.addEventListener("dragstart",function(event){var row=event.target.closest("li");if(!row){return;}dragging=row;event.dataTransfer.effectAllowed="move";});'
            . 'list.addEventListener("dragover",function(event){event.preventDefault();var row=event.target.closest("li");if(!row||row===dragging){return;}var box=row.getBoundingClientRect();var after=(event.clientY-box.top)>box.height/2;list.insertBefore(dragging,after?row.nextSibling:row);});'
            . 'list.addEventListener("dragend",function(){dragging=null;var rows=list.querySelectorAll("li");for(var n=0;n<rows.length;n++){var field=rows[n].querySelector("input[type=number]");if(field){field.value=n;}}});'
            . '}for(var i=0;i<lists.length;i++){attach(lists[i]);}})();</script>';
    }

    private static function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
