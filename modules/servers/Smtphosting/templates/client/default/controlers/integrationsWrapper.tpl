{include file='css_assets.tpl'}

{if $isCustomIntegrationCss}
    <link rel="stylesheet" href="{$customAssetsURL}/css/integration.css">
{/if}

{foreach from=$integrations key=varible item=value}
    <div class="mg-integration-container" mg-integration-target="{$value.integrationDetails->getJqSelector()}" mg-integration-type="{$value.integrationDetails->getIntegrationType()}"
         mg-integration-function="{$value.integrationDetails->getJsFunctionName()}">
        {$value.htmlData}
    </div>
{/foreach}

{include file='js_assets.tpl'}
