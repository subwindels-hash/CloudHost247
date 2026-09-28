{*
 * WHMCS CloudHost247 Theme - Refund Policy Template
 *
 * @package    CloudHost247
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
                        <h1>{$refundData.hero.title|upper}</h1>
                        {if $refundData.hero.subtitle}
                            <p class="subtitle">{$refundData.hero.subtitle}</p>
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
                        {if $refundData.introduction.content}
                            <div class="term-intro">
                                <p>{$refundData.introduction.content}</p>
                            </div>
                        {/if}

                        <!-- Policy Sections -->
                        {foreach from=$refundData.sections item=section}
                            <div class="term-section" id="{$section.id}">
                                <h2>{$section.title}</h2>
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
                        {if $refundData.contact}
                            <div class="term-section term-contact" id="contact">
                                <h2>{$refundData.contact.title}</h2>
                                <p>{$refundData.contact.content}</p>
                                <ul class="term-list contact-list">
                                    <li>
                                        <strong>Email:</strong>
                                        <a href="mailto:{$refundData.contact.email}">{$refundData.contact.email}</a>
                                    </li>
                                    <li>
                                        <strong>Website:</strong>
                                        <a href="https://{$refundData.contact.website}" target="_blank" rel="noopener">{$refundData.contact.website}</a>
                                    </li>
                                    <li>
                                        <strong>Support:</strong> Open a ticket through our client <a href="{$WEB_ROOT}/submitticket.php">{$refundData.contact.portal}</a>.
                                    </li>
                                </ul>
                            </div>
                        {/if}

                    </div>
                </div>
            </div>
        </div>
    </section>

