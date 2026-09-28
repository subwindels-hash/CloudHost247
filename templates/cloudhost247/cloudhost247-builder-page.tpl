{*
    Website Builder page.

    The builder renders its own markup server-side and it is already escaped at
    the point of generation: rich text passed HtmlSanitizer, every other value
    passed htmlspecialchars, and URLs passed UrlPolicy. That is why the three
    builder blocks below use `nofilter` while every value that comes from
    anywhere else on this page is escaped here.
*}
{if $ch247Builder.found}
    {if $ch247Builder.preview}
        <div class="ch247-preview-banner" role="status">
            Draft preview. This version is not published and is not indexed by search engines.
        </div>
    {/if}

    <div class="ch247-root">
        {if $ch247Builder.form_result}
            <div class="ch247-form-result {if $ch247Builder.form_result.ok}ch247-form-result--ok{else}ch247-form-result--error{/if}" role="status">
                {$ch247Builder.form_result.message|escape}
            </div>
        {/if}

        {if $ch247Builder.header_html}
            <header class="ch247-part ch247-part--header">{$ch247Builder.header_html nofilter}</header>
        {/if}

        <main id="main-content" class="ch247-page">{$ch247Builder.html nofilter}</main>

        {if $ch247Builder.footer_html}
            <footer class="ch247-part ch247-part--footer">{$ch247Builder.footer_html nofilter}</footer>
        {/if}
    </div>
{else}
    <div class="ch247-root">
        <main id="main-content" class="ch247-page ch247-page--missing">
            <h1>{$ch247Builder.title|escape}</h1>
            <p>{$ch247Builder.reason|escape}</p>
            {if $ch247Builder.login_url}
                <p><a class="ch247-btn ch247-btn--primary ch247-btn--md" href="{$ch247Builder.login_url|escape}">Sign in to continue</a></p>
            {else}
                <p><a class="ch247-btn ch247-btn--outline ch247-btn--md" href="index.php">Back to the homepage</a></p>
            {/if}
        </main>
    </div>
{/if}
