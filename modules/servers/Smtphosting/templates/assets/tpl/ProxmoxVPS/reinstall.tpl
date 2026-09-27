{if $message['message']}
    <div class="alert alert-success text-center">
        {$message['message']}
    </div>
{/if}

{if $response['warning']}
    <div class="alert alert-warning text-center">
        {$response['warning']}
    </div>
{elseif $response}
    {foreach from=$response item=items key=type}
        <table class="table table-bordered table-striped table-rounded">
            <tr>
                <th style="width: 90%">
                    {($type == 'osTemplates') ? {$MGLANG->T('ProxmoxVPS', 'osTemplates')} : {$MGLANG->T('ProxmoxVPS', 'isoImages')}}
                </th>
                <th>Reinstall</th>
            </tr>
            {foreach from=$items item=item}
                <tr>
                    <td>{$item['name']}</td>
                    <td>
                        <button data-id="{$item['id']}"
                                type="button" class="open-AddBookDialog btn btn-primary"
                                data-toggle="modal" data-target="{($type == 'osTemplates') ? '#ModalCenterPassword' : '#ModalCenterSimple'}">
                            Reinstall
                        </button>
                    </td>
                </tr>
            {/foreach}
        </table>
    {/foreach}
{/if}

<!-- Modal Password-->
<div class="modal fade" id="ModalCenterPassword" tabindex="-1" role="dialog" aria-labelledby="exampleModalCenterTitle"
     aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="exampleModalLongTitle">Reinstall Server</h5>
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
            <div class="modal-body">
                <div class="alert alert-danger" role="alert">
                    Are you sure that you want to reinstall the server?
                </div>
                <div class="form-group">
                    <form id="form-with-pass" action="clientarea.php?action=productdetails&modop=custom&a=reinstall"
                          method="POST">
                        <input type="hidden" name="id" value="{$params.serviceid}"/>
                        <input type="hidden" name="volid" id="volid-template">
                        <label id="password-label" for="password">Password</label>
                        <input type="text" name="password" id="password" class="form-control mt-1" required>
                        <div id="error" class="invalid-feedback"></div>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary submit">Confirm</button>
            </div>
        </div>
    </div>
</div>

<!-- Modal Simple -->
<div class="modal fade" id="ModalCenterSimple" tabindex="-1" role="dialog" aria-labelledby="exampleModalCenterTitle"
     aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="exampleModalLongTitle">Install ISO Image</h5>
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
            <div class="modal-body">
                <div class="alert alert-danger" role="alert">
                    Are you sure that you want to install the ISO image? If you proceed, all data located on the virtual machine will be lost.
                </div>
                <div class="form-group">
                    <form id="form" action="clientarea.php?action=productdetails&modop=custom&a=reinstall"
                          method="POST">
                        <input type="hidden" name="id" value="{$params.serviceid}"/>
                        <input type="hidden" name="volid" id="volid">
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>
                <button onclick="document.getElementById('form').submit()" type="button" class="btn btn-primary">Confirm</button>
            </div>
        </div>
    </div>
</div>

{literal}
    <script>
        $(document).on("click", ".open-AddBookDialog", function () {
            let id = $(this).data("id");
            $("#volid").val(id);
            $("#volid-template").val(id);
        });

        $(document).on("click", ".submit", function () {
            let error = $("#error");
            let password = $("#password");

            error.empty();

            if ($("#password").length === 1 && !password.val().match(/^(?=.*[0-9])[a-zA-Z0-9!@#$%^&*]{8,}$/)) {
                password.removeClass("is-valid");
                password.addClass("is-invalid");
                error.append("The password must contain at least 8 characters and one number!");
            } else {
                password.removeClass("is-invalid");
                password.addClass("is-valid");
                $("#form-with-pass").submit();
            }
        });
    </script>
{/literal}