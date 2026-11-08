{* The old dismiss-only cookieconsent banner was replaced by the shared category preference
   centre in marketing.tpl on every page. The unrelated offer popup remains unchanged. *}
{if isset($cloudhost247.offers) && $cloudhost247.offers}
<div class="modal fade" id="cloudhost247Offer" tabindex="-1" role="dialog" aria-hidden="true">
 <div class="modal-dialog modal-lg" role="document"><div class="modal-content">
  <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
  {$cloudhost247.offers}
 </div></div>
</div>
{/if}
