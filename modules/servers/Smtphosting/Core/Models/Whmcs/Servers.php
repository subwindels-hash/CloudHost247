<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;


use Illuminate\Database\Eloquent\model as EloquentModel;

/**
 * Description of Servers
 *
 * @author Mateusz Pawłowski <mateusz.pa@moduelsgarden.com>
 *
 *
 * /**
 * @property int $id
 * @property string $name
 * @property string $ipaddress
 * @property string $assignedips
 * @property string $hostname
 * @property float $monthlycost
 * @property string $noc
 * @property string $statusaddress
 * @property string $nameserver1
 * @property string $nameserver1ip
 * @property string $nameserver2
 * @property string $nameserver2ip
 * @property string $nameserver3
 * @property string $nameserver3ip
 * @property string $nameserver4
 * @property string $nameserver4ip
 * @property string $nameserver5
 * @property string $nameserver5ip
 * @property int $maxaccounts
 * @property string $type
 * @property string $username
 * @property string $password
 * @property string $accesshash
 * @property string $secure
 * @property int $port
 * @property int $active
 * @property int $disabled
 */
class Servers extends EloquentModel
{

    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblservers';

    /**
     * Indicates if the model should be timestamped.
     *
     * @var bool
     */
    public $timestamps = false;

}
