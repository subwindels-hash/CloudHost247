{*{if $errormessage}*}
{*    <h1>{$errormessage}</h1>*}
{*    {include file="$template/includes/alert.tpl" type="error" errorshtml=$errormessage}*}
{*{/if}*}

{*<h3>{$MGLANG->T('reissueTwoTitle')}</h3>*}
{*<p>{$MGLANG->T('reissueTwoSubTitle')}</p>*}

{*{assign var=val value=0}*}`

<script type="text/javascript">
    $(document).ready(function () {
        //var fillVars = JSON.parse('{$fillVars}');
        var brand = JSON.parse('{$brand}');
        var onlyEmailValidationFoBrands = ['geotrust', 'thawte', 'rapidssl', 'symantec'];
        var disabledValidationMethods = JSON.parse('{$disabledValidationMethods}');

        /*var mainDomainDcvMethod = '';
         for (var i = 0; i < fillVars.length; i++) {
         if(fillVars[i].name === "fields[dcv_method]") {
         mainDomainDcvMethod = fillVars[i].value;
         }
         }*/
        function getSelectHtml(value, checked)
        {
            if (checked)
            {
                var ck = ' selected';
            } else
            {
                var ck = '';
            }
            return '<option value="' + value + '"' + ck + '>' + value + '</option>'
        }

        function getRowHtml(title, methods, emails)
        {
            return '<tr><td>' + title + '</td><td>' + methods + '</td><td>' + emails + '</td></tr>';
        }

        function getNameForSelectMethod(x, domain)
        {
            if (x === 0)
            {
                return 'name="dcvmethodMainDomain"';
            }
            domain = domain.replace("*", "___");
            return 'name="dcvmethod[' + domain + ']"';
        }

        function getNameForSelectEmail(x, domain)
        {
            if (x === 0)
            {
                return 'name="approveremail"';
            }
            domain = domain.replace("*", "___");
            return 'name="approveremails[' + domain + ']"';
        }

        function getTable(tableBegin, tableEnd, body)
        {
            return tableBegin + body + tableEnd;
        }

        function ValidateIPaddress(ipaddress)
        {
            if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress))
            {
                return true;
            }
            return false;
        }

        function replaceRadioInputs(approvalEmails)
        {
            var template = $('input[value="loading..."]').closest('.row'), selectEmailHtml = '', fullHtml = '',
                partHtml = '',
                tableBegin = '<div class="col-sm-10 col-sm-offset-1"><table id="selectDcvMethodsTable" class="table"><thead><tr><th>' + '{$MGLANG->T('SSLCENTERWHMCS', 'stepTwoTableLabelDomain')}' + '</th><th>' + '{$MGLANG->T('SSLCENTERWHMCS', 'stepTwoTableLabelDcvMethod')}' + '</th><th>' + '{$MGLANG->T('SSLCENTERWHMCS', 'stepTwoTableLabelEmail')}' + '</th></tr></thead>',
                tableEnd = '</table></div>', selectDcvMethod = '',
                selectBegin = '<div class="form-group"><select style="width:80%;" type="text" name="selectName" class="form-control">',
                selectEnd = '</select></div>', x = 0;

            //for template control
            if (template.find('.panel').length > 0)
            {
                template = $('input[value="loading..."]').closest('.panel-body').find('div');
            }

            template.hide();
            $('input[value="loading..."]').remove();

            $.each(approvalEmails, function (domain, emails) {
                selectDcvMethod = '<div class="form-group"><select style="width:100%;" type="text" name="selectName" class="form-control">';
                approvalMethods = JSON.parse('{$approvalMethods}');
                $.each(approvalMethods, function (key, method) {
                    if (jQuery.inArray(method.toLowerCase(), disabledValidationMethods) < 0)
                    {
                        lang = 'dropdownDcvMethod' + method;
                        selectDcvMethod += '<option value="' + method.toUpperCase() + '">' + method + '</option>';
                    }
                });

                selectDcvMethod += '</select>';

                partHtml = partHtml + selectDcvMethod.replace('name="selectName"', getNameForSelectMethod(x, domain));
                selectEmailHtml = selectBegin.replace('name="selectName"', getNameForSelectEmail(x, domain));

                if (jQuery.inArray('email', disabledValidationMethods) >= 0 && jQuery.inArray(brand, onlyEmailValidationFoBrands) < 0)
                {
                    selectEmailHtml = selectEmailHtml.replace(getNameForSelectEmail(x, domain) + ' class="form-control"', getNameForSelectEmail(x, domain) + ' class="form-control hidden"');
                }


                for (var i = 0; i < emails.length; i++)
                {
                    selectEmailHtml = selectEmailHtml + getSelectHtml(emails[i], i === 0);
                }
                selectEmailHtml = selectEmailHtml + selectEnd;
                fullHtml = fullHtml + getRowHtml(domain, partHtml, selectEmailHtml);

                partHtml = '';
                x++;
            });
            template.before(getTable(tableBegin, tableEnd, fullHtml));
            template.remove();
        }

        replaceRadioInputs(JSON.parse('{$approvalEmails}'));


        $('select[name^="dcvmethod"]').change(function () {

            var product144 = $('select[name="approveremail"] option').length;

            var method = this.value;
            var selectName = this.name;
            var domain = selectName.replace('dcvmethod', '');
            if (domain === 'MainDomain')
            {
                if (method !== 'EMAIL')
                {

                    if (product144 <= 0)
                    {
                        $('select[name="approveremail"]').append('<option value="defaultemail@defaultemail.com"></option>');
                        $('select[name="approveremail"] option[value="defaultemail@defaultemail.com"]').attr("selected", "selected");
                    }

                    $('select[name="approveremail"]').addClass('hidden');
                } else
                {
                    $('select[name="approveremail"]').removeClass('hidden');
                }
            } else
            {
                if (method !== 'EMAIL')
                {

                    if (product144 <= 0)
                    {
                        $('select[name="approveremail"]').append('<option value="defaultemail@defaultemail.com"></option>');
                        $('select[name="approveremail"] option[value="defaultemail@defaultemail.com"]').attr("selected", "selected");
                    }
                    $('select[name="approveremails' + domain + '"]').addClass('hidden');
                } else
                {
                    $('select[name="approveremails' + domain + '"]').removeClass('hidden');
                }
            }
        });
        $('select[name^="dcvmethod"]').change();
        if (jQuery.inArray(brand, onlyEmailValidationFoBrands) >= 0)
        {
            $('select[name^="approveremails"]').closest('tr').prop('hidden', true);
        }

        if (jQuery.inArray('email', disabledValidationMethods) >= 0 && jQuery.inArray(brand, onlyEmailValidationFoBrands) < 0)
        {
            $('#selectDcvMethodsTable').find('th:eq(2)').text('');
            $('#selectDcvMethodsTable').closest('.row').parent().find('h3:first').text('{$MGLANG->T('SSLCENTERWHMCS', 'reissueSelectVerificationMethodTitle')}');
            $('#selectDcvMethodsTable').closest('.row').parent().find('p:first').text('{$MGLANG->T('SSLCENTERWHMCS', 'reissueSelectVerificationMethodDescription')}');
        }
    });
</script>
