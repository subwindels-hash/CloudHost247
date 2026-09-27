<div class="hostx-container-psw">
	<div class="col-sm-12">
		<p>{$LANG.pwresetsecurityquestionrequired}</p>
		<form method="post" action="{routePath('password-reset-security-verify')}"  class="form-stacked">
			<div class="row">
				<div class="col-sm-6">
					<div class="form-group">
						<label for="inputAnswer">{$securityQuestion}</label>
						<input type="text" name="answer" class="form-control" id="inputAnswer" autofocus>
					</div>
				</div>
			</div>
			<div class="row">
				<div class="col-sm-5">
					<div class="clearfix"></div>
						<div class="form-group">
							<button type="submit" class="btn button03 mt-0">{$LANG.pwresetsubmit}</button>
						</div>
					</div>
				</div>
			</div>
		</form>
	</div>
</div>