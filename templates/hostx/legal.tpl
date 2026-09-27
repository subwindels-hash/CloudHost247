<section class="legal-hero-banner">
    <div class="container">
        <div class="legal-hero-content text-center">
            <h1>Legal & Policy Center</h1>
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

<style>
/* =====================================================
   Legal & Policy Center - HostX Theme
   ===================================================== */

/* Hero Banner
   ----------------------------------------------------- */
.legal-hero-banner {
    background: linear-gradient(135deg, var(--primary-color, #1a73e8) 0%, var(--primary-dark, #0d47a1) 100%);
    color: #ffffff;
    padding: 80px 20px;
    position: relative;
    overflow: hidden;
}
.legal-hero-banner::before {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle at 30% 70%, rgba(255,255,255,0.08) 0%, transparent 50%),
                radial-gradient(circle at 70% 30%, rgba(255,255,255,0.05) 0%, transparent 40%);
    pointer-events: none;
}
.legal-hero-content {
    position: relative;
    z-index: 1;
}
.legal-hero-content h1 {
    font-size: 2.8rem;
    font-weight: 700;
    margin-bottom: 15px;
    letter-spacing: -0.5px;
}
.legal-hero-subtitle {
    font-size: 1.2rem;
    font-weight: 300;
    opacity: 0.95;
    margin: 0;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
}

/* Intro Text
   ----------------------------------------------------- */
.legal-main-content {
    padding: 60px 0 80px;
    background: var(--body-bg, #f8f9fa);
}
.legal-intro {
    max-width: 900px;
    margin: 0 auto 50px;
    text-align: center;
    color: var(--text-muted, #6c757d);
    font-size: 1.05rem;
    line-height: 1.7;
}
.legal-intro p {
    margin-bottom: 15px;
}

/* Cards Grid
   ----------------------------------------------------- */
.legal-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 25px;
    margin-bottom: 60px;
}

/* Legal Card
   ----------------------------------------------------- */
.legal-card {
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border: 1px solid var(--border-color, #e9ecef);
    border-radius: 12px;
    padding: 35px 30px;
    text-decoration: none;
    color: inherit;
    transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    position: relative;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.legal-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    background: var(--primary-color, #1a73e8);
    opacity: 0;
    transition: opacity 0.3s ease;
}
.legal-card:hover {
    transform: translateY(-6px);
    box-shadow: 0 16px 40px rgba(0,0,0,0.10);
    border-color: var(--primary-color, #1a73e8);
}
.legal-card:hover::before {
    opacity: 1;
}

.legal-card-icon {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: linear-gradient(135deg, var(--primary-color, #1a73e8) 0%, var(--primary-light, #42a5f5) 100%);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    margin-bottom: 20px;
    flex-shrink: 0;
    transition: transform 0.3s ease;
}
.legal-card:hover .legal-card-icon {
    transform: scale(1.08);
}

.legal-card-title {
    font-size: 1.2rem;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--heading-color, #212529);
    transition: color 0.2s ease;
}
.legal-card:hover .legal-card-title {
    color: var(--primary-color, #1a73e8);
}

.legal-card-desc {
    font-size: 0.95rem;
    line-height: 1.65;
    color: var(--text-muted, #6c757d);
    margin-bottom: 18px;
    flex-grow: 1;
}

.legal-card-link {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--primary-color, #1a73e8);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: gap 0.3s ease;
}
.legal-card:hover .legal-card-link {
    gap: 10px;
}

/* Contact CTA Section
   ----------------------------------------------------- */
.legal-contact-cta {
    margin-top: 20px;
}
.legal-cta-box {
    background: #ffffff;
    border: 1px solid var(--border-color, #e9ecef);
    border-radius: 16px;
    padding: 50px 30px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.06);
}
.legal-cta-box h3 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--heading-color, #212529);
}
.legal-cta-box p {
    color: var(--text-muted, #6c757d);
    margin-bottom: 25px;
    max-width: 550px;
    margin-left: auto;
    margin-right: auto;
    line-height: 1.6;
}
.legal-cta-box .btn {
    margin: 5px 8px;
    padding: 12px 28px;
    font-size: 0.95rem;
    border-radius: 8px;
    font-weight: 500;
    transition: all 0.25s ease;
}
.legal-cta-box .btn-outline {
    border: 2px solid var(--border-color, #e9ecef);
    color: var(--text-color, #495057);
    background: transparent;
}
.legal-cta-box .btn-outline:hover {
    border-color: var(--primary-color, #1a73e8);
    color: var(--primary-color, #1a73e8);
    background: rgba(26, 115, 232, 0.05);
}

/* Responsive
   ----------------------------------------------------- */
@media (max-width: 767px) {
    .legal-hero-content h1 {
        font-size: 2rem;
    }
    .legal-hero-subtitle {
        font-size: 1rem;
    }
    .legal-hero-banner {
        padding: 60px 20px;
    }
    .legal-cards-grid {
        grid-template-columns: 1fr;
        gap: 18px;
    }
    .legal-main-content {
        padding: 40px 0 60px;
    }
    .legal-card {
        padding: 28px 22px;
    }
    .legal-cta-box {
        padding: 35px 22px;
    }
    .legal-cta-box .btn {
        display: block;
        width: 100%;
        margin: 8px 0;
    }
}
@media (min-width: 768px) and (max-width: 991px) {
    .legal-cards-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}
</style>
