<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\AddonController;

/**
 * Class MetaData
 *
 * @author <slawomir@modulesgarden.com>
 */
class MetaData extends AddonController
{
    public function execute($params = null)
    {
        return [
            'DisplayName'    => 'Smtphosting',
            'RequiresServer' => true
        ];
    }
}
