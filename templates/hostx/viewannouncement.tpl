<div class="announcements">
    <div class="view_ticket_box">
          <div class="top">
           <img src="{$WEB_ROOT}/templates/{$template}/images/user-icon.png"> {$displayTitle}
            <span><i class="fa fa-calendar-o"></i> {$carbon->createFromTimestamp($timestamp)->format('l, F j, Y')}</span>  
          </div> 
          <p>
            {$text}
			<p>
                {if $twittertweet}
                    <div class="pull-right wgs-twit">
                        <a href="https://twitter.com/share" class="twitter-share-button" data-count="vertical" data-via="{$twitterusername}">Tweet</a><script type="text/javascript" src="//platform.twitter.com/widgets.js"></script>
                    </div>
                {/if}
                {if $facebookrecommend}
                    <br />
                    <br />
                    {literal}
                    <div id="fb-root">
                    </div>
                    <script>(function(d, s, id) {
                        var js, fjs = d.getElementsByTagName(s)[0];
                        if (d.getElementById(id)) {return;}
                        js = d.createElement(s); js.id = id;
                        js.src = "//connect.facebook.net/en_US/all.js#xfbml=1";
                        fjs.parentNode.insertBefore(js, fjs);
                        }(document, 'script', 'facebook-jssdk'));</script>
                    {/literal}
                    <div class="fb-like" data-href="{fqdnRoutePath('announcement-view', $id, $urlfriendlytitle)}" data-send="true" data-width="450" data-show-faces="true" data-action="recommend">
                    </div>
                {/if}
                {if $facebookcomments}
                    <br />
                    <br />
                    {literal}
                    <div id="fb-root">
                    </div>
                    <script>(function(d, s, id) {
                        var js, fjs = d.getElementsByTagName(s)[0];
                        if (d.getElementById(id)) {return;}
                        js = d.createElement(s); js.id = id;
                        js.src = "//connect.facebook.net/en_US/all.js#xfbml=1";
                        fjs.parentNode.insertBefore(js, fjs);
                        }(document, 'script', 'facebook-jssdk'));</script>
                    {/literal}
                    <fb:comments href="{fqdnRoutePath('announcement-view', $id, $urlfriendlytitle)}" num_posts="5" width="500"></fb:comments>
                {/if}
			</p>
			<p>
                <a href="{routePath('announcement-index')}" class="btn btn-default">{$LANG.clientareabacklink}</a>
            </p>
    </div>  
</div>
