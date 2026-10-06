<!doctype html>
<html lang="{$activeLocale.languageCode|default:'en'|escape}"{if $activeLocale.textDirection == 'rtl'} dir="rtl"{/if}>
<head>
    <meta charset="{$charset}" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>{if $ch247Site.home}Build. Host. Deploy. Scale.{else}{if $kbarticle.title}{$kbarticle.title|escape} - {/if}{$pagetitle|escape}{/if} | CloudHost247</title>
    {include file="$template/includes/head.tpl"}
    {$headoutput}
    {include file="cloudhost247/includes/site-head.tpl"}
</head>
<body class="primary-bg-color ch-site {if $ch247Site.public}ch-public{else}ch-workspace{/if}" data-phone-cc-input="{$phoneNumberInputStyle}">
    {if $captcha}{$captcha->getMarkup()}{/if}
    {$headeroutput}

    {* CloudHost247 Announcement Bar — placed ABOVE the navbar *}
    {include file="$template/includes/announcementbar.tpl"}

    {if !$ch247Builder.header_html}{include file="cloudhost247/includes/site-nav.tpl"}{/if}
        {if $loggedin}
            <div class="topbar">
                <div class="container">
                    <div class="d-flex">
                        <div class="mr-auto">
                            <button type="button" class="btn" data-toggle="popover" id="accountNotifications" data-placement="bottom">
                                <i class="far fa-flag"></i>
                                {if count($clientAlerts) > 0}
                                    {count($clientAlerts)}
                                    <span class="d-none d-sm-inline">{lang key='notifications'}</span>
                                {else}
                                    <span class="d-sm-none">0</span>
                                    <span class="d-none d-sm-inline">{lang key='nonotifications'}</span>
                                {/if}
                            </button>
                            <div id="accountNotificationsContent" class="w-hidden">
                                <ul class="client-alerts">
                                {foreach $clientAlerts as $alert}
                                    <li>
                                        <a href="{$alert->getLink()}">
                                            <i class="fas fa-fw fa-{if $alert->getSeverity() == 'danger'}exclamation-circle{elseif $alert->getSeverity() == 'warning'}exclamation-triangle{elseif $alert->getSeverity() == 'info'}info-circle{else}check-circle{/if}"></i>
                                            <div class="message">{$alert->getMessage()}</div>
                                        </a>
                                    </li>
                                {foreachelse}
                                    <li class="none">
                                        {lang key='notificationsnone'}
                                    </li>
                                {/foreach}
                                </ul>
                            </div>
                        </div>

                        <div class="ml-auto">
                            <div class="input-group active-client" role="group">
                                <div class="input-group-prepend d-none d-md-inline">
                                    <span class="input-group-text">{lang key='loggedInAs'}:</span>
                                </div>
                                <div class="btn-group">
                                    <a href="{$WEB_ROOT}/clientarea.php?action=details" class="btn btn-active-client">
                                        <span>
                                            {if $client.companyname}
                                                {$client.companyname}
                                            {else}
                                                {$client.fullName}
                                            {/if}
                                        </span>
                                    </a>
                                    <a href="{routePath('user-accounts')}" class="btn" data-toggle="tooltip" data-placement="bottom" title="Switch Account">
                                        <i class="fad fa-random"></i>
                                    </a>
                                    {if $adminMasqueradingAsClient || $adminLoggedIn}
                                        <a href="{$WEB_ROOT}/logout.php?returntoadmin=1" class="btn btn-return-to-admin" data-toggle="tooltip" data-placement="bottom" title="{if $adminMasqueradingAsClient}{lang key='adminmasqueradingasclient'} {lang key='logoutandreturntoadminarea'}{else}{lang key='adminloggedin'} {lang key='returntoadminarea'}{/if}">
                                            <i class="fas fa-redo-alt"></i>
                                            <span class="d-none d-md-inline-block">{lang key="admin.returnToAdmin"}</span>
                                        </a>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        {/if}

    {if !$ch247Site.public}
    <nav class="ch-client-nav" aria-label="Account navigation"><div class="container"><ul class="navbar-nav">{include file="$template/includes/navbar.tpl" navbar=$primaryNavbar}</ul><ul class="navbar-nav">{include file="$template/includes/navbar.tpl" navbar=$secondaryNavbar rightDrop=true}</ul></div></nav>
    {/if}
    {include file="$template/includes/network-issues-notifications.tpl"}

    <nav class="master-breadcrumb" aria-label="breadcrumb">
        <div class="container">
            {include file="$template/includes/breadcrumb.tpl"}
        </div>
    </nav>

    {include file="$template/includes/validateuser.tpl"}
    {include file="$template/includes/verifyemail.tpl"}

    <div id="ch-main" tabindex="-1"></div>
    <section id="main-body">
        <div class="{if !$skipMainBodyContainer && !$ch247Site.public}container{/if}">
            <div class="{if !$ch247Site.public && !$inShoppingCart && ($primarySidebar->hasChildren() || $secondarySidebar->hasChildren())}row{/if}">

            {if !$ch247Site.public && !$inShoppingCart && ($primarySidebar->hasChildren() || $secondarySidebar->hasChildren())}
                <div class="col-lg-4 col-xl-3">
                    <div class="sidebar">
                        {include file="$template/includes/sidebar.tpl" sidebar=$primarySidebar}
                    </div>
                    {if !$ch247Site.public && !$inShoppingCart && $secondarySidebar->hasChildren()}
                        <div class="d-none d-lg-block sidebar">
                            {include file="$template/includes/sidebar.tpl" sidebar=$secondarySidebar}
                        </div>
                    {/if}
                </div>
            {/if}
            <div class="{if !$ch247Site.public && !$inShoppingCart && ($primarySidebar->hasChildren() || $secondarySidebar->hasChildren())}col-lg-8 col-xl-9{/if} primary-content">
