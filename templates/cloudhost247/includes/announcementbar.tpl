{* CloudHost247 reusable announcement bar.
   Expected data: $announcements = [['text' => '...', 'url' => '...'], ...]
   The two identical groups make translateX(-50%) an exact, seamless loop. *}
{if !empty($announcements) && is_array($announcements)}
<style>
    .ch247-announcement {
        --ch247-announcement-speed: 32s;
        position: relative;
        z-index: 1040;
        width: 100%;
        max-width: 100vw;
        overflow: hidden;
        color: #fff;
        background: linear-gradient(90deg, #102a56 0%, #1659a5 50%, #102a56 100%);
        border-bottom: 1px solid rgba(255,255,255,.16);
        font-size: 14px;
        font-weight: 500;
        line-height: 1.4;
    }

    .ch247-announcement__track {
        display: flex;
        align-items: stretch;
        width: max-content;
        animation: ch247-announcement-scroll var(--ch247-announcement-speed) linear infinite;
        will-change: transform;
    }

    .ch247-announcement:hover .ch247-announcement__track,
    .ch247-announcement:focus-within .ch247-announcement__track {
        animation-play-state: paused;
    }

    .ch247-announcement__group {
        display: flex;
        align-items: center;
        justify-content: space-around;
        flex: 0 0 auto;
        min-width: 100vw;
    }

    .ch247-announcement__item {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        min-width: 0;
        max-width: min(80vw, 760px);
        padding: 9px clamp(20px, 3vw, 48px);
        color: inherit;
        text-decoration: none;
        white-space: nowrap;
    }

    .ch247-announcement__text {
        display: block;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    a.ch247-announcement__item {
        cursor: pointer;
        transition: color .2s ease, opacity .2s ease;
    }

    a.ch247-announcement__item:hover,
    a.ch247-announcement__item:focus {
        color: #fff;
        opacity: .84;
        text-decoration: underline;
        text-underline-offset: 3px;
        outline: none;
    }

    .ch247-announcement__separator {
        width: 4px;
        height: 4px;
        flex: 0 0 4px;
        margin: 0 2px;
        border-radius: 50%;
        background: rgba(255,255,255,.65);
    }

    @keyframes ch247-announcement-scroll {
        from { transform: translate3d(0, 0, 0); }
        to   { transform: translate3d(-50%, 0, 0); }
    }

    @media (max-width: 767.98px) {
        .ch247-announcement {
            --ch247-announcement-speed: 26s;
            font-size: 13px;
        }
        .ch247-announcement__item {
            max-width: 82vw;
            padding: 8px 20px;
        }
    }

    @media (max-width: 479.98px) {
        .ch247-announcement { font-size: 12px; }
        .ch247-announcement__item {
            max-width: 86vw;
            padding-inline: 14px;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .ch247-announcement__track {
            width: 100%;
            animation: none;
        }
        .ch247-announcement__group {
            width: 100%;
            min-width: 100%;
            overflow-x: auto;
            justify-content: flex-start;
            scrollbar-width: thin;
        }
        .ch247-announcement__group--clone { display: none; }
    }
</style>

<div class="ch247-announcement" role="region" aria-label="Website announcements">
    <div class="ch247-announcement__track">
        {section name=announcementCopies loop=2}
            <div class="ch247-announcement__group{if $smarty.section.announcementCopies.index == 1} ch247-announcement__group--clone{/if}"
                 {if $smarty.section.announcementCopies.index == 1}aria-hidden="true"{/if}>
                {foreach from=$announcements item=announcement name=announcementItems}
                    {if !empty($announcement.text)}
                        {if !empty($announcement.url)}
                            <a class="ch247-announcement__item"
                               href="{$announcement.url|escape:'html'}"
                               {if !empty($announcement.external)}target="_blank" rel="noopener noreferrer"{/if}
                               {if $smarty.section.announcementCopies.index == 1}tabindex="-1"{/if}>
                                <span class="ch247-announcement__text">{$announcement.text|escape:'html'}</span>
                            </a>
                        {else}
                            <span class="ch247-announcement__item">
                                <span class="ch247-announcement__text">{$announcement.text|escape:'html'}</span>
                            </span>
                        {/if}
                        <span class="ch247-announcement__separator" aria-hidden="true"></span>
                    {/if}
                {/foreach}
            </div>
        {/section}
    </div>
</div>
{/if}
