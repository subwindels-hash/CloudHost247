<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Marketing\Domain\TemplateBlock;
use CloudHost247\Marketing\Repositories\TemplateRepository;
use CloudHost247\Marketing\Security\HtmlSanitizer;

/**
 * The email builder (requirement #9, #30).
 *
 * A design is a list of catalog blocks and nothing else. Rendering turns that
 * list into one table-based, inline-styled HTML document plus a plain-text
 * alternative; both are stored with the template so a campaign copies exactly
 * what was previewed. Two rules matter more than the markup:
 *
 *   1. There is no path from operator input to an arbitrary tag, attribute or
 *      URL. Copy goes through the sanitizer, links through the URL validator,
 *      and everything else is generated.
 *   2. A block that cannot be rendered safely is skipped with a warning instead
 *      of being rendered approximately. Warnings are shown in the editor and
 *      recorded on save, never discarded silently.
 */
final class TemplateService
{
    const MAX_TEXT = 2000;

    private $templates;

    public function __construct(TemplateRepository $templates = null)
    {
        $this->templates = $templates ?: new TemplateRepository();
    }

    public function repository()
    {
        return $this->templates;
    }

    /** The catalog the admin builder renders from. */
    public function catalog()
    {
        return TemplateBlock::all();
    }

    // -------------------------------------------------------------- validation

    /**
     * @param array|string $design
     * @param bool $strict true on save (required fields enforced)
     * @return array{blocks:array}
     */
    public function normaliseDesign($design, $strict = true)
    {
        if (is_string($design)) {
            $decoded = json_decode($design, true);
            if (!is_array($decoded)) { throw new \InvalidArgumentException('The template design is not valid JSON.'); }
            $design = $decoded;
        }
        if (!is_array($design)) { throw new \InvalidArgumentException('The template design must be a block list.'); }
        $blocks = isset($design['blocks']) ? $design['blocks'] : $design;
        if (!is_array($blocks) || !$blocks) { throw new \InvalidArgumentException('A template needs at least one block.'); }
        if (count($blocks) > TemplateBlock::MAX_BLOCKS) {
            throw new \InvalidArgumentException('A template may carry at most ' . TemplateBlock::MAX_BLOCKS . ' blocks.');
        }

        $canonical = array();
        foreach (array_values($blocks) as $index => $block) {
            $number = $index + 1;
            if (!is_array($block) || !isset($block['type']) || !TemplateBlock::isValid($block['type'])) {
                throw new \InvalidArgumentException('Block ' . $number . ' has an unknown type.');
            }
            $type = (string) $block['type'];
            $fields = TemplateBlock::definition($type)['fields'];
            $row = array('type' => $type);

            foreach ($fields as $name => $field) {
                $value = isset($block[$name]) ? $block[$name] : null;
                $row[$name] = $this->normaliseField($number, $type, $name, $field, $value, $strict);
            }

            // Fields the catalog does not know are dropped, never stored: a
            // design written by an older build must not smuggle unknown keys
            // into a future renderer.
            $canonical[] = $row;
        }

        return array('blocks' => $canonical);
    }

    private function normaliseField($number, $type, $name, array $field, $value, $strict)
    {
        $label = TemplateBlock::label($type);

        if ($field['type'] === TemplateBlock::TYPE_INT) {
            if ($value === null || $value === '') {
                if (!empty($field['required']) && $strict) { throw new \InvalidArgumentException('Block ' . $number . ' (' . $label . '): ' . $field['label'] . ' is required.'); }
                return isset($field['default']) ? (int) $field['default'] : null;
            }
            if (!preg_match('/^-?\d+$/', (string) $value)) {
                throw new \InvalidArgumentException('Block ' . $number . ' (' . $label . '): ' . $field['label'] . ' must be a whole number.');
            }
            $int = (int) $value;
            if (isset($field['min']) && $int < $field['min']) { throw new \InvalidArgumentException('Block ' . $number . ' (' . $label . '): ' . $field['label'] . ' must be at least ' . $field['min'] . '.'); }
            if (isset($field['max']) && $int > $field['max']) { throw new \InvalidArgumentException('Block ' . $number . ' (' . $label . '): ' . $field['label'] . ' must be at most ' . $field['max'] . '.'); }
            return $int;
        }

        $value = is_scalar($value) ? trim((string) $value) : '';

        if ($field['type'] === TemplateBlock::TYPE_ENUM) {
            if ($value === '') { return isset($field['default']) ? (string) $field['default'] : (string) $field['values'][0]; }
            if (!in_array($value, $field['values'], true)) {
                throw new \InvalidArgumentException('Block ' . $number . ' (' . $label . '): ' . $field['label'] . ' must be one of ' . implode(', ', $field['values']) . '.');
            }
            return $value;
        }

        if ($value === '') {
            if (!empty($field['required']) && $strict) {
                throw new \InvalidArgumentException('Block ' . $number . ' (' . $label . '): ' . $field['label'] . ' is required.');
            }
            return '';
        }

        $max = isset($field['max']) ? (int) $field['max'] : self::MAX_TEXT;
        if (strlen($value) > $max) {
            throw new \InvalidArgumentException('Block ' . $number . ' (' . $label . '): ' . $field['label'] . ' must be at most ' . $max . ' characters.');
        }

        if ($field['type'] === TemplateBlock::TYPE_URL) {
            if (!empty($field['required']) || $value !== '') {
                $safe = HtmlSanitizer::safeUrl($value);
                if ($safe === '') { $safe = HtmlSanitizer::safeMailto($value); }
                if ($safe === '') {
                    if (!empty($field['required']) && $strict) {
                        throw new \InvalidArgumentException('Block ' . $number . ' (' . $label . '): ' . $field['label'] . ' must be an absolute http(s) or mailto URL.');
                    }
                    return '';
                }
                return $safe;
            }
            return '';
        }

        if ($field['type'] === TemplateBlock::TYPE_TEXTAREA && $name === 'items') {
            $items = preg_split('/\r\n|\r|\n/', $value, -1, PREG_SPLIT_NO_EMPTY);
            if (count($items) > TemplateBlock::MAX_BULLETS) {
                throw new \InvalidArgumentException('Block ' . $number . ' (' . $label . '): at most ' . TemplateBlock::MAX_BULLETS . ' items.');
            }
            return implode("\n", array_map(function ($item) { return trim($item); }, $items));
        }

        return $value;
    }

    // -------------------------------------------------------------- rendering

    /**
     * Renders a design. Preview and save call the same method, so a preview can
     * never look better than what is stored.
     *
     * @param array|string $design canonical or loose
     * @return array{html:string,text:string,warnings:string[]}
     */
    public function render($design)
    {
        $design = $this->normaliseDesign($design, false);
        $warnings = array();
        $rows = '';
        $text = array();

        foreach ($design['blocks'] as $index => $block) {
            $number = $index + 1;
            $rendered = $this->renderBlock($block, $number, $warnings);
            if ($rendered === null) { continue; }
            $rows .= $rendered['html'];
            if ($rendered['text'] !== '') { $text[] = $rendered['text']; }
        }

        $html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f7fa;padding:24px 0;">'
            . '<tr><td align="center">'
            . '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;">'
            . $rows
            . '</table></td></tr></table>';

        return array('html' => $html, 'text' => trim(implode("\n\n", $text)), 'warnings' => $warnings);
    }

    /** @return array{html:string,text:string}|null null when the block was skipped */
    private function renderBlock(array $block, $number, array &$warnings)
    {
        $type = $block['type'];
        $label = TemplateBlock::label($type);
        $align = isset($block['align']) ? $this->align($block['align']) : 'left';
        $font = 'font-family:Arial,Helvetica,sans-serif;';

        switch ($type) {
            case TemplateBlock::TYPE_HEADING:
                if (!trim((string) $block['text'])) { $warnings[] = 'Block ' . $number . ' (' . $label . '): no text — skipped.'; return null; }
                $sizes = array('1' => 28, '2' => 22, '3' => 18);
                $level = isset($sizes[(string) $block['level']]) ? (string) $block['level'] : '2';
                $size = $sizes[$level];
                $copy = HtmlSanitizer::richText($block['text']);
                return array(
                    'html' => '<tr><td align="' . $align . '" style="padding:24px 32px 8px;' . $font . 'font-size:' . $size . 'px;line-height:1.3;font-weight:bold;color:#12263f;">' . $copy . '</td></tr>',
                    'text' => HtmlSanitizer::plainText($block['text']),
                );

            case TemplateBlock::TYPE_PARAGRAPH:
                if (!trim((string) $block['text'])) { $warnings[] = 'Block ' . $number . ' (' . $label . '): no text — skipped.'; return null; }
                $copy = HtmlSanitizer::richText(nl2br((string) $block['text']));
                return array(
                    'html' => '<tr><td align="' . $align . '" style="padding:8px 32px;' . $font . 'font-size:15px;line-height:1.6;color:#3b4a5a;">' . $copy . '</td></tr>',
                    'text' => HtmlSanitizer::plainText($block['text']),
                );

            case TemplateBlock::TYPE_BULLETS:
                $items = preg_split('/\r\n|\r|\n/', (string) $block['items'], -1, PREG_SPLIT_NO_EMPTY);
                if (!$items) { $warnings[] = 'Block ' . $number . ' (' . $label . '): no items — skipped.'; return null; }
                $out = '';
                $text = array();
                foreach ($items as $item) {
                    $out .= '<li style="margin:0 0 6px;">' . HtmlSanitizer::richText($item) . '</li>';
                    $text[] = '* ' . HtmlSanitizer::plainText($item);
                }
                return array(
                    'html' => '<tr><td style="padding:8px 32px;' . $font . 'font-size:15px;line-height:1.6;color:#3b4a5a;"><ul style="margin:0;padding-left:20px;">' . $out . '</ul></td></tr>',
                    'text' => implode("\n", $text),
                );

            case TemplateBlock::TYPE_BUTTON:
                $href = HtmlSanitizer::safeUrl($block['url']);
                if ($href === '') { $href = HtmlSanitizer::safeMailto($block['url']); }
                if ($href === '' || !trim((string) $block['label'])) {
                    $warnings[] = 'Block ' . $number . ' (' . $label . '): label or safe URL missing — skipped.';
                    return null;
                }
                $background = $block['variant'] === 'secondary' ? '#e8eef5' : '#1f6fb2';
                $colour = $block['variant'] === 'secondary' ? '#12263f' : '#ffffff';
                return array(
                    'html' => '<tr><td align="' . $align . '" style="padding:16px 32px;">'
                        . '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
                        . '<td bgcolor="' . $background . '" style="border-radius:4px;">'
                        . '<a href="' . htmlspecialchars($href, ENT_QUOTES, 'UTF-8') . '" style="display:inline-block;padding:12px 22px;' . $font . 'font-size:15px;font-weight:bold;color:' . $colour . ';text-decoration:none;">'
                        . htmlspecialchars((string) $block['label'], ENT_QUOTES, 'UTF-8') . '</a></td></tr></table></td></tr>',
                    'text' => HtmlSanitizer::plainText($block['label']) . ': ' . $href,
                );

            case TemplateBlock::TYPE_IMAGE:
                $src = HtmlSanitizer::safeUrl($block['url']);
                $alt = trim((string) $block['alt']);
                if ($src === '' || $alt === '') {
                    $warnings[] = 'Block ' . $number . ' (' . $label . '): image URL or alternative text missing — skipped.';
                    return null;
                }
                $width = max(100, min(600, (int) $block['width']));
                $img = '<img src="' . htmlspecialchars($src, ENT_QUOTES, 'UTF-8') . '" alt="' . htmlspecialchars($alt, ENT_QUOTES, 'UTF-8') . '" width="' . $width . '" style="display:block;border:0;max-width:100%;height:auto;" />';
                $link = HtmlSanitizer::safeUrl(isset($block['link_url']) ? $block['link_url'] : '');
                if ($link !== '') { $img = '<a href="' . htmlspecialchars($link, ENT_QUOTES, 'UTF-8') . '" style="text-decoration:none;">' . $img . '</a>'; }
                return array(
                    'html' => '<tr><td align="center" style="padding:8px 32px;">' . $img . '</td></tr>',
                    'text' => '[image: ' . HtmlSanitizer::plainText($alt) . ']' . ($link !== '' ? "\n" . $link : ''),
                );

            case TemplateBlock::TYPE_DIVIDER:
                return array(
                    'html' => '<tr><td style="padding:8px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
                        . '<td style="border-top:1px solid #e3e8ee;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>',
                    'text' => '---',
                );

            case TemplateBlock::TYPE_SPACER:
                $height = max(8, min(96, (int) $block['height']));
                return array(
                    'html' => '<tr><td style="height:' . $height . 'px;font-size:0;line-height:0;">&nbsp;</td></tr>',
                    'text' => '',
                );

            case TemplateBlock::TYPE_LEGAL:
                if (!trim((string) $block['text'])) { $warnings[] = 'Block ' . $number . ' (' . $label . '): no text — skipped.'; return null; }
                return array(
                    'html' => '<tr><td style="padding:20px 32px 28px;' . $font . 'font-size:12px;line-height:1.5;color:#7b8794;">' . HtmlSanitizer::richText(nl2br((string) $block['text'])) . '</td></tr>',
                    'text' => HtmlSanitizer::plainText($block['text']),
                );
        }

        $warnings[] = 'Block ' . $number . ': unknown type "' . $type . '" — skipped.';
        return null;
    }

    private function align($value)
    {
        return in_array($value, array('left', 'center', 'right'), true) ? $value : 'left';
    }

    // ------------------------------------------------------------ persistence

    /**
     * Creates (id = 0) or updates a template. Audited; rendered output is stored.
     *
     * $strict = false is used when a block has just been added from the catalog
     * defaults: the design is stored with warnings shown in the editor, and the
     * explicit Save button (strict) is what refuses missing required values.
     */
    public function save(array $input, $id = 0, $strict = true)
    {
        $design = $this->normaliseDesign(isset($input['design']) ? $input['design'] : array(), $strict);
        $rendered = $this->render($design);
        $before = array();

        if ((int) $id > 0) {
            $existing = $this->templates->find((int) $id);
            if (!$existing) { throw new \InvalidArgumentException('Unknown template.'); }
            $existingDesign = TemplateRepository::designOf($existing);
            $before = array('name' => $existing->name, 'blocks' => count($existingDesign['blocks']));
            $template = $this->templates->update((int) $id, array(
                'name' => isset($input['name']) ? $input['name'] : $existing->name,
                'category' => isset($input['category']) ? $input['category'] : $existing->category,
                'design' => $design,
                'html' => $rendered['html'],
                'text' => $rendered['text'],
            ));
            $action = 'template.updated';
        } else {
            $template = $this->templates->create(array(
                'template_key' => isset($input['template_key']) ? $input['template_key'] : '',
                'name' => isset($input['name']) ? $input['name'] : '',
                'category' => isset($input['category']) ? $input['category'] : 'general',
                'design' => $design,
                'html' => $rendered['html'],
                'text' => $rendered['text'],
                'source' => 'custom',
            ));
            $action = 'template.created';
        }

        AuditLogger::record('cloudhost247_marketing', $action, 'marketing_template', (int) $template->id, $before, array(
            'key' => (string) $template->template_key,
            'name' => (string) $template->name,
            'blocks' => count($design['blocks']),
            'warnings' => $rendered['warnings'],
        ), 'success');

        return array('template' => $template, 'warnings' => $rendered['warnings']);
    }

    public function archive($id)
    {
        $template = $this->templates->find((int) $id);
        if (!$template) { throw new \InvalidArgumentException('Unknown template.'); }
        if ($template->status === 'archived') { return $template; }
        $template = $this->templates->archive((int) $id);
        AuditLogger::record('cloudhost247_marketing', 'template.archived', 'marketing_template', (int) $template->id,
            array('status' => 'active'), array('status' => 'archived', 'key' => (string) $template->template_key), 'success');
        return $template;
    }

    public function activate($id)
    {
        $template = $this->templates->find((int) $id);
        if (!$template) { throw new \InvalidArgumentException('Unknown template.'); }
        if ($template->status === 'active') { return $template; }
        $template = $this->templates->activate((int) $id);
        AuditLogger::record('cloudhost247_marketing', 'template.reactivated', 'marketing_template', (int) $template->id,
            array('status' => 'archived'), array('status' => 'active', 'key' => (string) $template->template_key), 'success');
        return $template;
    }

    public function delete($id)
    {
        $template = $this->templates->find((int) $id);
        if (!$template) { throw new \InvalidArgumentException('Unknown template.'); }
        $this->templates->delete((int) $id);
        AuditLogger::record('cloudhost247_marketing', 'template.deleted', 'marketing_template', (int) $template->id,
            array('key' => (string) $template->template_key, 'name' => (string) $template->name), array(), 'success');
        return true;
    }

    /** Renders without writing anything — the editor's preview button. */
    public function preview($design)
    {
        return $this->render($design);
    }

    /**
     * The three builtin templates every install starts with. Idempotent, called
     * from activation; an operator who edits a builtin keeps the edit because
     * the seed only fills missing keys.
     */
    public function ensureBuiltins()
    {
        $created = 0;
        foreach ($this->builtinDefinitions() as $key => $definition) {
            if ($this->templates->findByKey($key)) { continue; }
            $rendered = $this->render($definition['design']);
            $this->templates->create(array(
                'template_key' => $key,
                'name' => $definition['name'],
                'category' => $definition['category'],
                'design' => $definition['design'],
                'html' => $rendered['html'],
                'text' => $rendered['text'],
                'source' => 'builtin',
            ));
            $created++;
        }
        return $created;
    }

    /** @return array<string,array> */
    public function builtinDefinitions()
    {
        $legal = "CloudHost247\nYou are receiving this e-mail because you subscribed to our announcements.\nUnsubscribe: use the link at the bottom of this message.";

        return array(
            'builtin-plain' => array(
                'name' => 'Plain message',
                'category' => 'general',
                'design' => array('blocks' => array(
                    array('type' => 'heading', 'text' => 'A short heading', 'level' => '2', 'align' => 'left'),
                    array('type' => 'paragraph', 'text' => "Write your message here.\n\nKeep it short and say exactly what you need the reader to do.", 'align' => 'left'),
                    array('type' => 'legal', 'text' => $legal),
                )),
            ),
            'builtin-announcement' => array(
                'name' => 'Announcement',
                'category' => 'newsletter',
                'design' => array('blocks' => array(
                    array('type' => 'heading', 'text' => 'Something worth announcing', 'level' => '1', 'align' => 'center'),
                    array('type' => 'paragraph', 'text' => 'Explain the change in one or two sentences, then point the reader at the one action that matters.', 'align' => 'center'),
                    array('type' => 'button', 'label' => 'Read more', 'url' => 'https://cloudhost247.example/announcements', 'variant' => 'primary', 'align' => 'center'),
                    array('type' => 'legal', 'text' => $legal),
                )),
            ),
            'builtin-image-newsletter' => array(
                'name' => 'Image newsletter',
                'category' => 'newsletter',
                'design' => array('blocks' => array(
                    array('type' => 'heading', 'text' => 'Monthly update', 'level' => '1', 'align' => 'left'),
                    array('type' => 'image', 'url' => 'https://cloudhost247.example/newsletter-header.png', 'alt' => 'CloudHost247 monthly update', 'link_url' => '', 'width' => 600),
                    array('type' => 'paragraph', 'text' => 'A short introduction to this months update.', 'align' => 'left'),
                    array('type' => 'bullets', 'items' => "What changed\nWhat it means for you\nWhat to do next"),
                    array('type' => 'button', 'label' => 'See the details', 'url' => 'https://cloudhost247.example/newsletter', 'variant' => 'primary', 'align' => 'left'),
                    array('type' => 'divider'),
                    array('type' => 'legal', 'text' => $legal),
                )),
            ),
        );
    }
}
