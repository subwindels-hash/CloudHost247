<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

/**
 * Description of Clients
 *
 * @author Mateusz Pawłowski <mateusz.pa@moduelsgarden.com>
 */

use \Illuminate\Database\Eloquent\Model;

/**
 * @property int $id
 * @property int $userid
 * @property int $serviceid
 * @property int $addon_id
 * @property string $remoteid
 * @property string $module
 * @property string $certtype
 * @property string $configdata
 * @property string $completiondate
 * @property string $status
 */
class SslOrders extends Model
{

    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblsslorders';

    /**
     * Indicates if the model should be timestamped.
     *
     * @var bool
     */
    public $timestamps = false;

}
