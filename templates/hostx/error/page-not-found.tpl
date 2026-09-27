<div class="features-option2 features-option3">
	<div class="container">
    <div class="row">
      <div class="col-sm-12">
            <center><img src="{$WEB_ROOT}/templates/{$template}/images/404_not_found.png"></center>
      </div>
    </div>
		<div class="error-container boxed">
			{*
			<h1><i class="fas fa-exclamation-triangle"></i> {lang key="errorPage.404.title"}</h1>
			<h3>{lang key="errorPage.404.subtitle"}</h3>
			*}
			<p>{lang key="errorPage.404.description"}</p>
			<div class="buttons">
				<a href="{$systemurl}" class="btn btn-default">
					{lang key="errorPage.404.home"}
				</a>
				<a href="{$systemurl}submitticket.php" class="btn btn-default">
					{lang key="errorPage.404.submitTicket"}
				</a>
			</div>
		</div>
	</div>
</div>
