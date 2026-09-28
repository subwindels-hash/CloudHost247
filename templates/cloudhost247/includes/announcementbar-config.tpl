{***********************************************************************
 *  CloudHost247 — Announcement Bar data
 *  Path: /templates/cloudhost247/includes/announcementbar-config.tpl
 *
 *  Edit the array below to change what the bar shows. Include this file
 *  immediately before includes/announcementbar.tpl in header.tpl.
 *
 *  Keys:  text (required) | url | icon | external | badge
 *  Leave the array empty ([]) to hide the bar entirely — the component
 *  renders nothing at all when there are no messages.
 ***********************************************************************}

{assign var="announcements" value=[
    [
        'text'  => 'NVMe SSD VPS plans are live — deploy in 55 seconds',
        'url'   => '/vps-hosting.php',
        'icon'  => 'fas fa-bolt',
        'badge' => 'New'
    ],
    [
        'text' => 'Save 30% on annual cPanel hosting with code CH247SAVE',
        'url'  => '/cart.php?promocode=CH247SAVE',
        'icon' => 'fas fa-tag'
    ],
    [
        'text' => 'Free SSL, daily backups and migrations on every plan',
        'url'  => '/ssl-certificate.php',
        'icon' => 'fas fa-lock'
    ],
    [
        'text' => '24/7/365 human support — average first reply under 10 minutes',
        'url'  => '/submitticket.php',
        'icon' => 'fas fa-headset'
    ],
    [
        'text' => 'Network status: all systems operational',
        'icon' => 'fas fa-circle-check'
    ]
]}

{* Optional tuning (uncomment to override the defaults) *}
{* {assign var="announcementBarSpeed" value="45s"} *}
{* {assign var="announcementBarLabel" value="CloudHost247 announcements"} *}

{* ── Dynamic alternative ───────────────────────────────────────────────
   Feed the bar from a WHMCS hook (ClientAreaPage) instead of hard-coding:

       add_hook('ClientAreaPage', 1, function ($vars) {
           return ['announcements' => [
               ['text' => 'Scheduled maintenance Sunday 02:00 UTC',
                'url'  => '/serverstatus.php',
                'icon' => 'fas fa-wrench'],
           ]];
       });

   With the hook in place, header.tpl only needs the announcementbar.tpl
   include — this config file can be skipped.
   ───────────────────────────────────────────────────────────────────── *}
