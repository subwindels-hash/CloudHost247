<div class="knowledgebaseDiv">    
    <form role="form" method="post" action="{routePath('knowledgebase-search')}">
        <div class="input-group input-group-lg kb-search top_searchbar">
            <label class="input-group input-group-lg kb-search">
                <input type="text"  id="inputKnowledgebaseSearch" name="search" class="form-control mb-2 mr-sm-2 mb-sm-0" placeholder="{$LANG.clientHomeSearchKb}" value="{$searchterm}" />
                <!-- Search Button -->
                <input type="submit" id="btnKnowledgebaseSearch" class="btn btn-primary btn-input-padded-responsive" value="{$LANG.search}" />
            </label>
        </div>
    </form>

    {if $kbcats}
        <h2>{$LANG.knowledgebasecategories}</h2>

        <div class="kbcategories">
            {foreach name=kbasecats from=$kbcats item=kbcat}
                <div class="col-sm-4 kbcat">
                    <a href="{routePath('knowledgebase-category-view',{$kbcat.id},{$kbcat.urlfriendlyname})}">
                        <i class="glyphicon glyphicon-folder-close"></i>
                        {$kbcat.name} ({$kbcat.numarticles})
                    </a>                    
                    <p>{$kbcat.description}</p>
                </div>
            {/foreach}
        </div>
    {/if}

    {if $kbarticles || !$kbcats}
        {if $tag}
            <h2>{$LANG.kbviewingarticlestagged} '{$tag}'</h2>
        {else}
            <h2>{$LANG.knowledgebasearticles}</h2>
        {/if}

        <div class="kbarticles">

            {foreach from=$kbarticles item=kbarticle}            
                <div class="inner_bx_area">
                    <a href="{routePath('knowledgebase-article-view', {$kbarticle.id}, {$kbarticle.urlfriendlytitle})}">
                        <i class="far fa-file-alt"></i>
                        <h4>{$kbarticle.title}</h4>
                        <p>{$kbarticle.article|truncate:100:"..."}</p>
                    </a>                
                </div>
            {foreachelse}
                {include file="$template/includes/alert.tpl" type="info" msg=$LANG.knowledgebasenoarticles textcenter=true}
            {/foreach}
        </div>
    {/if}
</div>