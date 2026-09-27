<div class="domain-block-home">
    <div class="container">
      <div class="row">
        <div class="col-md-7">
         <div class="domain-block-content">
           <h2>{$LANG.domainBlockFindDomain}</h2>
           <form action="domainchecker.php" method="post">
        	<input type="hidden" name="register">
             <div class="domain-search-frm">
               <div class="domain-block-search">
                <div class="domain-block-inner"><input type="text" class="domain-b-search" name="domain" placeholder="{$LANG.domainBlockPlaceHolder}">
                </div>
                <input type="submit" class="btn" value="{$LANG.domainsearch}">   
              </div>
             </div>
             </form>
         </div>
        </div>
        <div class="col-md-5">
          <div class="domain-block-tld">
            <ul class="domain-block-tld-price">
                {foreach from=$tld_data['show_on_home']  item=sale_item}
                  <li class="block-{$sale_item->tld_id}"><strong><span>.</span>{$sale_item->tld_id}</strong><p>{$sale_item->register}</p></li>
                {/foreach}
            </ul>
          </div>
        </div>
      </div>
    </div>
 </div>