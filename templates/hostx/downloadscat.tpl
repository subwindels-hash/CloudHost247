<div class="client_download_page">
	<div class="shared-hosting">
		<form role="form" method="post" action="{routePath('download-search')}">
			<div class="download_searchbar">
				<label class="input-group input-group-lg kb-search">
					<input type="text" name="search" id="inputDownloadsSearch" class="form-control" placeholder="{$LANG.downloadssearch}" value="{$search}" />
					<input type="submit" id="btnDownloadsSearch" class="btn btn-primary btn-input-padded-responsive" value="{$LANG.search}" />
				</label>
			</div>
		</form>
		<p>{$LANG.downloadsintrotext}</p>
		{if $dlcats}
			<h2>{$LANG.knowledgebasecategories}</h2>
			<div class="download-categories">
				{foreach $dlcats as $dlcat}
					<div class="col-sm-4 down-cat">
						<a href="{routePath('download-by-cat', $dlcat.id, $dlcat.urlfriendlyname)}">
							<i class="far fa-folder-open"></i>
							<strong>{$dlcat.name}</strong>
						</a>
						({$dlcat.numarticles})
						<br>
						{$dlcat.description}
					</div>
				{foreachelse}
					<div class="col-sm-12">
						<p class="text-center fontsize3">{$LANG.downloadsnone}</p>
					</div>
				{/foreach}
			</div>
		{/if}
		<h2>{$LANG.downloadsfiles}</h2>
		<div class="download-popular-wgs">
			{foreach $downloads as $download}
				<div class="download-box-div">
					<i class="far fa-file-alt"></i>
					<h4>{$download.title}</h4>
					{if $download.clientsonly}
						<i class="fas fa-lock text-muted"></i>
					{/if}
					<p>
						{$download.description}
					</p>
					<div class="downloads-link-wgs">
						<ul>
							<li>
								<a href="{$download.link}" class="list-group-item">
								<i class="fas fa-download"></i>	{$download.title} &nbsp; <small>{$LANG.downloadsfilesize}: {$download.filesize}</small>
								</a>
							</li>
						</ul>
					</div>
				</div>
			{foreachelse}
				<div class="download-box-div">
					<span class="text-center">
						{$LANG.downloadsnone}
					</span>
				</div>
			{/foreach}
		</div>
	</div>
</div>
