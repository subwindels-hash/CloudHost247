<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Product;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\ServersRelations;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

/**
 * Description of Configuration
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 * @property $resellerProduct int
 * @property string $actionStart
 * @property string $actionStop
 * @property string $actionReboot
 * @property string $actionDetails
 * @property string $actionGraphs
 */
class Configuration
{
    /**
     * @var mixed
     */
    protected $configuration;

    /**
     * Get configuration values and create params
     *
     * @param $params
     * @return Configuration
     */
    public static function create(array $params): Configuration
    {
        if ($params['server'])
        {
            $apiDetails = [
                "username"    => $params['serverusername'],
                "apiKey"      => $params['serverpassword'],
                "apiEndpoint" => $params['serveraccesshash'],
            ];
        }
        else
        {
            $server = self::getServer($params);
            if (!$server)
            {
                throw new \Exception(sl('lang')->T('choseserver'));
            }
            $apiDetails      = [
                "username"    => $server->username,
                "apiKey"      => self::decryptServerPassword($server->password),
                "apiEndpoint" => $server->accesshash,
            ];
            $productSettings = new Repository();
            $apiDetails      = array_merge($apiDetails, $productSettings->getProductSettings($params['id']));
        }

        return new Configuration($apiDetails);
    }

    protected static function getServer(array $params)
    {
        $serverGroupId = Product::find($params['id'])->servergroup;

        $serverGroupModel = new ServersRelations();
        $serverIds        = $serverGroupModel->select('serverid')->leftJoin('tblservers', 'tblservers.id', '=', 'tblservergroupsrel.serverid')
            ->where('tblservergroupsrel.groupid', $serverGroupId);

        $serverId = $serverIds ? $serverIds->first()->serverid : null;

        return \WHMCS\Product\Server::find($serverId);

    }

    protected static function decryptServerPassword(string $encodedPassword): string
    {
        return localAPI('DecryptPassword', [
            'password2' => $encodedPassword,
        ])['password'];
    }

    /**
     * Create Configuration
     *
     * @param $productSettings
     * @throws \Exception
     */
    public function __construct(array $productSettings)
    {
        //Check if registrar is enabled in WHMCS configuration
        if ($productSettings['apiEndpoint'] === null)
        {
            print_r(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS));
            throw new \Exception(" Api Endpoint is empty in Product configuration");
        }
        $this->configuration = $productSettings;
    }

    /**
     * Get values from configuration array
     *
     * @param $name
     * @return mixed
     */
    public function __get($name)
    {
        //todo wywalic
        return $this->configuration[$name];
    }

    /**
     * Create authorization headers
     *
     * @return array
     */
    public function getAuthHeaders(): array
    {
        $time  = gmdate("y-m-d H");
        $token = base64_encode(hash_hmac("sha256", $this->apiKey, "{$this->username}:$time"));

        return
            [
                "username" => $this->username,
                "token"    => $token
            ];
    }

    public function getConfigurationArray(): array
    {
        return $this->configuration;
    }

    public function getInvalidServerTypeError()
    {
        $lang = ServiceLocator::call('lang');

        $messaage = $lang->addReplacementConstant('provisioning_name', $this->getModuleDisplayName())->absoluteT('invalidServerType');
        $data     = $this->buildErrorMessage($messaage);

        return $this->returnAjaxResponse($data);
    }
}
