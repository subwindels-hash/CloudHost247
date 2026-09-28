<form action="#" id="frmGeneratePassword" class="form-horizontal">
    <div class="modal fade" id="modalGeneratePassword">
        <div class="modal-dialog">
            <div class="modal-content panel-primary">
                <div class="modal-header panel-heading">
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                    <h4 class="modal-title">
                        {$LANG.generatePassword.title}
                    </h4>
                </div>
                <div class="modal-body cst-genrate-pass">
                    <div class="alert alert-danger hidden" id="generatePwLengthError">
                        {$LANG.generatePassword.lengthValidationError}
                    </div>
                    <div class="form-group">
                      <div class="col-sm-12">
					  <label class="control-label">{$LANG.generatePassword.pwLength}</label>
                            <input type="number" min="8" max="64" value="12" step="1" class="form-control input-inline input-inline-100 p-inp" id="inputGeneratePasswordLength">
                        </div>
                    </div>
                    <div class="form-group">
                      <div class="col-sm-12">
					  <label class="control-label">{$LANG.generatePassword.generatedPw}</label>
                       <input type="text" class="form-control p-inp" id="inputGeneratePasswordOutput">
                        </div>
                    </div>
					
                    <div class="row">
                        <div class="col-sm-12">
                            <button type="submit" class="btn btn-default btn-sm wgs-submit-button s">
                                <i class="fas fa-plus fa-fw"></i>
                                {$LANG.generatePassword.generateNew}
                            </button>
                            <button type="button" class="btn btn-default btn-sm copy-to-clipboard " data-clipboard-target="#inputGeneratePasswordOutput">
                                <img src="{$WEB_ROOT}/assets/img/clippy.svg" alt="Copy to clipboard" width="15">
                                {$LANG.copy}
                            </button>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-default btn-c" data-dismiss="modal">
                        {$LANG.close}
                    </button>
                    <button type="button" class="btn btn-primary" id="btnGeneratePasswordInsert" data-clipboard-target="#inputGeneratePasswordOutput">
                        {$LANG.generatePassword.copyAndInsert}
                    </button>
                </div>
            </div>
        </div>
    </div>
</form>
