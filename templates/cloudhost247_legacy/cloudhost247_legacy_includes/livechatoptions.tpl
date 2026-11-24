{* CloudHost247 built-in live chat — first-party visitor widget.
   No third-party chat provider (Tawk.to / LiveChat / Zendesk) is embedded. Visitors reach the
   platform's built-in chat service; staff answer from the platform's Admin → Live Chat console.
   Toggled by `enable_live_chat_cloudhost247`; the API origin is `web_chat_api_base_url` when set,
   else the platform origin ($ch247Site.platform), exactly like the marketing scripts above.
   With neither present the widget renders nothing. *}
{if $cloudhost247.settings.enable_live_chat_cloudhost247 eq 'on'}
	{assign var=webChatApi value=$cloudhost247.settings.web_chat_api_base_url|default:''}
	{if $webChatApi eq ''}{assign var=webChatApi value=$ch247Site.platform|default:''}{/if}
	{if $webChatApi ne ''}
	<link rel="stylesheet" href="{$WEB_ROOT}/templates/{$template}/css/web-chat.css?v=20261124">
	<script src="{$WEB_ROOT}/templates/{$template}/js/web-chat.js?v=20261124" data-web-chat-api="{$webChatApi|escape:'html'}" defer></script>
	{/if}
{/if}
