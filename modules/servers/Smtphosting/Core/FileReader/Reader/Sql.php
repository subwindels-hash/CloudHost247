<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

/**
 * Description of Sql
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Sql extends AbstractType
{

    protected function loadFile()
    {
        $return = '';
        try
        {
            if (file_exists($this->path . DS . $this->file))
            {
                $collation = $this->getWHMCSTablesCollation();
                $charset   = $this->getWHMCSTablesCharset();
                $return    = file_get_contents($this->path . DS . $this->file);
                $return    = str_replace("#collation#", $collation, $return);
                $return    = str_replace("#charset#", $charset, $return);
                $return    = str_replace("#prefix#", ModuleConstants::getPrefixDataBase(), $return);
                foreach ($this->renderData as $key => $value)
                {
                    $return = str_replace("#$key#", $value, $return);
                }
            }
        }
        catch (\Exception $e)
        {
            ServiceLocator::call('errorManager')->addError(self::class, $e->getMessage(), $e->getTrace());
        }

        $this->data = $return;
    }

    protected function getWHMCSTablesCollation()
    {
        $pdo   = \Illuminate\Database\Capsule\Manager::connection()->getPdo();
        $query = $pdo->prepare("SHOW TABLE STATUS WHERE name = 'tblclients'");
        $query->execute();
        $result = $query->fetchObject();

        return $result->Collation;
    }

    protected function getWHMCSTablesCharset()
    {
        require ROOTDIR . DS . 'configuration.php';

        $pdo = \Illuminate\Database\Capsule\Manager::connection()->getPdo();

        $query = $pdo->prepare("SELECT CCSA.character_set_name as Charset FROM information_schema.`TABLES` T,
            information_schema.`COLLATION_CHARACTER_SET_APPLICABILITY` CCSA
            WHERE CCSA.collation_name = T.table_collation
            AND T.table_schema = :db_name
            AND T.table_name = 'tblclients';");

        $query->execute(['db_name' => $db_name]);
        $result = $query->fetchObject();

        return $result->Charset;
    }
}
