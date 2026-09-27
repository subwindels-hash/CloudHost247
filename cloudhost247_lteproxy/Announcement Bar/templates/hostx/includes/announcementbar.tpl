{* Announcement Bar Template for HostX Theme *}
{* Usage: Assign announcements array before including this template *}
{* Example: $announcements = [['text'=>'Message 1','url'=>'/promo'], ['text'=>'Message 2']] *}

{if isset($announcements) && is_array($announcements) && count($announcements) > 0}
<style>
/* ─── Announcement Bar ─── */
.announcement-bar {
    position: relative;
    width: 100%;
    background: linear-gradient(90deg, #1e3a8a 0%, #3b82f6 50%, #1e3a8a 100%);
    color: #ffffff;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.5;
    overflow: hidden;
    z-index: 1040;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

/* Dark mode support for HostX */
@media (prefers-color-scheme: dark) {
    .announcement-bar {
        background: linear-gradient(90deg, #0f172a 0%, #1e40af 50%, #0f172a 100%);
    }
}

.announcement-bar__track {
    display: flex;
    align-items: center;
    width: fit-content;
    min-width: 100%;
    /* Duration: 30s for moderate speed; adjust per message count if desired */
    animation: announcement-scroll 30s linear infinite;
    will-change: transform;
}

/* Pause on hover */
.announcement-bar:hover .announcement-bar__track {
    animation-play-state: paused;
}

.announcement-bar__item {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 0.625rem 2.5rem;
    white-space: nowrap;
    cursor: default;
}

.announcement-bar__item a,
.announcement-bar__item--link {
    color: #ffffff;
    text-decoration: none;
    cursor: pointer;
    transition: opacity 0.2s ease;
}

.announcement-bar__item a:hover,
.announcement-bar__item--link:hover {
    opacity: 0.85;
    text-decoration: underline;
    text-underline-offset: 2px;
}

/* Decorative bullet between messages */
.announcement-bar__item::after {
    content: "•";
    position: absolute;
    right: 0;
    padding-left: 0;
    opacity: 0.6;
    font-size: 0.75rem;
}

/* Remove bullet from the very last visual item (handled by spacing) */

/* Separator dot styling */
.announcement-bar__dot {
    display: inline-block;
    width: 4px;
    height: 4px;
    background: rgba(255, 255, 255, 0.7);
    border-radius: 50%;
    margin: 0 2.5rem;
    flex-shrink: 0;
}

/* Keyframes: translate from 0 to -50% because content is duplicated */
@keyframes announcement-scroll {
    0% {
        transform: translateX(0);
    }
    100% {
        transform: translateX(-50%);
    }
}

/* ─── Responsive Adjustments ─── */
@media (max-width: 767.98px) {
    .announcement-bar {
        font-size: 0.8125rem;
    }
    .announcement-bar__item {
        padding: 0.5rem 1.5rem;
    }
    .announcement-bar__dot {
        margin: 0 1.5rem;
    }
}

@media (max-width: 575.98px) {
    .announcement-bar {
        font-size: 0.75rem;
    }
    .announcement-bar__item {
        padding: 0.5rem 1rem;
    }
    .announcement-bar__dot {
        margin: 0 1rem;
    }
}

/* Reduce motion preference for accessibility */
@media (prefers-reduced-motion: reduce) {
    .announcement-bar__track {
        animation: none;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 0;
    }
    .announcement-bar__item {
        white-space: normal;
        text-align: center;
        padding: 0.25rem 0.75rem;
    }
    .announcement-bar__dot {
        display: none;
    }
    .announcement-bar__item::after {
        display: none;
    }
}
</style>

<div class="announcement-bar" role="region" aria-label="Announcements">
    <div class="announcement-bar__track">
        {* Render items twice for seamless CSS loop *}
        {section name=loop loop=2}
            {foreach from=$announcements item=announcement}
                {if isset($announcement.url) && $announcement.url neq ''}
                    <a href="{$announcement.url|escape:'html'}" class="announcement-bar__item announcement-bar__item--link" {if isset($announcement.external) && $announcement.external}target="_blank" rel="noopener noreferrer"{/if}>
                        <span>{$announcement.text|escape:'html'}</span>
                        {if isset($announcement.icon) && $announcement.icon neq ''}
                            <i class="{$announcement.icon|escape:'html'} ml-1" aria-hidden="true"></i>
                        {/if}
                    </a>
                {else}
                    <span class="announcement-bar__item">
                        {$announcement.text|escape:'html'}
                        {if isset($announcement.icon) && $announcement.icon neq ''}
                            <i class="{$announcement.icon|escape:'html'} ml-1" aria-hidden="true"></i>
                        {/if}
                    </span>
                {/if}
                <span class="announcement-bar__dot" aria-hidden="true"></span>
            {/foreach}
        {/section}
    </div>
</div>
{/if}
