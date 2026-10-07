{*
* WHMCS CloudHost247 Theme - Refund Policy Template
*
* @package    CloudHost247
* @author     CloudHost247
* @copyright  Copyright (c) CloudHost247 Isc., All Rights Reserved
* @link       https://www.cloudhost247.com
*}
<p class="ch-lede">{$refundData.hero.subtitle}</p>
<section>
  {if $refundData.introduction.content}
  <p>{$refundData.introduction.content}</p>
  {/if}
  {foreach from=$refundData.sections item=section}
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
  {if $refundData.contact}
  <section id="contact">
    <h2>{$refundData.contact.title}</h2>
    <p>{$refundData.contact.content}</p>
    <ul>
      <li>
        <strong>Email:</strong>
        <a href="mailto:{$refundData.contact.email}">{$refundData.contact.email}</a>
      </li>
      <li>
        <strong>Website:</strong>
        <a href="{$WEB_ROOT}/index.php" target="_blank" rel="noopener">{$refundData.contact.website}</a>
      </li>
      <li>
        <strong>Support:</strong> Open a ticket through our client <a href="{$WEB_ROOT}/submitticket.php">{$refundData.contact.portal}</a>.
      </li>
    </ul>
  </section>
  {/if}
</section>
