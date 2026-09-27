{if $hostx_theme_settings.enable_live_chat_hostx eq 'on'}
	{if $hostx_theme_settings.chat_option_selected eq 'livechat'}
		{literal}
		<!-- Start of LiveChat (www.livechatinc.com) code -->
		<script>
			window.__lc = window.__lc || {};
			window.__lc.license = '{/literal}{$hostx_theme_settings.live_chat_id}{literal}';
			;(function(n,t,c){function i(n){return e._h?e._h.apply(null,n):e._q.push(n)}var e={_q:[],_h:null,_v:"2.0",on:function(){i(["on",c.call(arguments)])},once:function(){i(["once",c.call(arguments)])},off:function(){i(["off",c.call(arguments)])},get:function(){if(!e._h)throw new Error("[LiveChatWidget] You can't use getters before load.");return i(["get",c.call(arguments)])},call:function(){i(["call",c.call(arguments)])},init:function(){var n=t.createElement("script");n.async=!0,n.type="text/javascript",n.src="https://cdn.livechatinc.com/tracking.js",t.head.appendChild(n)}};!n.__lc.asyncInit&&e.init(),n.LiveChatWidget=n.LiveChatWidget||e}(window,document,[].slice))
		</script>
		<noscript><a href="https://www.livechatinc.com/chat-with/{/literal}{$hostx_theme_settings.live_chat_id}{literal}/" rel="nofollow">Chat with us</a>, powered by <a href="https://www.livechatinc.com/?welcome" rel="noopener nofollow" target="_blank">LiveChat</a></noscript>
		<!-- End of LiveChat code -->
		{/literal}
	{else if $hostx_theme_settings.chat_option_selected eq 'tawk'}
		{literal}
		<!--Start of Tawk.to Script-->
		<script>
			var Tawk_API = Tawk_API || {}, Tawk_LoadStart = new Date();
			(function () {
			var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
			s1.async = true;
			s1.src = 'https://embed.tawk.to/{/literal}{$hostx_theme_settings.live_chat_id}{literal}/default';
			s1.charset = 'UTF-8';
			s1.setAttribute('crossorigin', '*');
			s0.parentNode.insertBefore(s1, s0);
			})();
		</script>
		<!--End of Tawk.to Script-->
		{/literal}
	{else if $hostx_theme_settings.chat_option_selected eq 'zopim'}
		{literal}
		<!-- Start of  Zendesk Widget script -->
		<script id="ze-snippet" src="https://static.zdassets.com/ekr/snippet.js?key={/literal}{$hostx_theme_settings.live_chat_id}{literal}"></script>
		<!-- End of  Zendesk Widget script -->
		{/literal}
	{else if $hostx_theme_settings.chat_option_selected eq 'custom'}
		{literal}
	<!-- Other Chat Widget can be inserted here -->

	<!-- Other Chat Widget can be inserted here -->
		{/literal}
	{/if}
{/if}