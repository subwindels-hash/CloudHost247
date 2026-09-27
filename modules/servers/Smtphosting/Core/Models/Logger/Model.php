<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Logger;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ExtendedEloquentModel;

/**
 * Description of Model
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Model extends ExtendedEloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'Logger';

    protected $primaryKey = 'id';

    /**
     * Eloquent guarded parameters
     * @var array
     */
    protected $guarded = ['id'];

    /**
     * Eloquent fillable parameters
     * @var array
     */
    protected $fillable = ['id', 'id_ref', 'id_type', 'type', 'level', 'request', 'response', 'before_vars', 'vars', 'date'];

    protected $dates = ['date'];

    /**
     * Indicates if the model should soft delete.
     *
     * @var bool
     */
    protected $softDelete = false;

    /**
     * Indicates if the model should be timestamped.
     *
     * @var bool
     */
    public $timestamps = false;

    /**
     * Just eloquent relation
     *
     * @return object
     */
    public function reference()
    {
        return $this->belongsTo($this->id_type, 'id_ref')->first();
    }

    /**
     * Join reference assigned
     *
     * @return Illuminate\Database\Query\Builder
     */
    public function scopeJoinReference($query)
    {
        return $query->with('reference');
    }
}
