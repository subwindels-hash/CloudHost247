{*
 * WHMCS HostX Theme - Cybercrime Detection Policy Template
 *
 * @package    HostX
 * @author     CloudHost247
 * @copyright  Copyright (c) CloudHost247, All Rights Reserved
 * @link       https://www.cloudhost247.com
 *}


    <!-- ============================================ -->
    <!-- HERO / BANNER SECTION                        -->
    <!-- ============================================ -->
    <section class="term-domain_banner">
        <div class="container">
            <div class="row">
                <div class="col-lg-12 col-md-12 col-sm-12">
                    <div class="banner-content text-center">
                        <h1>{$cybercrimeData.hero.title|upper}</h1>
                        {if $cybercrimeData.hero.subtitle}
                            <p class="subtitle">{$cybercrimeData.hero.subtitle}</p>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- ============================================ -->
    <!-- INNER CONTENT SECTION                        -->
    <!-- ============================================ -->
    <section class="inner-term-domain-page">
        <div class="container">
            <div class="row">
                <div class="col-lg-12 col-md-12 col-sm-12">
                    <div class="term-content-wrapper">

                        <!-- Introduction -->
                        {if $cybercrimeData.introduction.content}
                            <div class="term-intro">
                                <p>{$cybercrimeData.introduction.content}</p>
                            </div>
                        {/if}

                        <!-- Policy Sections -->
                        {foreach from=$cybercrimeData.sections item=section}
                            <div class="term-section" id="{$section.id}">
                                <h3>{$section.title}</h3>
                                {if $section.content}
                                    <p>{$section.content}</p>
                                {/if}
                                {if $section.items}
                                    <ul class="term-list">
                                        {foreach from=$section.items item=item}
                                            <li>{$item}</li>
                                        {/foreach}
                                    </ul>
                                {/if}
                            </div>
                        {/foreach}

                        <!-- Contact Section -->
                        {if $cybercrimeData.contact}
                            <div class="term-section term-contact" id="contact">
                                <h3>{$cybercrimeData.contact.title}</h3>
                                <p>{$cybercrimeData.contact.content}</p>
                                <ul class="term-list contact-list">
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
                                        <a href="https://{$cybercrimeData.contact.website}" target="_blank" rel="noopener">{$cybercrimeData.contact.website}</a>
                                    </li>
                                    <li>
                                        <strong>Support:</strong> Open a ticket through our client <a href="{$WEB_ROOT}/submitticket.php">{$cybercrimeData.contact.portal}</a>.
                                    </li>
                                </ul>
                            </div>
                        {/if}

                    </div>
                </div>
            </div>
        </div>
    </section>

