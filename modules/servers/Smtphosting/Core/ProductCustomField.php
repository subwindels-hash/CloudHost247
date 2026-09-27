<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core;

use Illuminate\Database\Capsule\Manager as DB;

class ProductCustomField
{
    const  TYPE = "product";
    protected $id;
    protected $name;
    protected $fieldname;
    protected $fieldtype;
    protected $description;
    protected $fieldoptions;
    protected $regexpr;
    protected $adminonly;
    protected $required;
    protected $showorder;
    protected $showinvoice;
    protected $sortorder;

    /**
     * ProductCustomField constructor.
     * @param int $id
     * @param string $fieldname
     * @param string $fieldtype
     * @param string $adminonly
     * @param string $regexpr
     * @param $required
     * @param string $description
     * @param $fieldoptions
     * @param $showorder
     * @param $showinvoice
     * @param int $sortorder
     */
    public function __construct(int $id, string $fieldname, string $fieldtype = 'text', string $adminonly = "on", string $regexpr = "", $required = "", $description = "", $fieldoptions = "", $showorder = "on", $showinvoice = "", $sortorder = 0)
    {
        $this->id        = $id;
        $this->fieldname = $fieldname;
        if (preg_match("/\|/", $this->fieldname))
        {
            $ex         = explode("|", $this->fieldname);
            $this->name = $ex[0];
        }
        else
        {
            $this->name = $fieldname;
        }
        $this->fieldtype    = $fieldtype;
        $this->description  = $description;
        $this->fieldoptions = $fieldoptions;
        $this->regexpr      = $regexpr;
        $this->adminonly    = $adminonly;
        $this->required     = $required;
        $this->showorder    = $showorder;
        $this->showinvoice  = $showinvoice;
        $this->sortorder    = $sortorder;
    }


    /**
     * @param int $id
     * @param array $customFields
     * @return array ProductCustomField
     */
    public static function addIfNotExist(int $id, array $customFields)
    {
        $entries = [];
        foreach ($customFields as $customField)
        {
            $field     = new ProductCustomField(
                $id,
                $customField['fieldname'],
                $customField['fieldtype'],
                $customField['adminonly'],
                $customField['regexpr'] ?: '',
                $customField['required'] ?: '',
                $customField['description'] ?: '',
                $customField['fieldoptions'] ?: '',
                $customField['showorder'] ?: '',
                $customField['showinvoice'] ?: ''
            );
            $entries[] = $field;
            if (!$field->exist())
            {
                $field->create();
            }
        }
        return $entries;
    }

    public function exist(): bool
    {
        return DB::table("tblcustomfields")
                   ->where("relid", $this->id)
                   ->where("type", self::TYPE)
                   ->where("fieldname", "LIKE", $this->name . "%")
                   ->count() > 0;
    }

    public function create()
    {
        return DB::table("tblcustomfields")
            ->insert([
                "type"         => self::TYPE,
                "relid"        => $this->id,
                "fieldname"    => $this->fieldname,
                "fieldtype"    => $this->fieldtype,
                "description"  => $this->description,
                "fieldoptions" => $this->fieldoptions,
                "regexpr"      => $this->regexpr,
                "adminonly"    => $this->adminonly,
                "required"     => $this->required,
                "showorder"    => $this->showorder,
                "showinvoice"  => $this->showinvoice,
                "sortorder"    => $this->sortorder,
            ]);

    }


}
