<style>
.hostx-container-psw {
    clear: both;
}
</style>
<div class="hostx-container-psw">
	<div class="col-sm-12">
		<p>{$LANG.pwresetemailneeded}</p>
		<div class="hostxpsw">
		<form method="post" action="{routePath('password-reset-validate-email')}" role="form">
			<input type="hidden" name="action" value="reset" />
			<div class="row">
				<div class="col-sm-6">
					<div class="form-group">
						<label for="inputEmail">{$LANG.loginemail}</label>
						<input type="email" name="email" class="form-control" id="inputEmail" placeholder="{$LANG.enteremail}" autofocus>
					</div>
				</div>
			</div>
			{if $captcha->isEnabled()}
				<div class="row">
					<div class="col-sm-6">
						<div class="text-center margin-bottom">
							{include file="$template/includes/captcha.tpl"}
						</div>
					</div>
				</div>
			{/if}
			<div class="row">
				<div class="col-sm-12 prebtn">
					<div class="clearfix"></div>
					<div class="form-group">
						<button type="submit" class="btn btn-primary{$captcha->getButtonClass($captchaForm)} button03 mt-0">
							{$LANG.pwresetsubmit}
						</button>
					</div>
				</div>
			</div>
		</form>
		</div>
	</div>
</div>