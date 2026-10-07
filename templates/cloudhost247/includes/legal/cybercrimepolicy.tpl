{*
* WHMCS CloudHost247 Theme - Cybercrime Detection Policy Template
*
* @package    CloudHost247
* @author     CloudHost247
* @copyright  Copyright (c) CloudHost247 Isc., All Rights Reserved
* @link       https://www.cloudhost247.com
*}
<p class="ch-lede">{$cybercrimeData.hero.subtitle}</p>
<section>
  {if $cybercrimeData.introduction.content}
  <p>{$cybercrimeData.introduction.content}</p>
  {/if}
  {foreach from=$cybercrimeData.sections item=section}
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
  {if $cybercrimeData.contact}
  <section id="contact">
    <h2>{$cybercrimeData.contact.title}</h2>
    <p>{$cybercrimeData.contact.content}</p>
    <ul>
      <li>
        <strong>Abuse Email:</strong>
        <a href="mailto:{$cybercrimeData.contact.email}">{$cybercrimeData.contact.email}</a>
      </li>
      {if $cybercrimeData.contact.email_secondary}
      <li>
        <strong>Support Email:</strong>
        <a href="mailto:{$cybercrimeData.contact.email_secondary}">{$cybercrimeData.contact.email_secondary}</a>
      </li>
      {/if}
      <li>
        <strong>Website:</strong>
        <a href="{$WEB_ROOT}/index.php" target="_blank" rel="noopener">{$cybercrimeData.contact.website}</a>
      </li>
      <li>
        <strong>Support:</strong> Open a ticket through our client <a href="{$WEB_ROOT}/submitticket.php">{$cybercrimeData.contact.portal}</a>.
      </li>
    </ul>
  </section>
  {/if}
</section>
