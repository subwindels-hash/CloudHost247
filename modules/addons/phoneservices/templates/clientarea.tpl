{* -------------------------------------------------------------------------
   Phone Services - client area shell (Smarty)

   Variables provided by \PhoneServices\Core\Module::renderClientArea():
     $content    pre-rendered page HTML (already escaped by the page template)
     $action     active page slug
     $toggles    [service => bool] dynamic service switches
     $modulelink base URL for the addon
   ------------------------------------------------------------------------- *}

<div class="phoneservices-client-wrapper">

    <nav class="phoneservices-sidebar" aria-label="Phone Services navigation">
        <ul class="nav nav-pills nav-stacked">
            <li class="{if $action eq 'dashboard'}active{/if}">
                <a href="{$modulelink}"><i class="fas fa-tachometer-alt"></i> Dashboard</a>
            </li>
            {if $toggles.numbers}
                <li class="{if $action eq 'numbers'}active{/if}">
                    <a href="{$modulelink}&amp;action=numbers"><i class="fas fa-phone"></i> My numbers</a>
                </li>
            {/if}
            {if $toggles.voip}
                <li class="{if $action eq 'voip'}active{/if}">
                    <a href="{$modulelink}&amp;action=voip"><i class="fas fa-microphone"></i> VoIP calling</a>
                </li>
            {/if}
            {if $toggles.sms}
                <li class="{if $action eq 'sms'}active{/if}">
                    <a href="{$modulelink}&amp;action=sms"><i class="fas fa-comment-dots"></i> SMS &amp; messaging</a>
                </li>
            {/if}
            {if $toggles.esim}
                <li class="{if $action eq 'esim'}active{/if}">
                    <a href="{$modulelink}&amp;action=esim"><i class="fas fa-sim-card"></i> eSIM &amp; data</a>
                </li>
            {/if}
            {if $toggles.analytics}
                <li class="{if $action eq 'usage'}active{/if}">
                    <a href="{$modulelink}&amp;action=usage"><i class="fas fa-chart-line"></i> Usage &amp; billing</a>
                </li>
            {/if}
        </ul>
    </nav>

    <main class="phoneservices-content">
        {$content nofilter}
    </main>
</div>
