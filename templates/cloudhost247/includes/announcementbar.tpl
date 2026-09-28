{***********************************************************************
 *  CloudHost247 — Reusable Announcement Bar
 *  Path: /templates/cloudhost247/includes/announcementbar.tpl
 *  (theme.yaml name: "CloudHost247")
 *
 *  Pure Smarty + HTML + CSS. No <marquee>, no JS, no slider libraries.
 *  Seamless infinite horizontal scroll via CSS @keyframes only.
 *
 *  USAGE (from header.tpl, ABOVE the navbar):
 *      {include file="$template/includes/announcementbar-config.tpl"}
 *      {include file="$template/includes/announcementbar.tpl"}
 *
 *  Or pass data inline:
 *      {include file="$template/includes/announcementbar.tpl" announcements=[
 *          ['text' => 'Free SSL on every plan', 'url' => '/ssl-certificate.php'],
 *          ['text' => '24/7 expert support']
 *      ]}
 *
 *  Supported keys per message:
 *      text      (required) plain text of the message
 *      url       (optional) makes the message clickable
 *      icon      (optional) Font Awesome class, e.g. 'fas fa-bolt'
 *      external  (optional) true => target="_blank" rel="noopener noreferrer"
 *      badge     (optional) short label pill, e.g. 'NEW'
 *
 *  Optional tuning variables:
 *      $announcementBarSpeed   scroll duration, default 38s
 *      $announcementBarLabel   aria-label, default "Site announcements"
 ***********************************************************************}

{if !isset($announcements) || !is_array($announcements)}
    {assign var="announcements" value=[]}
{/if}

{if $announcements|@count > 0}

    {assign var="abDuration" value=($announcementBarSpeed|default:'38s')}
    {assign var="abLabel" value=($announcementBarLabel|default:'Site announcements')}

    {* ───────────────────────── Styles ─────────────────────────
       Kept inline so the include is drop-in and self-contained.
       Prefer the external sheet? Delete this <style> block and add
       <link rel="stylesheet" href="{$WEB_ROOT}/templates/{$template}/css/announcementbar.css">
       to includes/head.tpl instead. *}
    <style>
        .ch247-announcebar {
            --ab-duration: 38s;
            --ab-gap: 3rem;
            --ab-bg-start: #071b3d;
            --ab-bg-mid: #0756d8;
            --ab-accent: #12b886;
            position: relative;
            z-index: 1040; /* above the Bootstrap navbar (1030) */
            display: block;
            width: 100%;
            max-width: 100%;
            overflow: hidden;
            background: linear-gradient(90deg, var(--ab-bg-start) 0%, var(--ab-bg-mid) 50%, var(--ab-bg-start) 100%);
            color: #fff;
            font-family: var(--ch247-font, Inter, system-ui, sans-serif);
            font-size: .875rem;
            font-weight: 500;
            line-height: 1.45;
            border-bottom: 1px solid rgba(255, 255, 255, .12);
            -webkit-font-smoothing: antialiased;
        }

        /* Soft fade on both edges so messages enter/leave gracefully */
        .ch247-announcebar::before,
        .ch247-announcebar::after {
            content: "";
            position: absolute;
            top: 0;
            bottom: 0;
            width: 3rem;
            pointer-events: none;
            z-index: 2;
        }
        .ch247-announcebar::before {
            left: 0;
            background: linear-gradient(90deg, var(--ab-bg-start), rgba(7, 27, 61, 0));
        }
        .ch247-announcebar::after {
            right: 0;
            background: linear-gradient(270deg, var(--ab-bg-start), rgba(7, 27, 61, 0));
        }

        /* Viewport clips the track; the track holds two identical groups */
        .ch247-announcebar__viewport {
            overflow: hidden;
        }

        .ch247-announcebar__track {
            display: flex;
            flex-wrap: nowrap;
            width: max-content;
            min-width: 200%;
            animation: ch247-announce-scroll var(--ab-duration) linear infinite;
            will-change: transform;
        }

        /* Each group is at least the full viewport width, so translating the
           track by exactly -50% (one group) always loops seamlessly — no gap,
           no jump, even when there are only one or two short messages. */
        .ch247-announcebar__group {
            display: flex;
            flex: 0 0 auto;
            align-items: center;
            justify-content: space-around;
            min-width: 100%;
            padding: 0;
            margin: 0;
            list-style: none;
        }

        .ch247-announcebar__item {
            display: inline-flex;
            align-items: center;
            flex: 0 0 auto;
            gap: .5rem;
            padding: .6rem var(--ab-gap) .6rem 0;
            white-space: nowrap;
            max-width: none;
        }

        .ch247-announcebar__link {
            display: inline-flex;
            align-items: center;
            gap: .5rem;
            color: #fff;
            text-decoration: none;
            border-bottom: 1px solid rgba(255, 255, 255, .35);
            padding-bottom: 1px;
            transition: color .2s ease, border-color .2s ease, opacity .2s ease;
        }
        .ch247-announcebar__link:hover,
        .ch247-announcebar__link:focus {
            color: #fff;
            opacity: .92;
            border-color: var(--ab-accent);
            text-decoration: none;
        }
        .ch247-announcebar__link:focus-visible {
            outline: 2px solid var(--ab-accent);
            outline-offset: 3px;
            border-radius: 2px;
        }

        .ch247-announcebar__icon {
            font-size: .8em;
            opacity: .9;
        }

        .ch247-announcebar__badge {
            display: inline-block;
            background: var(--ab-accent);
            color: #04231a;
            font-size: .6875rem;
            font-weight: 700;
            letter-spacing: .06em;
            text-transform: uppercase;
            padding: .15rem .45rem;
            border-radius: .35rem;
            line-height: 1.3;
        }

        .ch247-announcebar__sep {
            flex: 0 0 auto;
            width: 5px;
            height: 5px;
            margin-right: var(--ab-gap);
            border-radius: 50%;
            background: rgba(255, 255, 255, .55);
        }

        /* Pause on hover (and on keyboard focus for accessibility) */
        .ch247-announcebar:hover .ch247-announcebar__track,
        .ch247-announcebar:focus-within .ch247-announcebar__track {
            animation-play-state: paused;
        }

        /* Seamless loop: content is duplicated exactly once → shift by 50% */
        @keyframes ch247-announce-scroll {
            from { transform: translate3d(0, 0, 0); }
            to   { transform: translate3d(-50%, 0, 0); }
        }

        /* ── Responsive ── */
        @media (max-width: 991.98px) {
            .ch247-announcebar { --ab-gap: 2.25rem; font-size: .8125rem; }
        }
        @media (max-width: 767.98px) {
            .ch247-announcebar { --ab-gap: 1.75rem; font-size: .8125rem; }
            .ch247-announcebar::before,
            .ch247-announcebar::after { width: 1.5rem; }
        }
        @media (max-width: 575.98px) {
            .ch247-announcebar { --ab-gap: 1.25rem; font-size: .75rem; }
            .ch247-announcebar__item { padding-top: .5rem; padding-bottom: .5rem; }
            .ch247-announcebar__badge { font-size: .625rem; }
        }

        /* ── Reduced motion: stop scrolling, stack messages safely ── */
        @media (prefers-reduced-motion: reduce) {
            .ch247-announcebar__track {
                animation: none;
                width: 100%;
                min-width: 0;
            }
            .ch247-announcebar__group--clone { display: none; }
            .ch247-announcebar__group {
                flex-wrap: wrap;
                justify-content: center;
                gap: .25rem 1rem;
                padding: .35rem .75rem;
            }
            .ch247-announcebar__item {
                white-space: normal;
                padding: .25rem 0;
                text-align: center;
                overflow-wrap: anywhere;
            }
            .ch247-announcebar__sep { display: none; }
            .ch247-announcebar::before,
            .ch247-announcebar::after { display: none; }
        }

        @media print {
            .ch247-announcebar { display: none; }
        }
    </style>

    <div class="ch247-announcebar"
         role="region"
         aria-label="{$abLabel|escape:'html'}"
         style="--ab-duration:{$abDuration|escape:'html'}">
        <div class="ch247-announcebar__viewport">
            <div class="ch247-announcebar__track">
                {* Group rendered twice: the second copy is the seamless-loop clone *}
                {section name=abLoop loop=2}
                    <ul class="ch247-announcebar__group{if $smarty.section.abLoop.index eq 1} ch247-announcebar__group--clone{/if}"
                        {if $smarty.section.abLoop.index eq 1}aria-hidden="true"{/if}>
                        {foreach from=$announcements item=ann name=abItems}
                            {if isset($ann.text) && $ann.text|trim neq ''}
                                <li class="ch247-announcebar__item">
                                    {if isset($ann.url) && $ann.url|trim neq ''}
                                        <a class="ch247-announcebar__link"
                                           href="{$ann.url|escape:'html'}"
                                           {if isset($ann.external) && $ann.external}target="_blank" rel="noopener noreferrer"{/if}
                                           {if $smarty.section.abLoop.index eq 1}tabindex="-1"{/if}>
                                            {if isset($ann.badge) && $ann.badge|trim neq ''}
                                                <span class="ch247-announcebar__badge">{$ann.badge|escape:'html'}</span>
                                            {/if}
                                            {if isset($ann.icon) && $ann.icon|trim neq ''}
                                                <i class="{$ann.icon|escape:'html'} ch247-announcebar__icon" aria-hidden="true"></i>
                                            {/if}
                                            <span>{$ann.text|escape:'html'}</span>
                                        </a>
                                    {else}
                                        {if isset($ann.badge) && $ann.badge|trim neq ''}
                                            <span class="ch247-announcebar__badge">{$ann.badge|escape:'html'}</span>
                                        {/if}
                                        {if isset($ann.icon) && $ann.icon|trim neq ''}
                                            <i class="{$ann.icon|escape:'html'} ch247-announcebar__icon" aria-hidden="true"></i>
                                        {/if}
                                        <span>{$ann.text|escape:'html'}</span>
                                    {/if}
                                    <span class="ch247-announcebar__sep" aria-hidden="true"></span>
                                </li>
                            {/if}
                        {/foreach}
                    </ul>
                {/section}
            </div>
        </div>
    </div>

{/if}
