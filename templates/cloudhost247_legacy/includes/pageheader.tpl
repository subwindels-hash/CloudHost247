{if $templatefile != 'clientareahome'}
<div class="top"> 
	<div class="innerDashTitle">
		<h2>{$title}{if $desc}, <span>{$desc} </span>{/if}</h2>
	</div>
 	{if $showbreadcrumb}{include file="$template/includes/breadcrumb.tpl"}{/if}	 
</div>
{/if}
