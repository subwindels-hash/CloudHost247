<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements;

/**
 * Description of Handler
 *
 * @author INBSX-37H
 */
abstract class Handler
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;

    protected $unfulfilledRequirements = [];

    protected function addUnfulfilledRequirement($message = null, $params = [])
    {
        if ($message)
        {
            $this->loadLang();
            $translated = $this->lang->absoluteTranslate('unfulfilledRequirement', $message);
            foreach ($params as $searchKey => $searchValue)
            {
                $translated = str_replace(':' . (string)$searchKey . ':', (string)$searchValue, $translated);
            }

            $this->unfulfilledRequirements[] = $translated;
        }
    }

    public function getUnfulfilledRequirements()
    {
        return $this->unfulfilledRequirements;
    }
}
