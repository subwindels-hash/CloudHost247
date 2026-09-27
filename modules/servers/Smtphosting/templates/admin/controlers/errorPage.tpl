{include file='assets/css_assets.tpl'}

<div id="layers">
    <div class="lu-app">
        <div class="lu-app-header lu-app-header--responsive lu-navbar">
            <a class="lu-navbar__brand lu-brand lu-brand--product" href="{$mainURL}">
                <div class="lu-brand__logo lu-product-{$tagImageModule}-for-whmcs i-c-5x">
                    <img class="lu-i-c-3x" src="{$assetsURL}/img/products/{$tagImageModule}.svg" alt="{$mainName}">
                </div>
                <div class="lu-brand__text">
                    {$mainName}
                </div>
            </a>
            <button class="lu-navbar__burger lu-navbar-right lu-btn" data-toggle="offCanvas" data-target=".app-navbar">
                <span class="lu-btn__icon lu-burger">
                    <span></span>
                    <span></span>
                    <span></span>
                </span>
            </button>
        </div>
        <div class="lu-app-navbar lu-navbar lu-navbar--responsive lu-off-canvas-responsive lu-off-canvas-responsive--right">
            <div class="lu-navbar__top">
                <a class="lu-navbar__brand lu-brand lu-brand--product" href="{$mainURL}">
                    <div class="lu-brand__logo lu-product-{$tagImageModule}-for-whmcs lu-i-c-6x">
                        <img class="lu-i-c-4x" src="{$assetsURL}/img/products/{$tagImageModule}.svg" alt="{$mainName}">
                    </div>
                    <div class="lu-brand__text">
                        {$mainName}
                    </div>
                </a>
                <a class="lu-navbar__brand lu-brand lu-is-right" href="https://www.modulesgarden.com" target="_blank">
                    <div class="lu-brand__logo">
                        <img src="{$assetsURL}/img/logo.png" alt="ModulesGarden" width="150">
                    </div>
                </a>
            </div>
            <div class="lu-navbar__nav">
                <ul class="lu-nav lu-nav--h lu-is-left">
                    {foreach from=$menu key=catName item=category}
                        {if $category.submenu}
                            <li class="lu-nav__item has-dropdown {if $currentPageName|strtolower === $catName|strtolower}is-active{/if}">
                                <a class="lu-nav__link" href="{$category.url}">
                                    {if $category.icon}
                                        <i class="{$category.icon}"></i>
                                    {/if}
                                    {if $category.label}
                                        {$subpage.label}
                                        <span class="lu-nav__link-drop-arrow"></span>
                                    {else}
                                        <span class="lu-nav__link-text">{$MGLANG->T('pagesLabels','label', $catName)}</span>
                                        <span class="lu-nav__link-drop-arrow"></span>
                                    {/if}
                                </a>
                                <ul class="lu-nav lu-nav--sub">
                                    {foreach from=$category.submenu key=subCatName item=subCategory}
                                        {if $subCategory.externalUrl}
                                            <li class="lu-nav__item">
                                                <a class="lu-nav__link" href="{$subCategory.externalUrl}" target="_blank">
                                                    {if $subCategory.icon}<i class="{$subCategory.icon}"></i>{/if}
                                                    {if $subCategory.label}
                                                        {$subCategory.label}
                                                    {else}
                                                        <span class="lu-nav__link-text">{$MGLANG->T('pagesLabels', $catName, $subCatName)}</span>
                                                    {/if}
                                                </a>
                                            </li>
                                        {else}
                                            <li class="lu-nav__item">
                                                <a class="lu-nav__link" href="{$subCategory.url}">
                                                    {if $subCategory.icon}<i class="{$subCategory.icon}"></i>{/if}
                                                    {if $subCategory.label}
                                                        {$subCategory.label}
                                                    {else}
                                                        <span class="lu-nav__link-text">{$MGLANG->T('pagesLabels', $catName, $subCatName)}</span>
                                                    {/if}
                                                </a>
                                            </li>
                                        {/if}
                                    {/foreach}
                                </ul>
                            </li>
                        {else}
                            <li class="lu-nav__item {if $currentPageName|strtolower === $catName|strtolower}is-active{/if}">
                                <a class="lu-nav__link" href="{if $category.externalUrl}{$category.externalUrl}{else}{$category.url}{/if}"
                                        {if $category.externalUrl} target="_blank"{/if}>
                                    {if $category.icon}
                                        <i class="{$category.icon}"></i>
                                    {/if}
                                    {if $category.label}
                                        {$subpage.label}
                                    {else}
                                        <span class="lu-nav__link-text">{$MGLANG->T('pagesLabels','label', $catName)}</span>
                                    {/if}
                                    <span class="drop-arrow"></span>
                                </a>
                            </li>
                        {/if}
                    {/foreach}
                </ul>
            </div>
        </div>
        <div class="lu-app-main">
            <div class="lu-app-main__body">
                <div class="lu-container-fluid">
                    <div class="lu-block">
                        <div class="lu-block__body">
                            <div class="lu-widget">
                                <div class="lu-widget__header lu-docs-color lu-bg-danger-lighter">
                                    {$MGLANG->absoluteT('addonAA', 'errorPage', 'error')}
                                </div>
                                <div class="lu-widget__body lu-docs-color lu-bg-danger-faded" style="min-height: 350px">
                                    <div class="lu-row">
                                        <div class="lu-col-md-12">
                                            <div class="lu-msg__title lu-type-4 lu-docs-color-name" style="margin-bottom: 35px; margin-top: 25px; text-align: center;">
                                                {$MGLANG->absoluteT('addonAA', 'errorPage', 'title')}
                                            </div>
                                        </div>
                                        <div class="lu-col-md-12">
                                            <div class="lu-msg">
                                                <div class="lu-msg__body">
                                                    <p class="lu-msg__description lu-docs-color-value" style="font-size: 16px; margin-bottom: 15px;">
                                                        {$MGLANG->absoluteT('addonAA', 'errorPage', 'description')}
                                                    </p>
                                                    {foreach from=$errorPageDetails key=dKey item=dValue}
                                                        <p class="lu-msg__description lu-docs-color-value" style="font-size: 14px; margin-top: 5px; margin-bottom: 5px;">
                                                            {$MGLANG->absoluteT('addonAA', 'errorPage', $dKey)}: {$dValue}
                                                        </p>
                                                    {/foreach}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="lu-col-md-12" style="margin-top: 35px; margin-bottom: 15px; text-align: center;">
                                            <div class="lu-msg__actions">
                                                <a class="lu-btn lu-btn--lg lu-btn--default" href="javascript:;" onclick="window.history.back();" style="background-color: #f66e6e !important; color: #fff">
                                                    <span class="lu-btn__text">{$MGLANG->absoluteT('addonAA', 'errorPage', 'button')}</span>
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

{include file='assets/js_assets.tpl'}

<div class="clear"></div>
