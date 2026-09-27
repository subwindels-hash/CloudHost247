{* ═════════════════════════════════════════════════════════════════════ *}
{*   Announcement Bar — Example Smarty Arrays & Usage Patterns           *}
{* ═════════════════════════════════════════════════════════════════════ *}


{* ───────────────────────────────────────────────────────────────────── *}
{*  1. BASIC: Simple text-only messages (no links)                       *}
{* ───────────────────────────────────────────────────────────────────── *}

{assign var="announcements" value=[
    ['text'=>'Welcome to CloudHost247 Isc — Your trusted hosting partner since 2010'],
    ['text'=>'Free migration assistance with every plan'],
    ['text'=>'99.9% Uptime SLA guaranteed']
]}

{include file="includes/announcementbar.tpl"}


{* ───────────────────────────────────────────────────────────────────── *}
{*  2. STANDARD: Messages with internal links                            *}
{* ───────────────────────────────────────────────────────────────────── *}

{assign var="announcements" value=[
    ['text'=>'🚀 NVMe SSD VPS now available — Up to 10x faster!', 'url'=>'/cart.php?gid=12'],
    ['text'=>'💬 24/7 Live Chat Support', 'url'=>'/support.php'],
    ['text'=>'🔒 Free SSL Certificate included', 'url'=>'/ssl-certificates.php'],
    ['text'=>'🎉 Summer Sale: 30% OFF — Use code SUMMER30', 'url'=>'/cart.php?promocode=SUMMER30']
]}

{include file="includes/announcementbar.tpl"}


{* ───────────────────────────────────────────────────────────────────── *}
{*  3. ADVANCED: With Font Awesome icons and external links                *}
{* ───────────────────────────────────────────────────────────────────── *}

{assign var="announcements" value=[
    ['text'=>'New Data Center in Singapore', 'url'=>'/datacenters.php', 'icon'=>'fas fa-globe-asia'],
    ['text'=>'cPanel License $15/month', 'url'=>'/cart.php?gid=5', 'icon'=>'fas fa-cube'],
    ['text'=>'Join our Affiliate Program', 'url'=>'https://affiliates.example.com', 'icon'=>'fas fa-hand-holding-usd', 'external'=>true],
    ['text'=>'DDoS Protection included free', 'url'=>'/ddos-protection.php', 'icon'=>'fas fa-shield-alt']
]}

{include file="includes/announcementbar.tpl"}


{* ───────────────────────────────────────────────────────────────────── *}
{*  4. DYNAMIC: From PHP Hook / Module (Recommended for production)       *}
{*                                                                              *}
{*  In a WHMCS hook or custom module, populate the variable:              *}
{*                                                                              *}
{*      $smarty->assign('announcementBarMessages', [                      *}
{*          ['text'=>'Message 1', 'url'=>'/url1'],                        *}
{*          ['text'=>'Message 2', 'url'=>'/url2'],                        *}
{*      ]);                                                               *}
{*                                                                              *}
{*  Then in header.tpl simply use:                                          *}
{* ───────────────────────────────────────────────────────────────────── *}

{assign var="announcements" value=$announcementBarMessages|default:[]}
{include file="includes/announcementbar.tpl"}


{* ───────────────────────────────────────────────────────────────────── *}
{*  5. CONDITIONAL: Only show during promotions                            *}
{* ───────────────────────────────────────────────────────────────────── *}

{if isset($promoActive) && $promoActive}
    {assign var="announcements" value=[
        ['text'=>'⚡ Flash Sale: 50% OFF Managed Hosting', 'url'=>'/flash-sale.php', 'icon'=>'fas fa-bolt'],
        ['text'=>'Offer ends midnight tonight!', 'url'=>'/flash-sale.php', 'icon'=>'fas fa-clock']
    ]}
    {include file="includes/announcementbar.tpl"}
{/if}


{* ───────────────────────────────────────────────────────────────────── *}
{*  6. MULTI-LANGUAGE: Using WHMCS language strings                        *}
{* ───────────────────────────────────────────────────────────────────── *}

{assign var="announcements" value=[
    ['text'=>{lang key='announcementNvmeVps'}, 'url'=>'/cart.php?gid=12'],
    ['text'=>{lang key='announcementLiveChat'}, 'url'=>'/support.php'],
    ['text'=>{lang key='announcementFreeSsl'}, 'url'=>'/ssl-certificates.php']
]}

{include file="includes/announcementbar.tpl"}


{* ═════════════════════════════════════════════════════════════════════ *}
{*   ARRAY STRUCTURE REFERENCE                                            *}
{* ═════════════════════════════════════════════════════════════════════ *}

{* Field      | Type    | Required | Description                           *}
{* ───────────────────────────────────────────────────────────────────── *}
{* text       | string  | Yes      | The announcement message text         *}
{* url        | string  | No       | Destination URL (makes item clickable)  *}
{* icon       | string  | No       | Font Awesome CSS class (e.g. fas fa-*)  *}
{* external   | bool    | No       | Opens in new tab if true                *}
{* ───────────────────────────────────────────────────────────────────── *}
