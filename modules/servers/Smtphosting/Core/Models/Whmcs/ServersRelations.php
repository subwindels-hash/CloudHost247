<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use Illuminate\Database\Eloquent\model as EloquentModel;

/**
 * Description of ServersRelations
 *
 * @author Mateusz Pawłowski <mateusz.pa@moduelsgarden.com>
 *
 * @property int $groupid
 * @property int $serverid
 */
class ServersRelations extends EloquentModel
{

    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblservergroupsrel';

    /**
     * Indicates if the model should be timestamped.
     *
     * @var bool
     */
    public $timestamps = false;

    public function servers()
    {
        return $this->hasOne(Servers::class, 'id', 'serverid');
    }

    public function group()
    {
        return $this->hasOne(ServersGroups::class, 'id', 'serverid');
    }

}
