<section class="legal-hero-banner">
    <div class="container">
        <div class="legal-hero-content text-center">
            <h2>Legal & Policy Center</h2>
            <p class="legal-hero-subtitle">All our legal documents and policies in one place</p>
        </div>
    </div>
</section>

<section class="legal-main-content">
    <div class="container">

        <div class="legal-intro">
            <p>This section brings together all the key legal, privacy, and policy documents that govern how our platform operates and how your information is handled. It is designed to give you full transparency about your rights, responsibilities, and the standards we follow to protect users and maintain a secure, fair, and reliable service.</p>
            <p>We recommend reviewing these documents carefully to better understand how our platform works and to ensure you are fully informed when using any of our services.</p>
        </div>

        <div class="legal-cards-grid">
            {foreach $legalSections as $section}
                <a href="{$section.link}" class="legal-card" id="{$section.id}">
                    <div class="legal-card-icon">
                        <i class="fas {$section.icon}"></i>
                    </div>
                    <div class="legal-card-body">
                        <h3 class="legal-card-title">{$section.title}</h3>
                        <p class="legal-card-desc">{$section.desc}</p>
                        <span class="legal-card-link">Read More <i class="fas fa-arrow-right"></i></span>
                    </div>
                </a>
            {/foreach}
        </div>

        <div class="legal-contact-cta text-center">
            <div class="legal-cta-box">
                <h3>Need Help or Have Questions?</h3>
                <p>Our support team is available to assist you with any legal or policy-related inquiries.</p>
                <a href="submitticket.php" class="btn btn-primary"><i class="fas fa-life-ring"></i> Open a Support Ticket</a>
                <a href="contact.php" class="btn btn-outline">Contact Us</a>
            </div>
        </div>

    </div>
</section>
