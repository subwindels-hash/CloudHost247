{* Help Center Page *}
{* Template: templates/hostx/helpcenter.tpl *}
{* Compatible with HostX Theme for WHMCS *}

{* Banner / Hero Section *}
<div class="legal-banner-section help-center-banner">
    <div class="container">
        <div class="row">
            <div class="col-12 text-center">
                <h1>HELP CENTER</h1>
                <p class="legal-effective-date">Effective Date: August 14, 2025</p>
            </div>
        </div>
    </div>
</div>

{* Search Section *}
<div class="help-search-section">
    <div class="container">
        <div class="row">
            <div class="col-12 col-md-8 offset-md-2">
                <div class="search-box-wrapper text-center">
                    <p class="search-intro">How can we help you today?</p>
                    <div class="input-group help-search-group">
                        <input type="text" class="form-control" placeholder="Search for answers..." aria-label="Search help articles">
                        <div class="input-group-append">
                            <button class="btn btn-primary" type="button"><i class="fas fa-search"></i> Search</button>
                        </div>
                    </div>
                    <p class="search-hint">Try keywords like "billing", "password", "migration", or "refund"</p>
                </div>
            </div>
        </div>
    </div>
</div>

{* Main Content Container *}
<div class="container inner_term_container help-center-container">
    <div class="row">
        <div class="col-12">

            {* Introductory Statement *}
            <div class="legal-intro">
                <p>Welcome to the CloudHost247 Isc Help Center — your one-stop destination for support, troubleshooting, and guidance on all our services. Whether you're a new customer or an experienced user, you'll find the resources you need to get the most out of our hosting and cloud solutions.</p>
            </div>

            {* Section 1: Getting Started *}
            <div class="help-section" id="getting-started">
                <h3><i class="fas fa-rocket section-icon"></i> Getting Started</h3>
                <div class="faq-item">
                    <h4 class="faq-question">How do I create an account?</h4>
                    <div class="faq-answer">
                        <ol>
                            <li>Visit <a href="https://www.cloudhost247.com" target="_blank" rel="noopener">www.cloudhost247.com</a></li>
                            <li>Click <strong>Sign Up</strong></li>
                            <li>Fill in your details and submit the form</li>
                            <li>Verify your email address</li>
                            <li>Log in to your Client Area</li>
                        </ol>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">How do I access my services?</h4>
                    <div class="faq-answer">
                        <ul>
                            <li>Log in to your Client Area</li>
                            <li>Go to <strong>My Services</strong></li>
                            <li>Select the product or service you wish to manage</li>
                        </ul>
                    </div>
                </div>
            </div>

            {* Section 2: Account & Billing *}
            <div class="help-section" id="account-billing">
                <h3><i class="fas fa-user-circle section-icon"></i> Account & Billing</h3>
                <div class="faq-item">
                    <h4 class="faq-question">How do I update my account information?</h4>
                    <div class="faq-answer">
                        <ol>
                            <li>Log in to your Client Area</li>
                            <li>Navigate to <strong>Profile Settings</strong></li>
                            <li>Update your details and click <strong>Save Changes</strong></li>
                        </ol>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">How do I change my password?</h4>
                    <div class="faq-answer">
                        <ul>
                            <li>Go to <strong>Security Settings</strong> in your Client Area</li>
                            <li>Choose <strong>Change Password</strong></li>
                            <li>Use a strong password (combination of letters, numbers, and symbols)</li>
                        </ul>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">What payment methods do you accept?</h4>
                    <div class="faq-answer">
                        <ul>
                            <li>Credit/Debit Cards</li>
                            <li>PayPal</li>
                            <li>Bank Transfer</li>
                            <li>Cryptocurrency (where applicable)</li>
                        </ul>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">How do I view my invoices?</h4>
                    <div class="faq-answer">
                        <ul>
                            <li>Log in to your Client Area</li>
                            <li>Go to <strong>Billing → My Invoices</strong></li>
                            <li>Click <strong>View Invoice</strong> to see payment details</li>
                        </ul>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">How do I request a refund?</h4>
                    <div class="faq-answer">
                        <p>Refer to our <a href="refund-policy.php">Refund Policy</a> to check eligibility, then email <a href="mailto:billing@cloudhost247.com">billing@cloudhost247.com</a> with your invoice number.</p>
                    </div>
                </div>
            </div>

            {* Section 3: Services & Features *}
            <div class="help-section" id="services-features">
                <h3><i class="fas fa-cogs section-icon"></i> Services & Features</h3>
                <div class="faq-item">
                    <h4 class="faq-question">What hosting plans do you offer?</h4>
                    <div class="faq-answer">
                        <p>We offer a range of hosting solutions including Shared Hosting, VPS Hosting, Dedicated Servers, Cloud Hosting, and WordPress Hosting. Visit our <a href="cart.php">Services page</a> for full details and pricing.</p>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">Do you offer website migration?</h4>
                    <div class="faq-answer">
                        <p>Yes, we offer free migration assistance for most hosting plans. To request migration:</p>
                        <ol>
                            <li>Open a support ticket with your current hosting details</li>
                            <li>Our migration team will confirm compatibility and schedule the transfer</li>
                            <li>You'll be notified once migration is complete</li>
                        </ol>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">Can I upgrade or downgrade my plan?</h4>
                    <div class="faq-answer">
                        <p>Yes, you can upgrade or downgrade at any time from your Client Area. Go to <strong>My Services</strong>, select your plan, and choose the upgrade or downgrade option. Changes typically take effect immediately.</p>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">What control panel do you use?</h4>
                    <div class="faq-answer">
                        <p>We provide cPanel/WHM for Linux hosting and Plesk for Windows hosting. Both include intuitive interfaces for managing your websites, email, databases, and DNS.</p>
                    </div>
                </div>
            </div>

            {* Section 4: Technical Support *}
            <div class="help-section" id="technical-support">
                <h3><i class="fas fa-wrench section-icon"></i> Technical Support</h3>
                <div class="faq-item">
                    <h4 class="faq-question">How do I contact support?</h4>
                    <div class="faq-answer">
                        <ul>
                            <li><strong>Email:</strong> <a href="mailto:support@cloudhost247.com">support@cloudhost247.com</a></li>
                            <li><strong>Live Chat:</strong> Available on our website</li>
                            <li><strong>Support Tickets:</strong> Submit via Client Area</li>
                        </ul>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">My website is not loading. What should I check?</h4>
                    <div class="faq-answer">
                        <p>Check DNS settings and hosting status in your Client Area. Ensure your domain is pointed to the correct nameservers and that your hosting account is active.</p>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">My email is not working. How do I fix it?</h4>
                    <div class="faq-answer">
                        <p>Verify MX records and email configuration in your control panel. Ensure your domain's MX records point to the correct mail server and that your email accounts are properly configured.</p>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">I forgot my password. How do I reset it?</h4>
                    <div class="faq-answer">
                        <p>Use the password reset option on the <a href="clientarea.php">login page</a>. Enter your email address and follow the instructions sent to your inbox.</p>
                    </div>
                </div>
            </div>

            {* Section 5: FAQs *}
            <div class="help-section" id="faqs">
                <h3><i class="fas fa-question-circle section-icon"></i> Frequently Asked Questions</h3>
                <div class="faq-item">
                    <h4 class="faq-question">How do I keep my account safe?</h4>
                    <div class="faq-answer">
                        <ul>
                            <li>Use strong passwords</li>
                            <li>Enable two-factor authentication (2FA)</li>
                            <li>Avoid sharing login details</li>
                        </ul>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">How do you protect my data?</h4>
                    <div class="faq-answer">
                        <p>We comply with GDPR, CCPA, and industry best practices to protect your information. See our <a href="data-protection-standards.php">Data Protection Standards</a> for details.</p>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">How do I request account deletion?</h4>
                    <div class="faq-answer">
                        <p>To request account deletion, follow our <a href="data-deletion.php">Data Deletion Instructions</a>. Some data may be retained for legal or security purposes before permanent removal.</p>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">Where can I find your legal policies?</h4>
                    <div class="faq-answer">
                        <p>Our legal policies are available here:</p>
                        <ul>
                            <li><a href="terms-of-service.php">Terms & Conditions</a></li>
                            <li><a href="privacy-policy.php">Privacy Policy</a></li>
                            <li><a href="refund-policy.php">Refund Policy</a></li>
                            <li><a href="cookie-policy.php">Cookie Policy</a></li>
                            <li><a href="data-protection-standards.php">Data Protection Standards</a></li>
                        </ul>
                    </div>
                </div>
                <div class="faq-item">
                    <h4 class="faq-question">What is your uptime guarantee?</h4>
                    <div class="faq-answer">
                        <p>We offer a 99.9% uptime guarantee for all hosting services. If we fall below this threshold, you may be eligible for service credits as outlined in our Service Level Agreement (SLA).</p>
                    </div>
                </div>
            </div>

            {* Section 6: Contact Us *}
            <div class="help-section contact-section" id="contact-us">
                <h3><i class="fas fa-envelope section-icon"></i> Contact Us</h3>
                <div class="contact-grid">
                    <div class="contact-card">
                        <h5>General Inquiries</h5>
                        <p><a href="mailto:info@cloudhost247.com">info@cloudhost247.com</a></p>
                    </div>
                    <div class="contact-card">
                        <h5>Technical Support</h5>
                        <p><a href="mailto:support@cloudhost247.com">support@cloudhost247.com</a></p>
                    </div>
                    <div class="contact-card">
                        <h5>Billing</h5>
                        <p><a href="mailto:billing@cloudhost247.com">billing@cloudhost247.com</a></p>
                    </div>
                    <div class="contact-card">
                        <h5>Website</h5>
                        <p><a href="https://www.cloudhost247.com" target="_blank" rel="noopener">www.cloudhost247.com</a></p>
                    </div>
                </div>
            </div>

        </div>
    </div>
</div>
