<div class="open_ticket">
	<div class="shared-hosting">
		{if $errormessage}
			<div class="row">
				<div class="col-sm-12">
						{include file="$template/includes/alert.tpl" type="error" errorshtml=$errormessage}
				</div>
			</div>
		{/if}
		<form method="post" action="{$smarty.server.PHP_SELF}?step=3" enctype="multipart/form-data" role="form">
			<div class="row">
				<div class="col-sm-4">
					<div class="form-group">
						<label for="inputName">{$LANG.supportticketsclientname}</label>
						<input type="text" name="name" id="inputName" value="{$name}" class="form-control{if $loggedin} disabled{/if}"{if $loggedin} disabled="disabled"{/if} />
					</div>
				</div>
				<div class="col-sm-4">
					<div class="form-group">
						<label for="inputEmail">{$LANG.supportticketsclientemail}</label>
						<input type="email" name="email" id="inputEmail" value="{$email}" class="form-control{if $loggedin} disabled{/if}"{if $loggedin} disabled="disabled"{/if} />
					</div>
				</div>
				<div class="col-sm-4">
					<div class="form-group">
						<label for="inputSubject">{$LANG.supportticketsticketsubject}</label>
						<input type="text" name="subject" id="inputSubject" value="{$subject}" class="form-control" />
					</div>
				</div>
				<div class="col-sm-4">
					<div class="form-group">
						<label for="inputDepartment">{$LANG.supportticketsdepartment}</label>
						<select name="deptid" id="inputDepartment" class="form-control" onchange="refreshCustomFields(this)">
							{foreach from=$departments item=department}
								<option value="{$department.id}"{if $department.id eq $deptid} selected="selected"{/if}>
									{$department.name}
								</option>
							{/foreach}
						</select>
					</div>
				</div>
				{if $relatedservices}
					<div class="col-sm-4">
						<div class="form-group">
							<label for="inputRelatedService">{$LANG.relatedservice}</label>
							<select name="relatedservice" id="inputRelatedService" class="form-control">
								<option value="">{$LANG.none}</option>
								{foreach from=$relatedservices item=relatedservice}
									<option value="{$relatedservice.id}" {if $relatedservice.id eq $selectedservice} selected="selected"{/if}>
										{$relatedservice.name} ({$relatedservice.status})
									</option>
								{/foreach}
							</select>
						</div>
					</div>
				{/if}
				<div class="col-sm-4">
					<div class="form-group">
						<label for="inputPriority">{$LANG.supportticketspriority}</label>
						<select name="urgency" id="inputPriority" class="form-control">
							<option value="High"{if $urgency eq "High"} selected="selected"{/if}>
								{$LANG.supportticketsticketurgencyhigh}
							</option>
							<option value="Medium"{if $urgency eq "Medium" || !$urgency} selected="selected"{/if}>
								{$LANG.supportticketsticketurgencymedium}
							</option>
							<option value="Low"{if $urgency eq "Low"} selected="selected"{/if}>
								{$LANG.supportticketsticketurgencylow}
							</option>
						</select>					
					</div>
				</div>

				<div class="col-sm-12">
					<div class="form-group">
						<label for="inputMessage">{$LANG.contactmessage}</label>
						<textarea name="message" id="inputMessage" rows="12" class="form-control markdown-editor" data-auto-save-name="client_ticket_open">{$message}</textarea>
					</div>
				</div>
				<div class="col-sm-9">
					<div class="form-group wgs-margin-bottom">
						<label for="inputAttachments">{$LANG.supportticketsticketattachments}</label>
						


						<!------use div----->
                        <div class="file-upload-box" id="fileUploadBox"> 
                          <div class="up-file-text-img">
                          	<label>{$LANG.supportticketsallowedextensions}: {$allowedfiletypes}</label>
                          </div>
                          <div class="up-file-field">
                           <div class="waves-effect waves-light">
                           <span>Choose file</span>
                           		<input type="file" name="attachments[]" id="inputAttachments" class="form-control" />
                           </div>
                           </div>
                         </div>
                         <!------use div----->



						<div id="fileUploadsContainer"></div>
					</div>
				</div>
				<div class="col-sm-3">					
					<div class="up-r-btn">
					<label> &nbsp; </label>
					<button type="button" class="btn btn-default btn-block" onclick="extraTicketAttachment()">
						<i class="fas fa-plus"></i> {$LANG.addmore}
					</button>
					</div>
				</div>
				<div class="col-sm-12 ticket-attachments-message text-muted">
					<div class="form-group">
						
					</div>
				</div>
				<div class="col-sm-12">
					<div id="customFieldsContainer">
						{include file="$template/supportticketsubmit-customfields.tpl"}
					</div>
				</div>
				<div class="col-sm-12">
					<div id="autoAnswerSuggestions" class="well hidden"></div>
				</div>
				<div class="col-sm-12">
					<div class="text-center margin-bottom wgs-class-captcha">
						{include file="$template/includes/captcha.tpl"}
					</div>
				</div>
				<div class="col-sm-12">
					<p class="text-left wgs-responsive-btn-class">
						<input type="submit" id="openTicketSubmit" value="{$LANG.supportticketsticketsubmit}" class="btn btn-primary disable-on-click{$captcha->getButtonClass($captchaForm)}" />
						<a href="supporttickets.php" class="btn btn-default cancel-btn-wgs">{$LANG.cancel}</a>
					</p>
				</div>
			</div>
		</form>
	</div>
</div>
{if $kbsuggestions}
    <script>
        jQuery(document).ready(function() {
            getTicketSuggestions();
        });
    </script>
{/if}
<script>
jQuery(document).ready(function() {
	jQuery('#inputAttachments').change(function(e){
		var fileName = e.target.files[0].name;
		jQuery(".up-file-text-img label").html(fileName);
	});
});
</script>
