{*
 * WHMCS HostX Theme - Backup Policy Template
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
                        <h1>{$backupData.hero.title|upper}</h1>
                        {if $backupData.hero.subtitle}
                            <p class="subtitle">{$backupData.hero.subtitle}</p>
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
                        {if $backupData.introduction.content}
                            <div class="term-intro">
                                <p>{$backupData.introduction.content}</p>
                            </div>
                        {/if}

                        <!-- Policy Sections -->
                        {foreach from=$backupData.sections item=section}
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
                        {if $backupData.contact}
                            <div class="term-section term-contact" id="contact">
                                <h3>{$backupData.contact.title}</h3>
                                <p>{$backupData.contact.content}</p>
                                <ul class="term-list contact-list">
                                    <li>
                                        <strong>Email:</strong>
                                        <a href="mailto:{$backupData.contact.email}">{$backupData.contact.email}</a>
                                    </li>
                                    <li>
                                        <strong>Website:</strong>
                                        <a href="https://{$backupData.contact.website}" target="_blank" rel="noopener">{$backupData.contact.website}</a>
                                    </li>
                                    <li>
                                        <strong>Support:</strong> Open a ticket through our client <a href="{$WEB_ROOT}/submitticket.php">{$backupData.contact.portal}</a>.
                                    </li>
                                </ul>
                            </div>
                        {/if}

                    </div>
                </div>
            </div>
        </div>
    </section>

