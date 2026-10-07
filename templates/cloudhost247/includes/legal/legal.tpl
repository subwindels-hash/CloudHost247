<p class="ch-lede">All our legal documents and policies in one place</p>
<section class="ch-section ch-section--tight">
  <p>This section brings together all the key legal, privacy, and policy documents that govern how our platform operates and how your information is handled. It is designed to give you full transparency about your rights, responsibilities, and the standards we follow to protect users and maintain a secure, fair, and reliable service.</p>
  <p>We recommend reviewing these documents carefully to better understand how our platform works and to ensure you are fully informed when using any of our services.</p>
  <div class="ch-grid ch-grid--3">
    {foreach $legalSections as $section}
    <a class="ch-card" href="{$section.link}" id="{$section.id}">
      <h2>{$section.title}</h2>
      <p>{$section.desc}</p>
      <span class="ch-card__foot"><span class="ch-card-link">Read More <span aria-hidden="true">→</span></span></span>
    </a>
    {/foreach}
  </div>
  <div class="ch-note">
    <h2>Need Help or Have Questions?</h2>
    <p>Our support team is available to assist you with any legal or policy-related inquiries.</p>
    <p><a class="ch-btn ch-btn-dark" href="submitticket.php">Open a Support Ticket</a> <a class="ch-text-link" href="contact.php">Contact Us <span aria-hidden="true">→</span></a></p>
  </div>
</section>
