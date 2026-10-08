{*
    Website Builder page.

    The builder renders its own markup server-side and it is already escaped at
    the point of generation: rich text passed HtmlSanitizer, every other value
    passed htmlspecialchars, and URLs passed UrlPolicy. That is why the three
    builder blocks below use `nofilter` while every value that comes from
    anywhere else on this page is escaped here.

    The surrounding chrome uses the shared design system (`ch-note`, `ch-wrap`,
    `ch-btn`). It previously used `ch247-*` names that were defined only in
    `css/custom.css`, a stylesheet this theme does not load — so the preview
    banner, the form result and the sign-in button all rendered unstyled, and a
    draft preview looked like a finished page.
*}
{if $ch247Builder.found}
    {if $ch247Builder.preview}
        <div class="ch-note ch-note--warn" role="status">
            Draft preview. This version is not published and is not indexed by search engines.
        </div>
    {/if}

    {* `ch247-root` is the scope hook for the Builder's own runtime.css: its typography, box-sizing
       and widget spacing are all written as `.ch247-root …`, so the wrapper must keep the class. *}
    <div class="ch247-root">
        {if $ch247Builder.form_result}
            <div class="ch-note{if !$ch247Builder.form_result.ok} ch-note--warn{/if}" role="status">
                {$ch247Builder.form_result.message|escape}
            </div>
        {/if}

        {if $ch247Builder.header_html}
            <header>{$ch247Builder.header_html nofilter}</header>
        {/if}

        <main id="main-content">{$ch247Builder.html nofilter}</main>

        {if $ch247Builder.footer_html}
            <footer>{$ch247Builder.footer_html nofilter}</footer>
        {/if}
    </div>
{else}
    <main id="main-content" class="ch-section"><div class="ch-wrap ch-wrap--prose">
        <h1>{$ch247Builder.title|escape}</h1>
        <p class="ch-muted">{$ch247Builder.reason|escape}</p>
        {if $ch247Builder.login_url}
            <p><a class="ch-btn ch-btn--mint" href="{$ch247Builder.login_url|escape}">Sign in to continue</a></p>
        {else}
            <p><a class="ch-btn ch-btn--outline" href="index.php">Back to the homepage</a></p>
        {/if}
    </div></main>
{/if}
