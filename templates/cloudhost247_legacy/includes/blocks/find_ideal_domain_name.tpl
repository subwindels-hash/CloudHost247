<div class="domain">
    <div class="container">
      <div class="top">
        <h5>{eval var=$LANG.domainregister}</h5>
        <h2>{$LANG.domainfindideal}</h2> 
        <p>{$LANG.domainsecureyourdmn}</p> 
      </div>
      <div class="search_box">
        <form action="cart.php" method="get">  
          <input type="hidden" name="a" value="add">
          <input type="hidden" name="domain" value="register">
          <img src="{$WEB_ROOT}/templates/{$template}/images/search-icon.svg" alt="search icon"> 
          <input class="search_input" type="text" placeholder="Search a Domain" name="sld">  
          <input type="submit" class="submit" value="{$LANG.domainsearch}" name="submit">
        </form>  
      </div>
      <ul class="domain-options">
          {foreach from=$tld_data['show_on_domain'] key=k  item=tld_d}
          <li>.{$tld_d->tld_id}  <span>{$LANG.homeonly}  {$tld_d->register}
          /{$LANG.domainyr}</span></li>
          {/foreach}
      </ul>
      <div class="domain-companys">

        {assign var="currency_formate" value="</b><small>`$tld_data.currency_formate`"} 

        {foreach from=$tld_data['show_on_domain_companys'] key=k  item=tld_d}
          <div class="domain-companys-col"> 
          <img src="{$WEB_ROOT}/templates/{$template}/domain_icons/{$tld_d->tld_id|replace:'.':'_'}.png" alt="{$tld_d->tld_id|replace:'.':'_'}">
          <h3>{$LANG.homeonly}
            {if $tld_data.currency_formate eq 'empty'}
            <b>{$tld_d->register}</b>/{$LANG.domainyr}
            {else}
             <b>{$tld_d->register|replace:$tld_data['currency_formate']:$currency_formate}</small>/{$LANG.domainyr}
            {/if}
          </h3> 
        </div>
        {/foreach}

      </div>

    </div>
</div>