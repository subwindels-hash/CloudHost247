<div class="hostx-container-psw">
	<div class="col-sm-12">
	<p>{$LANG.pwresetenternewpw}</p>
		<form class="using-password-strength" method="POST" action="{routePath('password-reset-change-perform')}">
			<input type="hidden" name="answer" id="answer" value="{$securityAnswer}" />
			<div class="row">
				<div class="col-sm-4">
					<div id="newPassword1" class="form-group has-feedback">
						<div class="form-group">
							<label class="control-label" for="inputNewPassword1">{$LANG.newpassword}</label>
							<input type="password" name="newpw" id="inputNewPassword1" class="form-control" autocomplete="off" />
							<span class="form-control-feedback glyphicon glyphicon-password"></span>
						</div>
					</div>
				</div>
				<div class="col-sm-4">
					<div id="newPassword2" class="form-group has-feedback">
						<div class="form-group">
							<label class="control-label" for="inputNewPassword2">{$LANG.confirmnewpassword}</label>
							<input type="password" name="confirmpw" id="inputNewPassword2" class="form-control" autocomplete="off" />
							<span class="form-control-feedback glyphicon glyphicon-password"></span>
							<div id="inputNewPassword2Msg"></div>
						</div>
					</div>
				</div>
				<div class="col-sm-4">
					<div class="form-group">
						<label class="control-label">{$LANG.pwstrength}</label>
						{include file="$template/includes/pwstrength.tpl"}
					</div>
				</div>
			</div>
			<div class="row">
				<div class="col-sm-12">
					<div class="clearfix"></div>
					<div class="form-group">
						<input class="button03 mt-0" type="submit" name="submit" value="{$LANG.clientareasavechanges}" />
						<input class="cancel-btns" type="reset" value="{$LANG.cancel}" />
					</div>
				</div>
			</div>
		</form>
	</div>
</div>
<script>
jQuery(document).ready(function(){
	jQuery("#inputNewPassword2").keyup(function() {
		var password11 = jQuery("#inputNewPassword1").val();
		var password21 = jQuery(this).val();
		if(password11 == password21){
			setTimeout(function(){
				jQuery('.button03.mt-0').removeAttr('disabled');
				jQuery('.main-content input[type="submit"]').attr('disabled',false);
			}, 1000);
		}
	});
});
</script>