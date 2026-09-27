$(document).ready(function () {
    let currentModule = document.getElementById('inputServerType');
    if (currentModule && currentModule.value === 'AmazonLightsail')
    {
        $('input[name=username]').first().parents('tr').first().children('.fieldlabel').first().html('Access Key ID');
        $('input[name=password]').first().parents('tr').first().children('.fieldlabel').first().html('Secret Access Key');
    }
});
