<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Repositories\LibraryRepository;
use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Schema\Node;
use CloudHost247\Builder\Schema\SchemaValidator;

/**
 * Built-in starting points.
 *
 * These are ordinary documents built from the same widget catalogue an
 * administrator uses, validated by the same validator, so a starter template
 * is not a special case anywhere in the system: it can be inserted, edited,
 * duplicated, exported and deleted from the editor like anything else.
 *
 * They contain layout and copy only. Any block that would show a price, a
 * domain rate or a status reads it live from WHMCS at render time, so a
 * starter can never put a fabricated figure on a customer-facing page.
 */
final class Starters
{
    /** Seeded on activation; refreshed when the module is reactivated. */
    public static function templates()
    {
        return array(
            'ch247-hero-split' => array(
                'name' => 'Hero: split with image',
                'category' => 'hero',
                'description' => 'Headline, supporting copy and two buttons beside an image.',
                'document' => self::heroSplit(),
            ),
            'ch247-feature-trio' => array(
                'name' => 'Features: three columns',
                'category' => 'section',
                'description' => 'Three icon and text columns for platform highlights.',
                'document' => self::featureTrio(),
            ),
            'ch247-live-plans' => array(
                'name' => 'Pricing: live hosting plans',
                'category' => 'pricing',
                'description' => 'Section heading with the live WHMCS hosting plans widget.',
                'document' => self::livePlans(),
            ),
            'ch247-domain-band' => array(
                'name' => 'Domain search band',
                'category' => 'section',
                'description' => 'Full-width domain search that posts to the WHMCS domain checker.',
                'document' => self::domainBand(),
            ),
            'ch247-faq' => array(
                'name' => 'FAQ section',
                'category' => 'section',
                'description' => 'Accordion of common questions with structured data.',
                'document' => self::faqSection(),
            ),
            'ch247-contact' => array(
                'name' => 'Contact section',
                'category' => 'contact',
                'description' => 'Contact copy beside a builder form.',
                'document' => self::contactSection(),
            ),
            'ch247-site-header' => array(
                'name' => 'Site header',
                'category' => 'header',
                'description' => 'Logo, navigation menu and account links.',
                'document' => self::siteHeader(),
            ),
            'ch247-site-footer' => array(
                'name' => 'Site footer',
                'category' => 'footer',
                'description' => 'Three footer columns with a copyright line.',
                'document' => self::siteFooter(),
            ),
            'ch247-landing-page' => array(
                'name' => 'Landing page',
                'category' => 'page',
                'description' => 'Complete landing page: hero, features, live plans, FAQ and a call to action.',
                'document' => self::landingPage(),
            ),
        );
    }

    /**
     * Install the built-in templates.
     *
     * Idempotent: saving by key replaces the built-in copy without touching
     * anything an administrator created.
     */
    public static function seed(LibraryRepository $library = null, SchemaValidator $validator = null, $adminId = 0)
    {
        $library = $library ? $library : new LibraryRepository();
        $validator = $validator ? $validator : new SchemaValidator();
        $seeded = array();
        foreach (self::templates() as $key => $template) {
            $document = Document::fromArray(array('children' => $template['document']), $validator, false);
            $library->saveTemplate(array(
                'template_key' => $key,
                'name' => $template['name'],
                'category' => $template['category'],
                'description' => $template['description'],
                'is_builtin' => true,
            ), $document, $adminId);
            $seeded[] = $key;
        }
        return $seeded;
    }

    /** The document a brand-new page starts from. */
    public static function blankPage()
    {
        return array(self::section(array(
            self::container(array(
                self::column(array(
                    self::widget('heading', array('text' => 'A new page', 'level' => 'h1')),
                    self::widget('text', array('content' => '<p>Select this text to edit it, or drag a widget from the left.</p>')),
                ), '100%'),
            )),
        )));
    }

    /* ------------------------------------------------------------ templates */

    private static function heroSplit()
    {
        return array(self::section(array(
            self::container(array(
                self::column(array(
                    self::widget('heading', array('text' => 'Hosting that keeps up with you', 'level' => 'h1')),
                    self::widget('text', array('content' => '<p>Fast NVMe servers, free migration and support that answers. Choose a plan and we will move you today.</p>')),
                    self::widget('cta', array(
                        'heading' => 'Ready when you are',
                        'text' => 'Every plan includes free migration and a 30-day money-back guarantee.',
                        'button_label' => 'See plans',
                        'button_url' => 'cart.php',
                        'secondary_label' => 'Talk to us',
                        'secondary_url' => 'contact.php',
                    )),
                ), '55%'),
                self::column(array(
                    self::widget('image', array('alt' => 'Platform illustration')),
                ), '45%'),
            )),
        ), array('padding_top' => '80px', 'padding_bottom' => '80px')));
    }

    private static function featureTrio()
    {
        $feature = function ($icon, $title, $body) {
            return Starters::column(array(
                Starters::widget('icon', array('icon' => $icon, 'size' => 34, 'icon_color' => 'primary')),
                Starters::widget('heading', array('text' => $title, 'level' => 'h3')),
                Starters::widget('text', array('content' => '<p>' . $body . '</p>')),
            ), '33%');
        };
        return array(self::section(array(
            self::container(array(
                self::column(array(
                    self::widget('heading', array('text' => 'Built for people who cannot afford downtime', 'level' => 'h2')),
                ), '100%'),
            )),
            self::container(array(
                $feature('bolt', 'NVMe everywhere', 'Every plan runs on NVMe storage with no shared spinning disks.'),
                $feature('shield', 'Daily backups', 'Automatic backups with restore from the client area.'),
                $feature('life-buoy', 'Support that answers', 'Tickets are answered by engineers, not scripts.'),
            )),
        )));
    }

    private static function livePlans()
    {
        return array(self::section(array(
            self::container(array(
                self::column(array(
                    self::widget('heading', array('text' => 'Choose a plan', 'level' => 'h2')),
                    self::widget('text', array('content' => '<p>Prices below come straight from our billing system.</p>')),
                    self::widget('hosting_plans', array(
                        'group' => 0, 'billing_cycle' => 'monthly', 'limit' => 3, 'columns' => 3,
                        'show_description' => true, 'button_label' => 'Order now', 'highlight' => 2,
                    )),
                ), '100%'),
            )),
        )));
    }

    private static function domainBand()
    {
        return array(self::section(array(
            self::container(array(
                self::column(array(
                    self::widget('domain_search', array(
                        'heading' => 'Start with the right name',
                        'placeholder' => 'yourbusiness.com',
                        'button_label' => 'Search',
                        'show_pricing' => true,
                        'tlds' => '.com,.net,.org,.ng',
                    )),
                ), '100%'),
            )),
        ), array('padding_top' => '56px', 'padding_bottom' => '56px', 'background_color' => 'surface')));
    }

    private static function faqSection()
    {
        return array(self::section(array(
            self::container(array(
                self::column(array(
                    self::widget('heading', array('text' => 'Questions we get a lot', 'level' => 'h2')),
                    self::widget('faq', array(
                        'schema_markup' => true,
                        'items' => array(
                            array('question' => 'How long does a migration take?', 'answer' => '<p>Most sites move the same day. Larger accounts are scheduled with you so there is no surprise downtime.</p>'),
                            array('question' => 'Can I upgrade later?', 'answer' => '<p>Yes. Upgrades are prorated automatically in the client area.</p>'),
                            array('question' => 'Do you offer refunds?', 'answer' => '<p>Hosting plans include a 30-day money-back guarantee. Domains follow registry rules.</p>'),
                        ),
                    )),
                ), '100%'),
            )),
        )));
    }

    private static function contactSection()
    {
        return array(self::section(array(
            self::container(array(
                self::column(array(
                    self::widget('heading', array('text' => 'Talk to a human', 'level' => 'h2')),
                    self::widget('text', array('content' => '<p>Tell us what you are running and we will tell you exactly what it needs.</p>')),
                    self::widget('list', array('items' => array(
                        array('text' => 'Answers within one business hour', 'icon' => 'clock'),
                        array('text' => 'Free migration assessment', 'icon' => 'check'),
                        array('text' => 'No sales scripts', 'icon' => 'user'),
                    ))),
                ), '45%'),
                self::column(array(
                    self::widget('contact_form', array(
                        'form' => 0, 'title' => 'Send a message', 'submit_label' => 'Send',
                    )),
                ), '55%'),
            )),
        )));
    }

    private static function siteHeader()
    {
        return array(self::section(array(
            self::container(array(
                self::column(array(
                    self::widget('site_logo', array('alt' => 'CloudHost247', 'url' => '/', 'width' => 170)),
                ), '25%'),
                self::column(array(
                    self::widget('nav_menu', array('menu' => 0, 'orientation' => 'horizontal', 'collapse_mobile' => true)),
                ), '50%'),
                self::column(array(
                    self::widget('account_links', array(
                        'show_client_area' => true, 'show_login' => true, 'show_register' => true, 'variant' => 'ghost',
                    )),
                ), '25%'),
            ), array('align_items' => 'center', 'justify_content' => 'space-between')),
        ), array('padding_top' => '16px', 'padding_bottom' => '16px'), 'header'));
    }

    private static function siteFooter()
    {
        return array(self::section(array(
            self::container(array(
                self::column(array(
                    self::widget('site_logo', array('alt' => 'CloudHost247', 'url' => '/', 'width' => 150)),
                    self::widget('text', array('content' => '<p>Managed hosting, domains and cloud servers.</p>')),
                ), '40%'),
                self::column(array(
                    self::widget('heading', array('text' => 'Company', 'level' => 'h4')),
                    self::widget('nav_menu', array('menu' => 0, 'orientation' => 'vertical', 'collapse_mobile' => false)),
                ), '30%'),
                self::column(array(
                    self::widget('heading', array('text' => 'Platform status', 'level' => 'h4')),
                    self::widget('service_status', array('heading' => '', 'limit' => 4, 'show_checked_at' => false)),
                ), '30%'),
            )),
            self::container(array(
                self::column(array(
                    self::widget('divider', array('line_style' => 'solid', 'thickness' => 1, 'width' => 100, 'line_color' => 'border')),
                    self::widget('copyright', array('text' => 'CloudHost247. All rights reserved.', 'show_year' => true)),
                ), '100%'),
            )),
        ), array('padding_top' => '48px', 'padding_bottom' => '32px'), 'footer'));
    }

    private static function landingPage()
    {
        return array_merge(
            self::heroSplit(),
            self::featureTrio(),
            self::livePlans(),
            self::domainBand(),
            self::faqSection()
        );
    }

    /* -------------------------------------------------------------- builders */

    public static function section(array $children, array $style = array(), $tag = 'section')
    {
        $node = Node::make('section', '', array('html_tag' => $tag, 'content_width' => 'boxed'), array(
            'desktop' => array_merge(array('padding_top' => '64px', 'padding_bottom' => '64px'), $style),
        ));
        $node['children'] = $children;
        return $node;
    }

    public static function container(array $children, array $style = array())
    {
        $node = Node::make('container', '', array('html_tag' => 'div', 'layout' => 'flex'), array(
            'desktop' => array_merge(array(
                'display' => 'flex', 'flex_direction' => 'row', 'gap' => '32px',
                'align_items' => 'stretch', 'flex_wrap' => 'wrap',
            ), $style),
            'mobile' => array('flex_direction' => 'column', 'gap' => '20px'),
        ));
        $node['children'] = $children;
        return $node;
    }

    public static function column(array $children, $basis = '50%')
    {
        $node = Node::make('column', '', array('html_tag' => 'div', 'vertical_align' => 'flex-start'), array(
            'desktop' => array(
                'flex_basis' => $basis, 'flex_grow' => '1', 'display' => 'flex',
                'flex_direction' => 'column', 'gap' => '16px',
            ),
            'mobile' => array('flex_basis' => '100%'),
        ));
        $node['children'] = $children;
        return $node;
    }

    public static function widget($key, array $props = array(), array $style = array())
    {
        return Node::make('widget', $key, $props, $style ? array('desktop' => $style) : array());
    }
}
