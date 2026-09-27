{* ════════════════════════════════════════════════════════════ *}
{*   HostX Theme — Header Integration Snippet                     *}
{*   Add this to: /templates/hostx/header.tpl                    *}
{*   Place it directly after the <body> tag and BEFORE navbar   *}
{* ════════════════════════════════════════════════════════════ *}

{* ─── Option A: Static announcements defined in template ─── *}
{assign var="announcements" value=[
    ['text'=>'🚀 New: NVMe SSD VPS Plans now available!', 'url'=>'/cart.php?gid=12', 'icon'=>'fas fa-bolt'],
    ['text'=>'💬 24/7 Live Chat Support — We are here to help', 'url'=>'/support.php', 'icon'=>'fas fa-comments'],
    ['text'=>'🔒 Free SSL with every hosting plan', 'url'=>'/ssl-certificates.php', 'icon'=>'fas fa-lock'],
    ['text'=>'🎉 Summer Sale: 30% OFF Shared Hosting — Use code SUMMER30', 'url'=>'/cart.php?promocode=SUMMER30', 'icon'=>'fas fa-tag']
]}

{* ─── Option B: Dynamic announcements from WHMCS Hook / addon *}
{* assign var="announcements" value=$announcementBarMessages *}

{include file="includes/announcementbar.tpl"}

{* ════════════════════════════════════════════════════════════ *}
{*   EXAMPLE PLACEMENT IN header.tpl                             *}
{* ════════════════════════════════════════════════════════════ *}

{* Recommended location in header.tpl:                        *}
{*                                                              *}
{*   <body>                                                     *}
{*     {include file="includes/announcementbar.tpl"}           *}
{*     <nav class="navbar navbar-default">...                   *}
{*                                                              *}
{* Or if you prefer to assign announcements first:              *}
{*                                                              *}
{*   <body>                                                     *}
{*     {assign var="announcements" value=[...]}                  *}
{*     {include file="includes/announcementbar.tpl"}           *}
{*     <nav class="navbar navbar-default">...                   *}
{*                                                              *}
{* ════════════════════════════════════════════════════════════ *}
