<?php
namespace CloudHost247\NetworkTools\Services\Webmaster;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * SERP simulator (docs section 37). Formatting and length guidance only. It is
 * not a ranking preview and the payload says so, because presenting a made-up
 * ranking would violate the no-fabrication rule.
 */
final class SerpService extends Service
{
    protected function execute()
    {
        $title = trim((string) $this->input['title']);
        $url = trim((string) $this->input['url']);
        $description = trim((string) (isset($this->input['description']) ? $this->input['description'] : ''));
        if ($title === '' || $url === '') {
            return ToolResult::invalid('Enter both a title and a display URL.');
        }
        $titleLength = $this->length($title);
        $descriptionLength = $this->length($description);
        $guidance = array(
            array('element' => 'Title', 'value' => $title, 'length' => $titleLength, 'recommended' => '50–60 characters', 'status' => $titleLength > 60 ? 'LONG' : ($titleLength < 15 ? 'SHORT' : 'GOOD'), 'note' => 'Search engines rewrite titles frequently, especially when they are too long or do not match the query.'),
            array('element' => 'Description', 'value' => $description, 'length' => $descriptionLength, 'recommended' => '120–160 characters', 'status' => $description === '' ? 'MISSING' : ($descriptionLength > 160 ? 'LONG' : ($descriptionLength < 70 ? 'SHORT' : 'GOOD')), 'note' => $description === '' ? 'With no description, the search engine composes a snippet from the page text, which often reads poorly.' : 'The snippet is generated per query and is often a rewritten extract, so the description is a hint, not a promise.'),
            array('element' => 'Display URL', 'value' => $url, 'length' => $this->length($url), 'recommended' => 'Under 60 characters', 'status' => $this->length($url) > 60 ? 'LONG' : 'GOOD', 'note' => 'Breadcrumbs may replace this with site structure instead.'),
        );
        $warnings = array();
        foreach ($guidance as $item) {
            if ($item['status'] === 'LONG') {
                $warnings[] = $item['element'] . ' is longer than the recommended length and is likely to be truncated in results.';
            }
            if ($item['status'] === 'MISSING') {
                $warnings[] = $item['element'] . ' is empty.';
            }
        }
        return ToolResult::success(array(
            'preview' => array(
                'url' => $url,
                'breadcrumb' => $this->breadcrumb($url),
                'title' => $title,
                'description' => $description,
            ),
            'guidance' => $guidance,
            'character_units' => 'Characters counted as UTF-8 code points; pixels vary by device and font.',
            'simulator_notice' => 'This is a simulator, not a Google preview and not a ranking prediction. Real results depend on the query, the device, personalisation, competition and many factors this tool cannot observe.',
            'summary' => 'Preview generated. Title ' . $titleLength . ' characters, description ' . ($descriptionLength === 0 ? 'empty' : $descriptionLength . ' characters') . '.',
        ), $warnings);
    }

    private function length($value)
    {
        if (function_exists('mb_strlen')) {
            return mb_strlen($value, 'UTF-8');
        }
        return strlen($value);
    }

    private function breadcrumb($url)
    {
        $display = preg_replace('#^https?://#i', '', $url);
        $display = rtrim(str_replace('/', ' › ', $display), ' ');
        return $display;
    }
}
