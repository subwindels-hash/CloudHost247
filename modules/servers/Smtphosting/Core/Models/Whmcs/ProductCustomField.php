<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

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
     * @param $name
     * @param $fieldname
     * @param $fieldtype
     * @param $description
     * @param $fieldoptions
     * @param $regexpr
     * @param $adminonly
     * @param $required
     * @param $showorder
     * @param $showinvoice
     * @param $sortorder
     */
    public function __construct($id, $fieldname, $fieldtype = 'text', $adminonly = "on", $regexpr = "", $required = "", $description = "", $fieldoptions = "", $showorder = "", $showinvoice = "", $sortorder = 0)
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
     * @param $id
     * @param array $customFields
     * @return array ProductCustomField
     */
    public static function addIfNotExist($id, array $customFields)
    {
        $enteries = [];
        foreach ($customFields as $customField)
        {
            $field      = new ProductCustomField($id, $customField['fieldname'], $customField['fieldtype'], $customField['adminonly']);
            $enteries[] = $field;
            if (!$field->exist())
            {
                $field->create();
            }
        }
        return $enteries;
    }

    public function exist()
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