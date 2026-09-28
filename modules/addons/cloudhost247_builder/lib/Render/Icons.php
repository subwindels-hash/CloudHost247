<?php
namespace CloudHost247\Builder\Render;

/**
 * Built-in icon set.
 *
 * Icons are emitted as inline SVG from this fixed table. Administrators pick a
 * key; they never supply SVG markup, which keeps the well-known SVG script and
 * foreignObject vectors out of published pages entirely.
 */
final class Icons
{
    /** key => path data drawn on a 24x24 grid, stroked. */
    const PATHS = array(
        'check' => 'M4 12.5l5 5 11-11',
        'close' => 'M6 6l12 12M18 6L6 18',
        'arrow-right' => 'M4 12h16M14 6l6 6-6 6',
        'arrow-left' => 'M20 12H4M10 6l-6 6 6 6',
        'arrow-up' => 'M12 20V4M6 10l6-6 6 6',
        'arrow-down' => 'M12 4v16M6 14l6 6 6-6',
        'chevron-down' => 'M6 9l6 6 6-6',
        'chevron-right' => 'M9 6l6 6-6 6',
        'star' => 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z',
        'shield' => 'M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z',
        'bolt' => 'M13 3L5 14h6l-1 7 8-11h-6z',
        'server' => 'M4 5h16v5H4zM4 14h16v5H4zM7.5 7.5h.01M7.5 16.5h.01',
        'cloud' => 'M7 18a4 4 0 010-8 5.5 5.5 0 0110.4 1.6A3.5 3.5 0 0117 18z',
        'globe' => 'M12 3a9 9 0 100 18 9 9 0 000-18zM3.5 9h17M3.5 15h17M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
        'lock' => 'M7 11V8a5 5 0 0110 0v3M5.5 11h13v9h-13z',
        'mail' => 'M3.5 6h17v12h-17zM3.5 7l8.5 6 8.5-6',
        'phone' => 'M7 3.5l3 .5 1 4-2.2 1.6a12 12 0 005.6 5.6L16 13l4 1 .5 3a2 2 0 01-2.2 2A16.5 16.5 0 013.5 5.7 2 2 0 015.5 3.5z',
        'user' => 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0',
        'users' => 'M9 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 6.2a3.5 3.5 0 010 6.6M18 20a6.6 6.6 0 00-2-4.7',
        'cart' => 'M3 4h2.5l2.3 11h9.8l2.4-8H6M10 20h.01M17 20h.01',
        'card' => 'M3 6h18v12H3zM3 10h18M6.5 14.5h4',
        'clock' => 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5.5l3.5 2',
        'chart' => 'M4 20V10M10 20V4M16 20v-7M22 20H2',
        'database' => 'M12 7c4.4 0 8-1.1 8-2.5S16.4 2 12 2 4 3.1 4 4.5 7.6 7 12 7zM4 4.5v15C4 20.9 7.6 22 12 22s8-1.1 8-2.5v-15M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
        'code' => 'M9 7l-5 5 5 5M15 7l5 5-5 5',
        'cog' => 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM12 2.5l1.3 2.6 2.9-.5 1 2.8 2.6 1.4-1.4 2.6 1.4 2.6-2.6 1.4-1 2.8-2.9-.5L12 21.5l-1.3-2.6-2.9.5-1-2.8-2.6-1.4L5.6 12 4.2 9.4l2.6-1.4 1-2.8 2.9.5z',
        'life-buoy' => 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9',
        'search' => 'M11 18a7 7 0 100-14 7 7 0 000 14zM16 16l5 5',
        'play' => 'M8 5.5l11 6.5-11 6.5z',
        'quote' => 'M9.5 7C7 8 5.5 10 5.5 13c0 2.2 1.3 3.7 3.2 3.7 1.7 0 2.9-1.2 2.9-2.8 0-1.6-1.1-2.7-2.6-2.7-.3 0-.6 0-.8.1.3-1.3 1.3-2.4 2.7-3zM18 7c-2.5 1-4 3-4 6 0 2.2 1.3 3.7 3.2 3.7 1.7 0 2.9-1.2 2.9-2.8 0-1.6-1.1-2.7-2.6-2.7-.3 0-.6 0-.8.1.3-1.3 1.3-2.4 2.7-3z',
        'menu' => 'M4 7h16M4 12h16M4 17h16',
        'plus' => 'M12 5v14M5 12h14',
        'minus' => 'M5 12h14',
        'info' => 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5h.01',
        'warning' => 'M12 4l9 16H3zM12 10v4.5M12 17.5h.01',
        'image' => 'M3.5 5h17v14h-17zM3.5 15l4.5-4 3.5 3 3.5-4 5.5 6M8.5 10a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4z',
        'file' => 'M6 3h7l5 5v13H6zM13 3v5h5',
        'link' => 'M10 13a4 4 0 005.7 0l2.8-2.8a4 4 0 10-5.7-5.7L11.5 6M14 11a4 4 0 00-5.7 0L5.5 13.8a4 4 0 105.7 5.7L12.5 18',
    );

    public static function keys()
    {
        return array_keys(self::PATHS);
    }

    public static function has($key)
    {
        return is_string($key) && isset(self::PATHS[$key]);
    }

    /**
     * Inline SVG for one icon.
     *
     * @param string $key   icon name from the table
     * @param int    $size  pixel size
     * @param string $class extra class names, already validated by the caller
     */
    public static function svg($key, $size = 24, $class = '')
    {
        if (!self::has($key)) { return ''; }
        $size = max(8, min(320, (int) $size));
        $class = preg_replace('/[^A-Za-z0-9 _-]/', '', (string) $class);
        return '<svg class="ch247-icon' . ($class !== '' ? ' ' . $class : '') . '" width="' . $size . '" height="' . $size . '"'
            . ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"'
            . ' stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' . self::PATHS[$key] . '"/></svg>';
    }
}
