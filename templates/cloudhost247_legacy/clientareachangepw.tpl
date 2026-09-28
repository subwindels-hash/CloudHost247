<div class="client_change_password_page">
	<div class="shared-hosting">
{if $successful}
    {include file="$template/includes/alert.tpl" type="success" msg=$LANG.changessavedsuccessfully textcenter=true}
{/if}
{if $errormessage}
    {include file="$template/includes/alert.tpl" type="error" errorshtml=$errormessage}
{/if}
		<form class="form-horizontal using-password-strength" method="post" action="clientarea.php?action=changepw" role="form">
			<input type="hidden" name="submit" value="true" />
			<div class="row">
				<div class="col-sm-8">
					<div class="form-group">
						<label for="inputExistingPassword">{$LANG.existingpassword}</label>
						<input type="password" class="form-control" name="existingpw" id="inputExistingPassword" autocomplete="off" />
						
					</div>
				</div>
				<div class="col-sm-8">
						<div class="form-group">
							<div id="newPassword1" class="has-feedback">
								<label for="inputNewPassword1">{$LANG.newpassword}</label>
									<input type="password" class="form-control" name="newpw" id="inputNewPassword1" autocomplete="off" />
									<span class="form-control-feedback glyphicon"></span>
									{include file="$template/includes/pwstrength.tpl"}
							</div>
						</div>
				</div>
				<div class="col-sm-4">
					<button type="button" class="btn btn-default generate-password wgs-button-gen-pwd" data-targetfields="inputNewPassword1,inputNewPassword2">
						{$LANG.generatePassword.btnLabel}
					</button>
				</div>
				<div class="col-sm-8">
					<div class="form-group">
						<div id="newPassword2" class="has-feedback">
							<label for="inputNewPassword2">{$LANG.confirmnewpassword}</label>
								<input type="password" class="form-control" name="confirmpw" id="inputNewPassword2" autocomplete="off" />
								<span class="form-control-feedback glyphicon"></span>
								<div id="inputNewPassword2Msg"></div>
						</div>
					</div>
				</div>
			</div>
			<div class="row chpwv8">
				<div class="col-sm-12">
						<input class="btn btn-primary wgs-submit-button" type="submit" value="{$LANG.clientareasavechanges}" />
						<input class="btn btn-default wgs-cancel-button" type="reset" value="{$LANG.cancel}" />
				</div>
			</div>
		</form>
	</div>
</div>
