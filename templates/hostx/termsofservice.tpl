{* Terms & Conditions Template *}
{* Template: templates/hostx/termsofservice.tpl *}
{* Compatible with WHMCS 8.x+ *}

<style>
/* Terms & Conditions Page Styles */
.terms-page {
    --terms-primary: #1e3a8a;
    --terms-secondary: #3b82f6;
    --terms-accent: #0ea5e9;
    --terms-bg: #f8fafc;
    --terms-card-bg: #ffffff;
    --terms-text: #1e293b;
    --terms-text-muted: #64748b;
    --terms-border: #e2e8f0;
    --terms-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
    --terms-shadow-hover: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.04);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: var(--terms-text);
    background: var(--terms-bg);
    min-height: 100vh;
}

/* Hero Banner */
.terms-hero {
    background: linear-gradient(135deg, var(--terms-primary) 0%, var(--terms-secondary) 50%, var(--terms-accent) 100%);
    padding: 80px 0 100px;
    position: relative;
    overflow: hidden;
}

.terms-hero::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -20%;
    width: 600px;
    height: 600px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 50%;
}

.terms-hero::after {
    content: '';
    position: absolute;
    bottom: -30%;
    left: -10%;
    width: 400px;
    height: 400px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 50%;
}

.terms-hero-content {
    position: relative;
    z-index: 2;
    text-align: center;
    color: #fff;
}

.terms-hero-content h1 {
    font-size: 2.75rem;
    font-weight: 700;
    margin: 0 0 12px;
    letter-spacing: -0.02em;
}

.terms-hero-content .effective-date {
    font-size: 1rem;
    opacity: 0.85;
    font-weight: 400;
}

/* Main Content Container */
.terms-container {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 24px;
}

/* Content Card */
.terms-card {
    background: var(--terms-card-bg);
    border-radius: 16px;
    box-shadow: var(--terms-shadow);
    margin-top: -40px;
    position: relative;
    z-index: 10;
    padding: 48px;
    border: 1px solid var(--terms-border);
}

/* Section Styling */
.terms-section {
    margin-bottom: 48px;
}

.terms-section:last-child {
    margin-bottom: 0;
}

.section-header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 24px;
    padding-bottom: 20px;
    border-bottom: 2px solid var(--terms-border);
}

.section-icon {
    width: 44px;
    height: 44px;
    background: linear-gradient(135deg, var(--terms-primary), var(--terms-secondary));
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 1.1rem;
    flex-shrink: 0;
}

.section-header h2 {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--terms-primary);
    margin: 0;
    line-height: 1.3;
}

.section-content {
    padding-left: 58px;
}

.section-content p {
    font-size: 1rem;
    line-height: 1.8;
    color: var(--terms-text);
    margin: 0 0 16px;
    text-align: justify;
}

.section-content p:last-child {
    margin-bottom: 0;
}

/* Introduction special styling */
.terms-intro {
    background: linear-gradient(135deg, rgba(30, 58, 138, 0.03) 0%, rgba(59, 130, 246, 0.03) 100%);
    border-left: 4px solid var(--terms-secondary);
    border-radius: 12px;
    padding: 28px 32px;
    margin-bottom: 48px;
}

.terms-intro p {
    font-size: 1.05rem;
    line-height: 1.9;
    margin: 0 0 14px;
    text-align: justify;
}

.terms-intro p:last-child {
    margin-bottom: 0;
}

/* Contact Section Special */
.contact-block {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 20px;
    margin-top: 24px;
}

.contact-item {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 20px;
    background: var(--terms-bg);
    border-radius: 12px;
    border: 1px solid var(--terms-border);
    transition: all 0.3s ease;
}

.contact-item:hover {
    box-shadow: var(--terms-shadow-hover);
    transform: translateY(-2px);
}

.contact-item i {
    font-size: 1.2rem;
    color: var(--terms-secondary);
    margin-top: 2px;
}

.contact-item .contact-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--terms-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
}

.contact-item .contact-value {
    font-size: 1rem;
    color: var(--terms-text);
    font-weight: 500;
    word-break: break-word;
}

.contact-item a {
    color: var(--terms-secondary);
    text-decoration: none;
    transition: color 0.2s;
}

.contact-item a:hover {
    color: var(--terms-primary);
    text-decoration: underline;
}

/* Last Updated Footer */
.terms-footer-meta {
    margin-top: 48px;
    padding-top: 28px;
    border-top: 1px solid var(--terms-border);
    text-align: center;
}

.terms-footer-meta p {
    font-size: 0.9rem;
    color: var(--terms-text-muted);
    margin: 0;
}

.terms-footer-meta .jurisdiction {
    margin-top: 8px;
    font-weight: 500;
    color: var(--terms-text);
}

/* Responsive Design */
@media (max-width: 768px) {
    .terms-hero {
        padding: 60px 0 80px;
    }

    .terms-hero-content h1 {
        font-size: 2rem;
    }

    .terms-card {
        margin-top: -30px;
        padding: 28px;
        border-radius: 12px;
    }

    .section-header {
        gap: 12px;
        margin-bottom: 18px;
        padding-bottom: 16px;
    }

    .section-icon {
        width: 38px;
        height: 38px;
        font-size: 0.95rem;
        border-radius: 10px;
    }

    .section-header h2 {
        font-size: 1.2rem;
    }

    .section-content {
        padding-left: 0;
    }

    .terms-intro {
        padding: 20px 24px;
        margin-bottom: 36px;
    }

    .terms-section {
        margin-bottom: 36px;
    }

    .contact-block {
        grid-template-columns: 1fr;
        gap: 14px;
    }
}

@media (max-width: 480px) {
    .terms-hero-content h1 {
        font-size: 1.65rem;
    }

    .terms-card {
        padding: 22px;
    }

    .terms-intro {
        padding: 18px 20px;
    }

    .section-content p,
    .terms-intro p {
        font-size: 0.95rem;
    }
}

/* Print Styles */
@media print {
    .terms-hero {
        background: var(--terms-primary) !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    .terms-card {
        box-shadow: none;
        border: 1px solid #ccc;
    }

    .section-icon {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
}
</style>

<div class="terms-page">
    <!-- Hero Banner Section -->
    <section class="terms-hero">
        <div class="terms-container">
            <div class="terms-hero-content">
                <h1>{$pageTitle}</h1>
                <p class="effective-date">
                    <i class="far fa-calendar-alt" style="margin-right:6px;"></i>
                    Effective Date: {$effectiveDate}
                </p>
            </div>
        </div>
    </section>

    <!-- Main Content Card -->
    <div class="terms-container">
        <div class="terms-card">
            
            <!-- Introduction -->
            <div class="terms-intro">
                <p>Welcome to <strong>{$companyName}</strong>. These Terms & Conditions ("Terms," "Agreement") govern your access to and use of our websites, products, and services (collectively, the "Services"). By accessing or using our Services, you agree to be bound by these Terms.</p>
                <p>If you do not agree with any part of these Terms, you may not access or use our Services.</p>
            </div>

            <!-- Section: Account Terms -->
            <section class="terms-section" id="account-terms">
                <div class="section-header">
                    <div class="section-icon">
                        <i class="fas fa-user-shield"></i>
                    </div>
                    <h2>Account Registration & Security</h2>
                </div>
                <div class="section-content">
                    <p>You must be at least 18 years old and have the legal capacity to enter into a binding contract. You must provide accurate, complete, and up-to-date information when registering for our Services.</p>
                    <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. You agree to notify us immediately of any unauthorized access or security breach.</p>
                    <p>We reserve the right to suspend or terminate accounts if we suspect fraudulent or abusive activity.</p>
                </div>
            </section>

            <!-- Section: Service Usage Terms -->
            <section class="terms-section" id="service-usage">
                <div class="section-header">
                    <div class="section-icon">
                        <i class="fas fa-server"></i>
                    </div>
                    <h2>Service Usage Terms</h2>
                </div>
                <div class="section-content">
                    <p>You agree not to use our Services to violate any applicable laws or regulations, engage in spamming, phishing, or distribution of malware, host or transmit illegal, harmful, or obscene content, infringe intellectual property rights of others, or interfere with or disrupt the operation of our Services or networks.</p>
                    <p>We reserve the right to remove content, suspend accounts, or terminate Services for violations. All content, trademarks, and materials on our website are owned by {$companyName} or our licensors. You are granted a limited, non-exclusive, non-transferable license to use our Services for personal or business purposes in accordance with these Terms.</p>
                    <p>We aim to provide 99.9% uptime for hosting services but do not guarantee uninterrupted service. Scheduled maintenance will be communicated in advance whenever possible. Emergency maintenance may be performed without notice.</p>
                </div>
            </section>

            <!-- Section: Payments & Billing Terms -->
            <section class="terms-section" id="payments-billing">
                <div class="section-header">
                    <div class="section-icon">
                        <i class="fas fa-credit-card"></i>
                    </div>
                    <h2>Payments & Billing Terms</h2>
                </div>
                <div class="section-content">
                    <p>All fees are due according to the billing cycle agreed upon during purchase. Payments must be made via accepted payment methods listed on our website.</p>
                    <p>Failure to pay may result in suspension or termination of Services. All fees are non-refundable unless otherwise stated in our Refund Policy.</p>
                    <p>Third-party services we provide access to or integrate with are subject to their own terms. We are not responsible for their content, policies, or performance.</p>
                </div>
            </section>

            <!-- Section: User Responsibilities -->
            <section class="terms-section" id="user-responsibilities">
                <div class="section-header">
                    <div class="section-icon">
                        <i class="fas fa-user-check"></i>
                    </div>
                    <h2>User Responsibilities & Indemnification</h2>
                </div>
                <div class="section-content">
                    <p>You agree to use the Services only for lawful purposes and in compliance with all applicable laws and regulations. You are solely responsible for any content you upload, transmit, or store using our Services.</p>
                    <p>You agree to indemnify, defend, and hold harmless {$companyName}, its employees, and affiliates from any claims, damages, or expenses arising from your use of the Services or violation of these Terms.</p>
                    <p>Your use of our Services is subject to our Privacy Policy, which explains how we collect, use, and protect your personal information.</p>
                </div>
            </section>

            <!-- Section: Limitations of Liability -->
            <section class="terms-section" id="limitations-liability">
                <div class="section-header">
                    <div class="section-icon">
                        <i class="fas fa-balance-scale"></i>
                    </div>
                    <h2>Limitations of Liability</h2>
                </div>
                <div class="section-content">
                    <p>To the maximum extent permitted by law, {$companyName} shall not be liable for any indirect, incidental, or consequential damages. Our total liability for any claim shall not exceed the amount you paid for the Services in the 12 months prior to the claim.</p>
                    <p>Our Services are provided "as is" and "as available" without warranties of any kind, either express or implied. We do not warrant that the Services will be error-free, secure, or uninterrupted.</p>
                </div>
            </section>

            <!-- Section: Termination Policy -->
            <section class="terms-section" id="termination">
                <div class="section-header">
                    <div class="section-icon">
                        <i class="fas fa-times-circle"></i>
                    </div>
                    <h2>Termination Policy</h2>
                </div>
                <div class="section-content">
                    <p>We may suspend or terminate your account if you violate these Terms, if payment is overdue, or if required by law or court order.</p>
                    <p>You may terminate your account at any time by contacting our support team. Upon termination, your right to use the Services will immediately cease, and we may delete your data in accordance with our data retention policies.</p>
                    <p>All provisions of these Terms which by their nature should survive termination shall survive termination, including ownership provisions, warranty disclaimers, indemnity, and limitations of liability.</p>
                </div>
            </section>

            <!-- Section: Contact Information -->
            <section class="terms-section" id="contact">
                <div class="section-header">
                    <div class="section-icon">
                        <i class="fas fa-envelope"></i>
                    </div>
                    <h2>Contact Information</h2>
                </div>
                <div class="section-content">
                    <p>For questions or concerns about these Terms, please contact our support team using the details below. We reserve the right to modify these Terms at any time. Changes will be posted on our website with an updated "Effective Date." Continued use of our Services after changes means you accept the new Terms.</p>
                    
                    <div class="contact-block">
                        <div class="contact-item">
                            <i class="fas fa-envelope"></i>
                            <div>
                                <div class="contact-label">Email Support</div>
                                <div class="contact-value">
                                    <a href="mailto:{$supportEmail}">{$supportEmail}</a>
                                </div>
                            </div>
                        </div>
                        <div class="contact-item">
                            <i class="fas fa-globe"></i>
                            <div>
                                <div class="contact-label">Website</div>
                                <div class="contact-value">
                                    <a href="{$companyUrl}" target="_blank" rel="noopener">www.cloudhost247.com</a>
                                </div>
                            </div>
                        </div>
                        <div class="contact-item">
                            <i class="fas fa-gavel"></i>
                            <div>
                                <div class="contact-label">Governing Law</div>
                                <div class="contact-value">{$jurisdiction}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Footer Meta -->
            <div class="terms-footer-meta">
                <p>These Terms & Conditions were last updated on <strong>{$effectiveDate}</strong>.</p>
                <p class="jurisdiction">Governing Law: {$jurisdiction} &mdash; Nigerian Courts have exclusive jurisdiction.</p>
            </div>

        </div>
    </div>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
    // Smooth scroll for any anchor links
    document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            var target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Add subtle animation on scroll
    var sections = document.querySelectorAll('.terms-section');
    var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    sections.forEach(function(section) {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(section);
    });
});
</script>
