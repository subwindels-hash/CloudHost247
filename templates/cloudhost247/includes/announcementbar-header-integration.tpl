{***********************************************************************
 *  CloudHost247 — Announcement Bar: header.tpl integration snippet
 *  Path: /templates/cloudhost247/includes/announcementbar-header-integration.tpl
 *
 *  This file is documentation, not a rendered template. Copy the two
 *  include lines below into header.tpl, directly after <body> and
 *  BEFORE the navbar include.
 *
 *  NOTE ON THIS THEME
 *  ------------------
 *  "CloudHost247" (templates/cloudhost247, theme.yaml name: CloudHost247)
 *  is a Twenty-One CHILD theme: it does not ship its own header.tpl and
 *  inherits the parent one. To integrate, copy the parent header once:
 *
 *      cp templates/twenty-one/header.tpl templates/cloudhost247/header.tpl
 *
 *  then add the snippet below to the child copy. The full legacy theme
 *  (templates/cloudhost247_legacy/header.tpl) already has it wired in.
 ***********************************************************************}

{* ─────────── SNIPPET — paste into header.tpl ─────────── *}

{* <body ...> *}

    {* CloudHost247 Announcement Bar — must stay ABOVE the navbar.
       Renders nothing when $announcements is empty or unset. *}
    {include file="$template/includes/announcementbar-config.tpl"}
    {include file="$template/includes/announcementbar.tpl"}

    {* <nav class="navbar ..."> … existing navbar include … *}

{* ─────────── END SNIPPET ─────────── *}


{* ═══════════════════════════════════════════════════════════════════
   BEFORE (stock Twenty-One header.tpl)
   ═══════════════════════════════════════════════════════════════════

   <body data-phone-cc-input="{$phoneNumberInputStyle}" class="...">
       {include file="$template/includes/navbar.tpl" navbar=$primaryNavbar}
       ...

   AFTER
   ═══════════════════════════════════════════════════════════════════

   <body data-phone-cc-input="{$phoneNumberInputStyle}" class="...">
       {include file="$template/includes/announcementbar-config.tpl"}
       {include file="$template/includes/announcementbar.tpl"}
       {include file="$template/includes/navbar.tpl" navbar=$primaryNavbar}
       ...
   ═══════════════════════════════════════════════════════════════════

   VARIANTS
   --------
   1) Inline data, no config file:

      {include file="$template/includes/announcementbar.tpl" announcements=[
          ['text' => 'Free SSL on every plan', 'url' => '/ssl-certificate.php', 'icon' => 'fas fa-lock'],
          ['text' => '24/7 expert support', 'url' => '/submitticket.php']
      ]}

   2) Hook-driven data (ClientAreaPage hook assigns $announcements):

      {include file="$template/includes/announcementbar.tpl"}

   3) Custom speed / label:

      {include file="$template/includes/announcementbar.tpl"
               announcementBarSpeed="50s"
               announcementBarLabel="Promotions and service notices"}

   4) Show only on the client-area homepage:

      {if $templatefile == 'homepage'}
          {include file="$template/includes/announcementbar-config.tpl"}
          {include file="$template/includes/announcementbar.tpl"}
      {/if}
   ═══════════════════════════════════════════════════════════════════ *}
