<div class="knowledgebaseDiv">
    <form role="form" method="post" action="{routePath('knowledgebase-search')}">
        <div class="block d-flex top_searchbar">            
            <label class="input-group input-group-lg kb-search">
                <input type="text" id="inputKnowledgebaseSearch" name="search" class="form-control mb-2 mr-sm-2 mb-sm-0" placeholder="{$LANG.clientHomeSearchKb}" />
                <!-- Search Button -->
                <input type="submit" id="btnKnowledgebaseSearch" class="btn btn-primary btn-input-padded-responsive" value="{$LANG.search}" />
            </label>    
        </div>            
    </form>



    <h2>{$LANG.knowledgebasecategories}</h2>

    {if $kbcats}
        <div class="kbcategories">
            {foreach from=$kbcats name=kbcats item=kbcat}
                <div class="col-sm-4 kbcat">
                    <a href="{routePath('knowledgebase-category-view', {$kbcat.id}, {$kbcat.urlfriendlyname})}">
                        <i class="far fa-folder-open"></i>
                        {$kbcat.name} ({$kbcat.numarticles})
                    </a>                    
                    <p>{$kbcat.description}</p>
                </div>
            {/foreach}
        </div>
    {else}
        {include file="$template/includes/alert.tpl" type="info" msg=$LANG.knowledgebasenoarticles textcenter=true}
    {/if}

    {if $kbmostviews}
        <h2>{$LANG.knowledgebasepopular}</h2>
        <div class="kbarticles">
            {foreach from=$kbmostviews item=kbarticle}            
                <div class="inner_bx_area">
                    <a href="{routePath('knowledgebase-article-view', {$kbarticle.id}, {$kbarticle.urlfriendlytitle})}">    
                        <i class="far fa-file-alt"></i>
                        <h4>{$kbarticle.title}</h4>
                        <p>{$kbarticle.article|truncate:200:"..."}</p>
                    </a>                
                </div>            
            {/foreach}
        </div>
    {/if}
</div>        
