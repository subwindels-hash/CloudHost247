<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Traits;



use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting;

/**
 * HostingComponent trait
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait HostingComponent
{
    /**
     * @var Hosting $hosting
     */
    protected $hosting = null;

    public function initHosting($id)
    {
        $this->hosting = Hosting::where('id', $id)->first();
    }

}
