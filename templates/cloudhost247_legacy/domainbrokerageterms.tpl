{*
 * CloudHost247 legacy theme — Domain Brokerage Terms page.
 * Rendered by domain-brokerage-terms.php; data arrives as $brokerageTerms.
 *}

    <section class="term-domain_banner">
        <div class="container">
            <div class="row">
                <div class="col-lg-12 col-md-12 col-sm-12">
                    <div class="banner-content text-center">
                        <h1>{$brokerageTerms.hero.title|upper}</h1>
                        {if $brokerageTerms.hero.subtitle}
                            <p class="subtitle">{$brokerageTerms.hero.subtitle}</p>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </section>

    <section class="inner-term-domain-page">
        <div class="container">
            <div class="row">
                <div class="col-lg-12 col-md-12 col-sm-12">
                    <div class="term-content-wrapper">

                        <div class="term-intro">
                            <p>These terms govern the CloudHost247 Domain Brokerage service, under which CloudHost247 attempts to acquire an already-registered domain on your behalf. By submitting a brokerage request you accept these terms together with the general CloudHost247 Terms of Service.</p>
                        </div>

                        {foreach from=$brokerageTerms.sections item=section}
                            <div class="term-section" id="{$section.id}">
                                <h2>{$section.title}</h2>
                                {if $section.content}
                                    <p>{$section.content}</p>
                                {/if}
                            </div>
                        {/foreach}

                        {if $brokerageTerms.contact}
                            <div class="term-section term-contact" id="contact">
                                <h2>{$brokerageTerms.contact.title}</h2>
                                <p>{$brokerageTerms.contact.content}</p>
                                <ul class="term-list contact-list">
                                    <li>
                                        <strong>Email:</strong>
                                        <a href="mailto:{$brokerageTerms.contact.email}">{$brokerageTerms.contact.email}</a>
                                    </li>
                                    <li>
                                        <strong>Website:</strong>
                                        <a href="https://{$brokerageTerms.contact.website}" target="_blank" rel="noopener">{$brokerageTerms.contact.website}</a>
                                    </li>
                                    <li>
                                        <strong>Support:</strong> Open a ticket through our client <a href="{$WEB_ROOT}/submitticket.php">support portal</a>.
                                    </li>
                                </ul>
                            </div>
                        {/if}

                    </div>
                </div>
            </div>
        </div>
    </section>
