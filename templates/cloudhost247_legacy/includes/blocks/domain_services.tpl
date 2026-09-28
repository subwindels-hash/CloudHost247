{if $hostx_blocks[$block_slug]}
<div class="custom-block-9">
  <div class="container">
        <div class="b-9-title">
          <h2>{eval var=$hostx_blocks[$block_slug]->title}</h2>
        </div>
		<div class="row">
		  {foreach $hostx_blocks[$block_slug]->widgets as $widget}
			{eval var=$widget->widget_description|html_entity_decode}
		  {/foreach}
		</div>
  </div>
</div>
{else}
    <div class="custom-block-9">
      <div class="container">
        <div class="b-9-title">
          <h2>Domain Services</h2>
        </div>
        <div class="row">
          <div class="col-md-6">
            <div class="b-9-box">
            <h3><i class="fa fa-envelope" aria-hidden="true"></i> Free Email Accounts</h3>
            <p>You can send and receive emails with your personalized email account. Plus, you can take advantage of FREE fraud, spam, and virus protection.</p>
            </div>
          </div>
           <div class="col-md-6">
            <div class="b-9-box">
            <h3><i class="fa fa-cogs" aria-hidden="true"></i> DNS Management</h3>
            <p>The service offers the fastest response time, unparalleled redundancy, and advanced security. Manage your DNS records, website location, email, sub-domains, aliases & FTP.</p>
            </div>
          </div>
          <div class="col-md-6">
            <div class="b-9-box">
            <h3><i class="fa fa-globe" aria-hidden="true"></i> Domain Forwarding</h3>
            <p>Employ the services to forward your domain to any URL you select. We offer three services: direct domain forwarding, mask forwarding, and IP forwarding.</p>
            </div>
          </div>
          <div class="col-md-6">
            <div class="b-9-box">
            <h3><i class="fa fa-sign-in" aria-hidden="true"></i> Domain Lock</h3>
            <p>When you have selected your domain, protect it by locking while preventing unauthorized transfers. This domain lock service will save your credentials and keep them secure.</p>
            </div>
          </div>
        </div>
        </div>
    </div>
{/if}