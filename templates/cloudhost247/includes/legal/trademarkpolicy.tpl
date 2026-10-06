{*
 * WHMCS CloudHost247 Theme - Trademark & Copyright Infringement Policy Template
 *
 * @package    CloudHost247
 * @author     CloudHost247
 * @copyright  Copyright (c) CloudHost247 Isc., All Rights Reserved
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
                        <h2>{$trademarkData.hero.title|upper}</h2>
                        {if $trademarkData.hero.subtitle}
                            <p class="subtitle">{$trademarkData.hero.subtitle}</p>
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
                        {if $trademarkData.introduction.content}
                            <div class="term-intro">
                                <p>{$trademarkData.introduction.content}</p>
                            </div>
                        {/if}

                        <!-- Policy Sections -->
                        {foreach from=$trademarkData.sections item=section}
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
                        {if $trademarkData.contact}
                            <div class="term-section term-contact" id="contact">
                                <h3>{$trademarkData.contact.title}</h3>
                                <p>{$trademarkData.contact.content}</p>
                                <ul class="term-list contact-list">
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
                            </div>
                        {/if}

                    </div>
                </div>
            </div>
        </div>
    </section>
