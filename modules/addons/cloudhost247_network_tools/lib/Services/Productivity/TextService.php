<?php
namespace CloudHost247\NetworkTools\Services\Productivity;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * Text utilities (docs sections 51-56): word counter, Lorem Ipsum, notepad
 * helpers, small-text styles, invisible characters and the runic translator.
 *
 * Every transformation is deterministic and reversible where the character set
 * allows it; the runic translator says so when a character has no mapping
 * instead of dropping it silently. Counting is also performed in the browser,
 * and this implementation is the authoritative one used by the API.
 */
final class TextService extends Service
{
    /** Elder Futhark transliteration used by the runic translator. */
    private static $runic = array(
        'a' => 'ᚨ', 'b' => 'ᛒ', 'c' => 'ᚲ', 'd' => 'ᛞ', 'e' => 'ᛖ', 'f' => 'ᚠ', 'g' => 'ᚷ', 'h' => 'ᚺ',
        'i' => 'ᛁ', 'j' => 'ᛃ', 'k' => 'ᚲ', 'l' => 'ᛚ', 'm' => 'ᛗ', 'n' => 'ᚾ', 'o' => 'ᛟ', 'p' => 'ᛈ',
        'q' => 'ᚲ', 'r' => 'ᚱ', 's' => 'ᛊ', 't' => 'ᛏ', 'u' => 'ᚢ', 'v' => 'ᚹ', 'w' => 'ᚹ', 'x' => 'ᛪ',
        'y' => 'ᛇ', 'z' => 'ᛉ', ' ' => ' ', 'th' => 'ᚦ', 'ng' => 'ᛜ', 'ei' => 'ᛇ',
    );

    /** Small-caps / superscript / subscript / fullwidth mappings. */
    private static $styles = array(
        'small_caps' => array('a' => 'ᴀ', 'b' => 'ʙ', 'c' => 'ᴄ', 'd' => 'ᴅ', 'e' => 'ᴇ', 'f' => 'ꜰ', 'g' => 'ɢ', 'h' => 'ʜ', 'i' => 'ɪ', 'j' => 'ᴊ', 'k' => 'ᴋ', 'l' => 'ʟ', 'm' => 'ᴍ', 'n' => 'ɴ', 'o' => 'ᴏ', 'p' => 'ᴘ', 'q' => 'ǫ', 'r' => 'ʀ', 's' => 'ꜱ', 't' => 'ᴛ', 'u' => 'ᴜ', 'v' => 'ᴠ', 'w' => 'ᴡ', 'x' => 'x', 'y' => 'ʏ', 'z' => 'ᴢ'),
        'superscript' => array('0' => '⁰', '1' => '¹', '2' => '²', '3' => '³', '4' => '⁴', '5' => '⁵', '6' => '⁶', '7' => '⁷', '8' => '⁸', '9' => '⁹', 'a' => 'ᵃ', 'b' => 'ᵇ', 'c' => 'ᶜ', 'd' => 'ᵈ', 'e' => 'ᵉ', 'f' => 'ᶠ', 'g' => 'ᵍ', 'h' => 'ʰ', 'i' => 'ⁱ', 'j' => 'ʲ', 'k' => 'ᵏ', 'l' => 'ˡ', 'm' => 'ᵐ', 'n' => 'ⁿ', 'o' => 'ᵒ', 'p' => 'ᵖ', 'r' => 'ʳ', 's' => 'ˢ', 't' => 'ᵗ', 'u' => 'ᵘ', 'v' => 'ᵛ', 'w' => 'ʷ', 'x' => 'ˣ', 'y' => 'ʸ', 'z' => 'ᶻ'),
        'subscript' => array('0' => '₀', '1' => '₁', '2' => '₂', '3' => '₃', '4' => '₄', '5' => '₅', '6' => '₆', '7' => '₇', '8' => '₈', '9' => '₉', 'a' => 'ₐ', 'e' => 'ₑ', 'h' => 'ₕ', 'i' => 'ᵢ', 'j' => 'ⱼ', 'k' => 'ₖ', 'l' => 'ₗ', 'm' => 'ₘ', 'n' => 'ₙ', 'o' => 'ₒ', 'p' => 'ₚ', 'r' => 'ᵣ', 's' => 'ₛ', 't' => 'ₜ', 'u' => 'ᵤ', 'v' => 'ᵥ', 'x' => 'ₓ'),
    );

    private static $lorem = array(
        'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua',
        'ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat',
        'duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur',
        'excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum',
        'sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium totam rem aperiam',
        'eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo',
        'nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit sed quia consequuntur magni dolores',
        'neque porro quisquam est qui dolorem ipsum quia dolor sit amet consectetur adipisci velit',
    );

    protected function execute()
    {
        $slug = $this->tool() ? $this->tool()->slug() : '';
        if ($slug === 'productivity/lorem-ipsum') {
            return $this->lorem();
        }
        if ($slug === 'productivity/small-text') {
            return $this->smallText();
        }
        if ($slug === 'productivity/invisible-characters') {
            return $this->invisible();
        }
        if ($slug === 'productivity/runic') {
            return $this->runicTranslate();
        }
        return $this->countText($slug === 'productivity/notepad' ? 'notepad' : 'counter');
    }

    private function countText($mode)
    {
        $text = isset($this->input['text']) ? (string) $this->input['text'] : '';
        $characters = $this->length($text);
        $charactersNoSpaces = $this->length(preg_replace('/\s/u', '', $text));
        $words = preg_match_all('/[\p{L}\p{N}_\']+/u', $text, $matches);
        $sentences = preg_match_all('/[^.!?…]+[.!?…]+/u', $text, $sentenceMatches);
        $paragraphs = preg_match_all('/\S(?:.*?\S)?(?:\n\s*\n|$)/su', trim($text), $paragraphMatches);
        $lines = $text === '' ? 0 : count(preg_split('/\R/u', $text));
        $uniqueWords = array();
        foreach ($matches[0] as $word) {
            $uniqueWords[strtolower($word)] = true;
        }
        $readingMinutes = $words > 0 ? max(1, (int) ceil($words / 200)) : 0;
        $speakingMinutes = $words > 0 ? max(1, (int) ceil($words / 130)) : 0;
        $data = array(
            'mode' => $mode,
            'characters' => $characters,
            'characters_without_spaces' => $charactersNoSpaces,
            'words' => $words,
            'unique_words' => count($uniqueWords),
            'sentences' => $sentences,
            'paragraphs' => $paragraphs,
            'lines' => $lines,
            'reading_time_minutes' => $readingMinutes,
            'speaking_time_minutes' => $speakingMinutes,
            'summary' => $characters === 0 ? 'Nothing to count yet.' : $words . ' word(s), ' . $characters . ' character(s); about ' . $readingMinutes . ' minute(s) to read.',
            'note' => 'Counts follow Unicode rules: emoji and combining marks count as characters, and words are letter/number runs. Different writing systems and word counters can disagree slightly.',
        );
        if ($mode === 'notepad') {
            $data['transformations'] = array(
                'trim_lines' => implode("\n", array_map('trim', preg_split('/\R/u', $text))),
                'remove_empty_lines' => implode("\n", array_values(array_filter(preg_split('/\R/u', $text), function ($line) {
                    return trim($line) !== '';
                }))),
                'single_spaces' => preg_replace('/[ \t]+/u', ' ', $text),
                'remove_line_breaks' => preg_replace('/\s*\R\s*/u', ' ', trim($text)),
                'reverse_lines' => implode("\n", array_reverse(preg_split('/\R/u', $text))),
                'sort_lines' => implode("\n", (function ($lines) {
                    $clean = array_values(array_filter($lines, function ($line) {
                        return trim($line) !== '';
                    }));
                    usort($clean, function ($a, $b) {
                        return strcasecmp(trim($a), trim($b));
                    });
                    return $clean;
                })(preg_split('/\R/u', $text))),
            );
            $data['note'] = 'The transformations below are offered for convenience on the text you pasted. Nothing is saved: this page keeps no note.';
        }
        return ToolResult::success($data);
    }

    private function lorem()
    {
        $unit = isset($this->input['unit']) ? $this->input['unit'] : 'paragraphs';
        $count = max(1, min(50, (int) (isset($this->input['count']) ? $this->input['count'] : 3)));
        $startClassic = !empty($this->input['start_classic']);
        $paragraphs = array();
        for ($index = 0; $index < $count; $index++) {
            $paragraph = self::$lorem[$index % count(self::$lorem)];
            if ($index === 0 && $startClassic) {
                $paragraph = 'lorem ipsum dolor sit amet ' . $paragraph;
            }
            $paragraphs[] = ucfirst($paragraph) . '.';
        }
        $text = '';
        if ($unit === 'sentences') {
            $sentences = array();
            foreach ($paragraphs as $paragraph) {
                foreach (preg_split('/(?<=\.)\s+/', $paragraph) as $sentence) {
                    $sentences[] = $sentence;
                }
            }
            $text = implode(' ', array_slice($sentences, 0, $count));
        } elseif ($unit === 'words') {
            $words = preg_split('/\s+/', implode(' ', $paragraphs));
            $text = implode(' ', array_slice($words, 0, $count));
        } else {
            $text = implode("\n\n", $paragraphs);
        }
        return ToolResult::success(array(
            'unit' => $unit,
            'requested' => $count,
            'produced' => $unit === 'words' ? count(preg_split('/\s+/', $text)) : ($unit === 'sentences' ? preg_match_all('/[^.!?]+[.!?]/', $text) : count($paragraphs)),
            'text' => $text,
            'summary' => 'Generated placeholder text as ' . $count . ' ' . $unit . '.',
            'note' => 'Lorem Ipsum is generated from a fixed word pool in the module, so the text is reproducible and contains no tracking, no link and no hidden character.',
        ));
    }

    private function smallText()
    {
        $text = (string) $this->input['text'];
        $style = isset($this->input['style']) ? $this->input['style'] : 'small_caps';
        $map = $this->styleMap($style);
        $output = '';
        $unmapped = 0;
        foreach ($this->characters($text) as $character) {
            $lower = function_exists('mb_strtolower') ? mb_strtolower($character, 'UTF-8') : strtolower($character);
            if (isset($map[$lower])) {
                $output .= $map[$lower];
            } else {
                $output .= $character;
                if (preg_match('/[a-z0-9]/i', $character)) {
                    $unmapped++;
                }
            }
        }
        if ($unmapped > 0) {
            $output = $output;
        }
        return ToolResult::success(array(
            'style' => $style,
            'input' => $text,
            'output' => $output,
            'characters_replaced' => max(0, $this->length($text) - $unmapped),
            'unmapped_characters' => $unmapped,
            'summary' => 'Converted ' . $this->length($text) . ' character(s) with the ' . $style . ' style.',
            'note' => 'Characters without a mapping in this style are kept as typed. Some platforms render these Unicode styles inconsistently, and a few (such as the fullwidth forms) change the meaning of the text.',
        ));
    }

    private function invisible()
    {
        $count = max(1, min(500, (int) (isset($this->input['count']) ? $this->input['count'] : 10)));
        $kind = isset($this->input['kind']) ? $this->input['kind'] : 'braille';
        $characters = array('braille' => "\u{2800}", 'hangul' => "\u{3164}", 'space' => "\u{00A0}");
        if (!isset($characters[$kind])) {
            throw new InvalidArgumentException('That invisible character is not supported.');
        }
        return ToolResult::success(array(
            'kind' => $kind,
            'code_point' => array('braille' => 'U+2800', 'hangul' => 'U+3164', 'space' => 'U+00A0')[$kind],
            'count' => $count,
            'text' => str_repeat($characters[$kind], $count),
            'note' => 'These characters occupy space or are ignored, but they are not truly invisible in every context: screen readers may announce them and some platforms strip them. Use them only where you understand the effect, never to hide content from a person.',
            'summary' => $count . ' invisible character(s) (' . array('braille' => 'Braille blank', 'hangul' => 'Hangul filler', 'space' => 'no-break space')[$kind] . ').',
        ));
    }

    private function runicTranslate()
    {
        $text = (string) $this->input['text'];
        $direction = isset($this->input['direction']) ? $this->input['direction'] : 'to_runic';
        if ($direction === 'to_latin') {
            $reverse = array();
            foreach (self::$runic as $latin => $rune) {
                $reverse[$rune] = $latin;
            }
            $output = '';
            $unmapped = 0;
            foreach ($this->characters($text) as $character) {
                if (isset($reverse[$character])) {
                    $output .= $reverse[$character];
                } elseif (preg_match('/\s/u', $character)) {
                    $output .= ' ';
                } else {
                    $output .= $character;
                    $unmapped++;
                }
            }
            return ToolResult::success(array(
                'direction' => 'to_latin',
                'output' => $output,
                'unmapped_characters' => $unmapped,
                'summary' => 'Converted ' . $this->length($text) . ' character(s) from runes.',
                'note' => 'Runic is a transliteration, not a cipher and not a translation. The same Latin sound can appear as more than one rune, and Latin has letters the Elder Futhark never had.',
            ));
        }
        $lower = function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
        $lower = str_replace(array('th', 'ng', 'ei'), array('ᚦ', 'ᛜ', 'ᛇ'), $lower);
        $output = '';
        $unmapped = 0;
        foreach ($this->characters($lower) as $character) {
            if (isset(self::$runic[$character])) {
                $output .= self::$runic[$character];
            } elseif (preg_match('/\s/u', $character)) {
                $output .= ' ';
            } else {
                $output .= $character;
                if (preg_match('/[a-z]/', $character)) {
                    $unmapped++;
                }
            }
        }
        return ToolResult::success(array(
            'direction' => 'to_runic',
            'output' => $output,
            'unmapped_characters' => $unmapped,
            'summary' => 'Transliterated ' . $this->length($text) . ' character(s) into Elder Futhark runes.',
            'note' => 'Runic transliteration is approximate: v and w share a rune, c/k/q share a rune, and uppercase is not represented. It is decorative text, not a secure encoding.',
        ));
    }

    private function styleMap($style)
    {
        if ($style === 'fullwidth') {
            $alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
            $wide = array('ａ', 'ｂ', 'ｃ', 'ｄ', 'ｅ', 'ｆ', 'ｇ', 'ｈ', 'ｉ', 'ｊ', 'ｋ', 'ｌ', 'ｍ', 'ｎ', 'ｏ', 'ｐ', 'ｑ', 'ｒ', 'ｓ', 'ｔ', 'ｕ', 'ｖ', 'ｗ', 'ｘ', 'ｙ', 'ｚ', '０', '１', '２', '３', '４', '５', '６', '７', '８', '９');
            $fullwidth = array();
            foreach (str_split($alphabet) as $index => $character) {
                $fullwidth[$character] = $wide[$index];
            }
            return $fullwidth;
        }
        return isset(self::$styles[$style]) ? self::$styles[$style] : self::$styles['small_caps'];
    }

    private function characters($text)
    {
        if (function_exists('mb_str_split')) {
            return mb_str_split($text, 1, 'UTF-8');
        }
        return preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY);
    }

    private function length($text)
    {
        return function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
    }
}
