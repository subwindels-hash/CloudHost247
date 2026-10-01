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
        // Public-site contract absorbed from the retired vendor theme helper.
        // Every key below is read by templates/cloudhost247_legacy; the list is
        // the complete set of keys that theme consumes, so the first-party
        // settings store is a drop-in source for it. Values are overridable
        // from mod_cloudhost247_theme_settings and editable in the admin UI.
        'baidu_pixel_code' => '',
        'banner_background_color' => '#0756d8',
        'banner_button_background_color' => '#12b886',
        'banner_button_text_color' => '#ffffff',
        'banner_text_color' => '#ffffff',
        'bing_verification_code' => '',
        'chat_option_selected' => 'none',
        'cookies_message_text' => 'We use cookies to improve your experience on our site.',
        'cookies_position' => 'bottom',
        'country_calling_code_phone' => '',
        'disable_footer_inner_page' => '',
        'disable_multi_crrency' => '0',
        'dismiss_button_text' => 'Accept',
        'domain_suggestion_display_hmpg' => '1',
        'dropdown_event' => 'hover',
        'enable_browser_cookies_cloudhost247' => '1',
        'enable_header_target' => '1',
        'enable_live_chat_cloudhost247' => '',
        'enable_offer_setting_cloudhost247' => '',
        'enable_primary_sidebar_left' => '',
        'enable_secondary_sidebar_right' => '',
        'enable_sticky_header' => '',
        'facebook_handle_code' => '',
        'facebook_pixel_code' => '',
        'favicon' => '',
        'footer_layout' => 'default',
        'google_analytics_code' => '',
        'google_tag_manager_code' => '',
        'google_verification_code' => '',
        'header_button_link' => '',
        'header_button_txt' => '',
        'header_logo' => '',
        'header_logo_height' => '',
        'header_logo_link' => 'index.php',
        'header_logo_width' => '',
        'instagram_handle_code' => '',
        'invoice_logo' => '',
        'invoice_logo_height' => '',
        'invoice_logo_width' => '',
        'lg_pw_logo' => '',
        'lg_pw_logo_height' => '',
        'lg_pw_logo_width' => '',
        'linkedin_handle_code' => '',
        'live_chat_id' => '',
        'menu_layout' => 'default',
        'offer_background_style_one_color' => '#f5f8ff',
        'offer_hthree_style_one_background_color' => '#f5f8ff',
        'offer_hthree_style_one_off_color' => '#12b886',
        'offer_hthree_style_one_text' => '',
        'offer_hthree_style_one_text_color' => '#111827',
        'offer_logo_style_one' => '',
        'offer_logo_style_one_height' => '',
        'offer_logo_style_one_width' => '',
        'offer_price_style_one_text' => '',
        'offer_style_one_close_button_background_color' => '#0756d8',
        'offer_style_one_close_button_color' => '#ffffff',
        'offer_style_one_coupon_border_color' => '#0756d8',
        'offer_style_one_coupon_code' => '',
        'offer_style_one_coupon_code_color' => '#0756d8',
        'offer_style_one_off' => '',
        'offer_style_one_plan' => '',
        'offer_style_one_plan_color' => '#111827',
        'offer_style_one_use_coupon' => '',
        'offer_style_one_use_coupon_color' => '#0756d8',
        'offer_timer' => '0',
        'phone' => '',
        'phone_display' => '1',
        'pinrest_handle_code' => '',
        'policy_link' => '',
        'policy_link_text' => '',
        'social_site_share' => '1',
        'template_name_custom' => 'cloudhost247_legacy',
        'twitter_handle_code' => '',
        'yandex_verification_code' => '',
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
            $limit = (substr($key, -5) === '_code' || substr($key, -5) === '_text') ? 20000 : 2000;
            if (strlen($value) > $limit) throw new InvalidArgumentException('Setting is too long: ' . $key);
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
        return array('settings' => $this->settings(), 'navigation' => $this->published('navigation',$locale), 'banners' => $this->published('banner',$locale), 'testimonials' => $this->published('testimonial',$locale), 'sections' => $this->published('section',$locale), 'footer' => $this->published('footer',$locale), 'landing_pages' => $this->published('landing',$locale), 'blocks' => $this->blocks($locale), 'current_page_link' => $this->currentPageLink());
    }

    /**
     * Named HTML blocks (copyright, footer_block, footer_block_latest) keyed by
     * slug, sanitised the same way as every other rich-text value.
     */
    public function blocks($locale = null)
    {
        $blocks = array();
        foreach ($this->published('block', $locale) as $item) {
            $widgets = isset($item['widgets']) && is_array($item['widgets']) ? $item['widgets'] : array();
            $blocks[$item['slug']] = (object) array(
                'title' => isset($item['title']) ? (string) $item['title'] : '',
                'sub_title' => isset($item['sub_title']) ? (string) $item['sub_title'] : '',
                'description' => isset($item['description']) ? (string) $item['description'] : '',
                'widgets' => array_values(array_map(function ($widget) { return (object) (is_array($widget) ? $widget : array('widget_description' => (string) $widget)); }, $widgets)),
            );
        }
        return $blocks;
    }

    /**
     * Absolute URL of the page being rendered, for the social share links.
     */
    public function currentPageLink()
    {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = isset($_SERVER['HTTP_HOST']) ? preg_replace('/[^A-Za-z0-9\.\-:\[\]]/', '', $_SERVER['HTTP_HOST']) : '';
        $path = isset($_SERVER['REQUEST_URI']) ? parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) : '';
        $query = isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] !== '' ? '?' . $_SERVER['QUERY_STRING'] : '';
        return $host === '' ? '' : $scheme . '://' . $host . (is_string($path) ? $path : '') . $query;
    }

    /**
     * Block layout for one public landing page: the ordered list of assigned
     * block slugs plus the slug to template-filename map the theme iterates.
     */
    public function pageLayout($pageTitle)
    {
        $slug = $this->slug((string) $pageTitle);
        $slugs = array();
        $layouts = array();
        foreach ($this->published('block') as $item) {
            $pages = isset($item['pages']) && is_array($item['pages']) ? $item['pages'] : array();
            $layout = isset($item['layout']) ? preg_replace('/[^A-Za-z0-9_\-]/', '', (string) $item['layout']) : '';
            if ($layout === '') $layout = $item['slug'];
            $layouts[$item['slug']] = $layout;
            if (!$pages || in_array($slug, array_map(array($this, 'slug'), $pages), true)) $slugs[] = $item['slug'];
        }
        return array('page_blocks' => $slugs, 'block_layouts' => $layouts, 'has_no_block' => $slugs === array());
    }

    /**
     * Fallback product copy used by the public landing pages when a product has
     * no page-specific description row.
     */
    public function defaultProductCopy()
    {
        return array('pHeadSortDesc' => '', 'pDescription' => '', 'pFootCaption' => '', 'pFootSortDesc' => '');
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
    /**
     * Accept site-relative links and absolute https URLs; reject everything else.
     *
     * The '#' inside the character class must stay escaped: '#' is the pattern
     * delimiter, and an unescaped one truncates the pattern so preg_match()
     * returns false with a warning and every internal link degrades to "#".
     * The negative lookahead keeps "//host" and "/\host" out, because browsers
     * fold backslashes to slashes and would treat both as off-site jumps.
     */
    private function safeRelativeOrHttpsUrl($url)
    {
        if ($url === '') return true;
        if (preg_match('#^(?:/(?![/\\\\])|[a-zA-Z0-9][a-zA-Z0-9._-]*\.php(?:[?\#]|$))#', $url)) return true;
        return filter_var($url, FILTER_VALIDATE_URL) && strtolower(parse_url($url, PHP_URL_SCHEME)) === 'https';
    }
    private function sanitizeHtml($html)
    {
        $html = strip_tags((string) $html, '<p><br><strong><em><ul><ol><li><h2><h3><h4><blockquote><a>');
        $html = preg_replace('/\s+on[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
        $html = preg_replace('/\s+(style|srcdoc)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
        $html = preg_replace_callback('/href\s*=\s*(["\'])(.*?)\1/i', function ($m) { return $this->safeRelativeOrHttpsUrl(html_entity_decode($m[2])) ? 'href=' . $m[1] . htmlspecialchars($m[2], ENT_QUOTES, 'UTF-8') . $m[1] : 'href="#"'; }, $html);
        return $html;
    }
}
