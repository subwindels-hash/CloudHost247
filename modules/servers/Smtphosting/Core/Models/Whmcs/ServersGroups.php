<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use Illuminate\Database\Eloquent\model as EloquentModel;

/**
 * Description of ServersGroups
 *
 * @author Mateusz Pawłowski <mateusz.pa@moduelsgarden.com>
 *s
 * @property int $id
 * @property string $name
 * @property int $filltype
 */
class ServersGroups extends EloquentModel
{

    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblservergroups';

    /**
     * Indicates if the model should be timestamped.
     *
     * @var bool
     */
    public $timestamps = false;

}
