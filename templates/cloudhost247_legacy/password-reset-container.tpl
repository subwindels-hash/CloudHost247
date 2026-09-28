{if $loggedin && $innerTemplate}
	{include file="$template/includes/alert.tpl" type="error" msg=$LANG.noPasswordResetWhenLoggedIn textcenter=true}
{else}
	{if $successMessage}
		<div class="cloudhost247-container-messages">
			<div class="col-sm-10">
				{include file="$template/includes/alert.tpl" type="success" msg=$successTitle textcenter=true}
				<p>{$successMessage}</p>
			</div>
		</div>
	{else}
		{if $errorMessage}
			<div class="cloudhost247-container-messages">
				<div class="col-sm-10">
				{include file="$template/includes/alert.tpl" type="error" msg=$errorMessage textcenter=true}
				</div>
			</div>
		{/if}

		{if $innerTemplate}
			{include file="$template/password-reset-$innerTemplate.tpl"}
		{/if}
	{/if}
{/if}
</div>
</div>
