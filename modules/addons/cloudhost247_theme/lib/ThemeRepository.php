<?php
namespace CloudHost247\Theme;

use WHMCS\Database\Capsule;
use InvalidArgumentException;

final class ThemeRepository
{
    const SETTINGS = 'mod_cloudhost247_theme_settings';
    const CONTENT = 'mod_cloudhost247_theme_content';
    private $defaults = array(
        'brand_name' => 'CloudHost247', 'logo_url' => '', 'primary_color' => '#0756d8',
        'accent_color' => '#12b886', 'font_family' => 'Inter, system-ui, sans-serif',
        'footer_text' => 'Reliable cloud services, available around the clock.',
        'support_email' => '', 'hero_title' => 'Cloud infrastructure built for your next idea',
        'hero_text' => 'Fast hosting, straightforward billing, and support whenever you need it.',
        'hero_cta_label' => 'Explore hosting', 'hero_cta_url' => 'cart.php',
        'layout_width' => '1180', 'show_announcement' => '0', 'announcement_text' => '',
    );

    public function settings()
    {
        $settings = $this->defaults;
        foreach (Capsule::table(self::SETTINGS)->get() as $row) $settings[$row->setting_key] = (string) $row->setting_value;
        return $settings;
    }

    public function saveSettings(array $input)
    {
        $allowed = array_keys($this->defaults);
        foreach ($allowed as $key) {
            if (!array_key_exists($key, $input)) continue;
            $value = trim((string) $input[$key]);
            if (in_array($key, array('primary_color', 'accent_color'), true) && !preg_match('/^#[0-9a-fA-F]{6}$/', $value)) throw new InvalidArgumentException('Colors must use six-digit hexadecimal notation.');
            if ($key === 'layout_width' && ((int) $value < 960 || (int) $value > 1600)) throw new InvalidArgumentException('Layout width must be between 960 and 1600 pixels.');
            if (substr($key, -4) === '_url' && !$this->safeRelativeOrHttpsUrl($value)) throw new InvalidArgumentException('Unsafe URL supplied for ' . $key);
            if ($key === 'support_email' && $value !== '' && !filter_var($value, FILTER_VALIDATE_EMAIL)) throw new InvalidArgumentException('Support email is invalid.');
            if (strlen($value) > 2000) throw new InvalidArgumentException('Setting is too long: ' . $key);
            Capsule::table(self::SETTINGS)->updateOrInsert(array('setting_key' => $key), array('setting_value' => $value, 'value_type' => 'string', 'updated_at' => date('Y-m-d H:i:s')));
        }
    }

    public function published($type = null, $locale = null)
    {
        $query = Capsule::table(self::CONTENT)->where('published', 1)->orderBy('sort_order')->orderBy('id');
        if ($type) $query->where('content_type', $type);
        $items = array_map(array($this, 'hydrate'), $query->get()->all());
        return $this->localize($items, $locale);
    }

    public function all($type = null)
    {
        $query = Capsule::table(self::CONTENT)->orderBy('content_type')->orderBy('sort_order')->orderBy('id');
        if ($type) $query->where('content_type', $type);
        return array_map(array($this, 'hydrate'), $query->get()->all());
    }

    public function findPublishedPage($slug, $locale = null)
    {
        $row = Capsule::table(self::CONTENT)->whereIn('content_type', array('page', 'landing'))->where('slug', $this->slug($slug))->where('published', 1)->first();
        if (!$row) return null;
        $items = $this->localize(array($this->hydrate($row)), $locale);
        return $items[0];
    }

    public function saveContent(array $input)
    {
        $types = array('page', 'section', 'navigation', 'banner', 'testimonial', 'footer', 'landing');
        $type = isset($input['content_type']) ? (string) $input['content_type'] : '';
        if (!in_array($type, $types, true)) throw new InvalidArgumentException('Unsupported content type.');
        $id = isset($input['id']) ? (int) $input['id'] : 0;
        $slug = $this->slug(isset($input['slug']) ? $input['slug'] : '');
        $title = trim((string) (isset($input['title']) ? $input['title'] : ''));
        if ($slug === '' || $title === '') throw new InvalidArgumentException('Title and slug are required.');
        $url = trim((string) (isset($input['url']) ? $input['url'] : ''));
        if (!$this->safeRelativeOrHttpsUrl($url)) throw new InvalidArgumentException('Only local or HTTPS links are allowed.');
        $payload = array(
            'body' => $this->sanitizeHtml(isset($input['body']) ? $input['body'] : ''),
            'summary' => trim(strip_tags(isset($input['summary']) ? $input['summary'] : '')),
            'url' => $url, 'image_url' => trim((string) (isset($input['image_url']) ? $input['image_url'] : '')),
            'seo_title' => trim(strip_tags(isset($input['seo_title']) ? $input['seo_title'] : '')),
            'seo_description' => trim(strip_tags(isset($input['seo_description']) ? $input['seo_description'] : '')),
            'og_title' => trim(strip_tags(isset($input['og_title']) ? $input['og_title'] : '')),
            'og_description' => trim(strip_tags(isset($input['og_description']) ? $input['og_description'] : '')),
            'canonical_url' => trim((string)(isset($input['canonical_url']) ? $input['canonical_url'] : '')),
            'sitemap' => !isset($input['sitemap']) || !empty($input['sitemap']),
            'parent_slug' => $this->slug(isset($input['parent_slug']) ? $input['parent_slug'] : ''),
            'open_new' => !empty($input['open_new']),
        );
        if (!$this->safeRelativeOrHttpsUrl($payload['image_url']) || !$this->safeRelativeOrHttpsUrl($payload['canonical_url'])) throw new InvalidArgumentException('Unsafe image or canonical URL.');
        foreach ($payload as $value) if (is_string($value) && strlen($value) > 50000) throw new InvalidArgumentException('Content field is too long.');
        $record = array('content_type' => $type, 'slug' => $slug, 'title' => $title, 'payload_json' => json_encode($payload), 'published' => !empty($input['published']) ? 1 : 0, 'sort_order' => (int) (isset($input['sort_order']) ? $input['sort_order'] : 0), 'updated_at' => date('Y-m-d H:i:s'));
        if ($id) { Capsule::table(self::CONTENT)->where('id', $id)->update($record); return $id; }
        $record['created_at'] = date('Y-m-d H:i:s');
        return Capsule::table(self::CONTENT)->insertGetId($record);
    }

    public function saveTranslation(array $input)
    {
        $contentId = (int) (isset($input['content_id']) ? $input['content_id'] : 0);
        $locale = $this->locale(isset($input['locale']) ? $input['locale'] : '');
        if (!$contentId || !Capsule::table(self::CONTENT)->where('id', $contentId)->exists()) throw new InvalidArgumentException('Content item does not exist.');
        $title = trim(strip_tags(isset($input['title']) ? $input['title'] : ''));
        if ($title === '') throw new InvalidArgumentException('Translated title is required.');
        $payload = array(
            'body' => $this->sanitizeHtml(isset($input['body']) ? $input['body'] : ''),
            'summary' => trim(strip_tags(isset($input['summary']) ? $input['summary'] : '')),
            'seo_title' => trim(strip_tags(isset($input['seo_title']) ? $input['seo_title'] : '')),
            'seo_description' => trim(strip_tags(isset($input['seo_description']) ? $input['seo_description'] : '')),
        );
        Capsule::table('mod_cloudhost247_theme_translations')->updateOrInsert(array('content_id'=>$contentId,'locale'=>$locale), array('title'=>$title,'payload_json'=>json_encode($payload),'updated_at'=>date('Y-m-d H:i:s')));
    }

    public function preview(array $input)
    {
        $copy = $input; $copy['content_type'] = isset($copy['content_type']) ? $copy['content_type'] : 'page';
        return array('title'=>trim(strip_tags(isset($copy['title'])?$copy['title']:'')), 'summary'=>trim(strip_tags(isset($copy['summary'])?$copy['summary']:'')), 'body'=>$this->sanitizeHtml(isset($copy['body'])?$copy['body']:''));
    }

    public function previewTranslation(array $input)
    {
        $locale=$this->locale(isset($input['locale'])?$input['locale']:'');$baseId=(int)(isset($input['content_id'])?$input['content_id']:0);$base=$baseId?Capsule::table(self::CONTENT)->where('id',$baseId)->first():null;if(!$base)throw new InvalidArgumentException('Base content item does not exist.');$baseItem=$this->hydrate($base);$preview=$this->preview($input);return array_merge($baseItem,array_filter($preview,function($v){return$v!=='';}),array('locale'=>$locale,'preview_only'=>true,'published'=>false));
    }

    public function deleteContent($id) { Capsule::table('mod_cloudhost247_theme_translations')->where('content_id',(int)$id)->delete(); return Capsule::table(self::CONTENT)->where('id', (int) $id)->delete(); }

    public function clientContext($locale = null)
    {
        return array('settings' => $this->settings(), 'navigation' => $this->published('navigation',$locale), 'banners' => $this->published('banner',$locale), 'testimonials' => $this->published('testimonial',$locale), 'sections' => $this->published('section',$locale), 'footer' => $this->published('footer',$locale), 'landing_pages' => $this->published('landing',$locale));
    }

    private function localize(array $items, $locale)
    {
        $locale = $this->locale($locale ?: (isset($_SESSION['Language']) ? $_SESSION['Language'] : 'english'));
        if ($locale === 'english' || !$items || !Capsule::schema()->hasTable('mod_cloudhost247_theme_translations')) return $items;
        $ids = array_map(function ($item) { return $item['id']; }, $items);
        $rows = Capsule::table('mod_cloudhost247_theme_translations')->whereIn('content_id',$ids)->where('locale',$locale)->get();
        $translations = array(); foreach ($rows as $row) $translations[$row->content_id] = $row;
        foreach ($items as &$item) if (isset($translations[$item['id']])) {
            $row = $translations[$item['id']]; $payload = json_decode($row->payload_json,true); if (!is_array($payload)) $payload=array();
            $item = array_merge($item, array_filter($payload,function($value){return $value!=='';})); $item['title']=$row->title; $item['locale']=$locale;
        }
        return $items;
    }

    private function locale($value)
    {
        $value = strtolower(str_replace('_','-',trim((string)$value)));
        if (!preg_match('/^[a-z]{2,12}(?:-[a-z]{2,8})?$/',$value)) throw new InvalidArgumentException('Invalid locale.');
        return $value;
    }

    private function hydrate($row)
    {
        $payload = json_decode((string) $row->payload_json, true); if (!is_array($payload)) $payload = array();
        return array_merge(array('id' => (int) $row->id, 'content_type' => $row->content_type, 'slug' => $row->slug, 'title' => $row->title, 'published' => (bool) $row->published, 'sort_order' => (int) $row->sort_order), $payload);
    }
    private function slug($value) { $value = strtolower(trim((string) $value)); return trim(preg_replace('/[^a-z0-9]+/', '-', $value), '-'); }
    private function safeRelativeOrHttpsUrl($url) { if ($url === '') return true; if (preg_match('#^(?:/|[a-zA-Z0-9][a-zA-Z0-9._-]*\.php(?:[?#]|$))#', $url)) return true; return filter_var($url, FILTER_VALIDATE_URL) && strtolower(parse_url($url, PHP_URL_SCHEME)) === 'https'; }
    private function sanitizeHtml($html)
    {
        $html = strip_tags((string) $html, '<p><br><strong><em><ul><ol><li><h2><h3><h4><blockquote><a>');
        $html = preg_replace('/\s+on[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
        $html = preg_replace('/\s+(style|srcdoc)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
        $html = preg_replace_callback('/href\s*=\s*(["\'])(.*?)\1/i', function ($m) { return $this->safeRelativeOrHttpsUrl(html_entity_decode($m[2])) ? 'href=' . $m[1] . htmlspecialchars($m[2], ENT_QUOTES, 'UTF-8') . $m[1] : 'href="#"'; }, $html);
        return $html;
    }
}
