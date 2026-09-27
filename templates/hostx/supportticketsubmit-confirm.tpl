<div class="confirm_ticket_page">
    <div class="shared-hosting">
        <div class="row">
            <div class="col-sm-10 text-center ticket-completed">
                {*<div class="alert alert-success text-center">
                <strong>
                {$LANG.supportticketsticketcreated}
                <a id="ticket-number" href="viewticket.php?tid={$tid}&amp;c={$c}" class="alert-link">#{$tid}</a>
                </strong>
                </div>
                <br />*}
                <div class="row">
                    <div class="col-xs-12">
                        <p><img src="{$WEB_ROOT}/templates/{$template}/images/ticket_submit.png"></p>
                        <p>
                            <strong>
                                {$LANG.supportticketsticketcreated}
                                <a id="ticket-number" href="viewticket.php?tid={$tid}&amp;c={$c}" class="alert-link">#{$tid}</a>
                            </strong>
                        </p>
                    </div>
                    <div class="col-xs-12">
                        <p>{$LANG.supportticketsticketcreateddesc}</p>
                    </div>
                </div>
                <br />
                <p class="text-center">
                    <a href="viewticket.php?tid={$tid}&amp;c={$c}" class="btn btn-default wgs-submit-button">
                        {$LANG.continue}
                        <i class="fas fa-arrow-circle-right"></i>
                    </a>
                </p>
            </div>
        </div>
    </div>
</div>
