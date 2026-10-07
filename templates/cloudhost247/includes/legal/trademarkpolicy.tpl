{*
* WHMCS CloudHost247 Theme - Trademark & Copyright Infringement Policy Template
*
* @package    CloudHost247
* @author     CloudHost247
* @copyright  Copyright (c) CloudHost247 Isc., All Rights Reserved
* @link       https://www.cloudhost247.com
*}
<p class="ch-lede">{$trademarkData.hero.subtitle}</p>
<section>
  {if $trademarkData.introduction.content}
  <p>{$trademarkData.introduction.content}</p>
  {/if}
  {foreach from=$trademarkData.sections item=section}
  <section id="{$section.id}">
    <h2>{$section.title}</h2>
    {if $section.content}
    <p>{$section.content}</p>
    {/if}
    {if $section.items}
    <ul>
      {foreach from=$section.items item=item}
      <li>{$item}</li>
      {/foreach}
    </ul>
    {/if}
  </section>
  {/foreach}
  {if $trademarkData.contact}
  <section id="contact">
    <h2>{$trademarkData.contact.title}</h2>
    <p>{$trademarkData.contact.content}</p>
    <ul>
      <li>
        <strong>Email:</strong>
        <a href="mailto:{$trademarkData.contact.email}">{$trademarkData.contact.email}</a>
      </li>
      <li>
        <strong>Website:</strong>
        <a href="{$WEB_ROOT}/index.php" target="_blank" rel="noopener">{$trademarkData.contact.website}</a>
      </li>
      <li>
        <strong>Support:</strong> Open a ticket through our client <a href="{$WEB_ROOT}/submitticket.php">{$trademarkData.contact.portal}</a>.
      </li>
    </ul>
  </section>
  {/if}
</section>
