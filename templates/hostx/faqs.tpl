{*
 * CloudHost247 Isc - Frequently Asked Questions (FAQs) Template
 * Matches HostX theme styling with accordion functionality
 *}

<!-- Hero Banner Section -->
<section class="hero-banner faq-hero">
    <div class="container">
        <div class="row">
            <div class="col-12">
                <div class="hero-content text-center">
                    <h1>Frequently Asked Questions</h1>
                    <p class="hero-subtitle">Find answers to the most common questions about our services, policies, and processes.</p>
                    <div class="breadcrumb-wrapper">
                        <ol class="breadcrumb">
                            <li class="breadcrumb-item"><a href="index.php">{$LANG.globalsystemname}</a></li>
                            <li class="breadcrumb-item active" aria-current="page">Frequently Asked Questions</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

<!-- FAQ Content Section -->
<section class="faq-content-section">
    <div class="container">
        <div class="row justify-content-center">
            <div class="col-lg-10 col-xl-8">
                <div class="faq-intro">
                    <p class="text-muted text-center mb-5">Welcome to the CloudHost247 Isc FAQ section. We've compiled answers to help you get the most out of our services. Can't find what you're looking for? <a href="contact.php">Contact our support team</a>.</p>
                </div>

                <div class="faq-accordion" id="faqAccordion">
                    {foreach from=$faqItems item=faq name=faqloop}
                    <div class="faq-item" data-faq-id="{$faq.id}">
                        <button class="faq-question" type="button" aria-expanded="false" aria-controls="{$faq.id}">
                            <span class="faq-question-text">{$faq.question}</span>
                            <span class="faq-icon">
                                <span class="icon-plus">+</span>
                                <span class="icon-minus">&minus;</span>
                            </span>
                        </button>
                        <div class="faq-answer" id="{$faq.id}">
                            <div class="faq-answer-content">
                                {$faq.answer}
                            </div>
                        </div>
                    </div>
                    {/foreach}
                </div>

                <!-- Contact CTA -->
                <div class="faq-contact-cta text-center mt-5">
                    <div class="card border-0 shadow-sm">
                        <div class="card-body py-4">
                            <h5 class="card-title">Still have questions?</h5>
                            <p class="card-text text-muted">Our support team is available 24/7 to assist you with any inquiries.</p>
                            <a href="contact.php" class="btn btn-primary">Contact Support</a>
                            <a href="submitticket.php" class="btn btn-outline-primary ml-2">Open a Ticket</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

<style>
/* ========================================
   FAQ Page Styles - HostX Theme
   ======================================== */

/* Hero Banner */
.hero-banner.faq-hero {
    background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 50%, #1e3a5f 100%);
    padding: 80px 0 60px;
    position: relative;
    overflow: hidden;
}

.hero-banner.faq-hero::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 320"><path fill="%23ffffff" fill-opacity="0.03" d="M0,96L48,112C96,128,192,160,288,186.7C384,213,480,235,576,213.3C672,192,768,128,864,128C960,128,1056,192,1152,208C1248,224,1344,192,1392,176L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path></svg>') no-repeat bottom;
    background-size: cover;
}

.hero-banner.faq-hero .hero-content {
    position: relative;
    z-index: 1;
}

.hero-banner.faq-hero h1 {
    color: #ffffff;
    font-size: 2.5rem;
    font-weight: 700;
    margin-bottom: 15px;
}

.hero-banner.faq-hero .hero-subtitle {
    color: rgba(255, 255, 255, 0.85);
    font-size: 1.1rem;
    max-width: 600px;
    margin: 0 auto 20px;
}

.breadcrumb-wrapper {
    display: inline-block;
}

.breadcrumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 50px;
    padding: 10px 25px;
    margin: 0;
}

.breadcrumb-item a {
    color: rgba(255, 255, 255, 0.9);
    text-decoration: none;
}

.breadcrumb-item a:hover {
    color: #ffffff;
    text-decoration: underline;
}

.breadcrumb-item.active {
    color: rgba(255, 255, 255, 0.7);
}

.breadcrumb-item + .breadcrumb-item::before {
    color: rgba(255, 255, 255, 0.5);
}

/* FAQ Content Section */
.faq-content-section {
    padding: 60px 0 80px;
    background-color: #f8f9fa;
}

.faq-intro a {
    color: #2d5a87;
    font-weight: 500;
    text-decoration: none;
}

.faq-intro a:hover {
    text-decoration: underline;
}

/* Accordion Styles */
.faq-accordion {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.faq-item {
    background: #ffffff;
    border: 1px solid #e9ecef;
    border-radius: 10px;
    overflow: hidden;
    transition: box-shadow 0.3s ease, border-color 0.3s ease;
}

.faq-item:hover {
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
    border-color: #d0d7de;
}

.faq-item.active {
    box-shadow: 0 4px 20px rgba(45, 90, 135, 0.12);
    border-color: #2d5a87;
}

.faq-question {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 20px 25px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font-size: 1.05rem;
    font-weight: 600;
    color: #2c3e50;
    transition: color 0.3s ease, background-color 0.3s ease;
}

.faq-question:hover {
    color: #2d5a87;
    background-color: #f8fafc;
}

.faq-question:focus {
    outline: 2px solid #2d5a87;
    outline-offset: -2px;
}

.faq-question-text {
    flex: 1;
    padding-right: 15px;
}

.faq-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    min-width: 32px;
    background: #2d5a87;
    border-radius: 50%;
    color: #ffffff;
    font-size: 1.2rem;
    font-weight: 700;
    transition: transform 0.3s ease, background-color 0.3s ease;
}

.faq-item.active .faq-icon {
    background: #e74c3c;
    transform: rotate(0deg);
}

.icon-plus {
    display: block;
}

.icon-minus {
    display: none;
}

.faq-item.active .icon-plus {
    display: none;
}

.faq-item.active .icon-minus {
    display: block;
}

/* Answer Panel */
.faq-answer {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.4s ease-out, padding 0.4s ease;
}

.faq-item.active .faq-answer {
    max-height: 500px;
}

.faq-answer-content {
    padding: 0 25px 20px;
    color: #555;
    line-height: 1.7;
    font-size: 0.95rem;
}

.faq-answer-content ul {
    margin: 10px 0;
    padding-left: 20px;
}

.faq-answer-content ul li {
    margin-bottom: 6px;
    position: relative;
}

.faq-answer-content a {
    color: #2d5a87;
    text-decoration: none;
    font-weight: 500;
}

.faq-answer-content a:hover {
    text-decoration: underline;
}

/* Contact CTA */
.faq-contact-cta .card {
    border-radius: 12px;
}

.faq-contact-cta .btn {
    padding: 10px 25px;
    border-radius: 50px;
    font-weight: 600;
    transition: all 0.3s ease;
}

.faq-contact-cta .btn-primary {
    background-color: #2d5a87;
    border-color: #2d5a87;
}

.faq-contact-cta .btn-primary:hover {
    background-color: #1e3a5f;
    border-color: #1e3a5f;
    transform: translateY(-2px);
}

.faq-contact-cta .btn-outline-primary {
    color: #2d5a87;
    border-color: #2d5a87;
}

.faq-contact-cta .btn-outline-primary:hover {
    background-color: #2d5a87;
    color: #ffffff;
    transform: translateY(-2px);
}

/* Responsive Styles */
@media (max-width: 991px) {
    .hero-banner.faq-hero {
        padding: 60px 0 45px;
    }

    .hero-banner.faq-hero h1 {
        font-size: 2rem;
    }

    .faq-content-section {
        padding: 40px 0 60px;
    }
}

@media (max-width: 767px) {
    .hero-banner.faq-hero {
        padding: 45px 0 35px;
    }

    .hero-banner.faq-hero h1 {
        font-size: 1.6rem;
    }

    .hero-banner.faq-hero .hero-subtitle {
        font-size: 0.95rem;
    }

    .breadcrumb {
        padding: 8px 18px;
        font-size: 0.85rem;
    }

    .faq-question {
        padding: 16px 20px;
        font-size: 0.95rem;
    }

    .faq-answer-content {
        padding: 0 20px 16px;
        font-size: 0.9rem;
    }

    .faq-icon {
        width: 28px;
        height: 28px;
        min-width: 28px;
        font-size: 1rem;
    }

    .faq-contact-cta .btn {
        display: block;
        width: 100%;
        margin: 5px 0 !important;
    }
}

@media (max-width: 575px) {
    .hero-banner.faq-hero h1 {
        font-size: 1.4rem;
    }

    .faq-content-section {
        padding: 30px 0 50px;
    }
}
</style>

<script>
/**
 * FAQ Accordion Functionality
 * Supports toggle behavior with smooth animations
 * Closes other items when one is opened
 */
document.addEventListener('DOMContentLoaded', function() {
    const faqItems = document.querySelectorAll('.faq-item');
    const faqQuestions = document.querySelectorAll('.faq-question');

    faqQuestions.forEach(function(button) {
        button.addEventListener('click', function() {
            const currentItem = this.closest('.faq-item');
            const isActive = currentItem.classList.contains('active');

            // Close all items (accordion behavior - remove this block for toggle behavior)
            faqItems.forEach(function(item) {
                item.classList.remove('active');
                var btn = item.querySelector('.faq-question');
                btn.setAttribute('aria-expanded', 'false');
            });

            // Toggle current item
            if (!isActive) {
                currentItem.classList.add('active');
                this.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // Keyboard accessibility - allow Enter and Space to toggle
    faqQuestions.forEach(function(button) {
        button.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });
    });
});
</script>
