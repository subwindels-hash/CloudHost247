<?php
/**
 * Numbers REST API Controller
 */

namespace PhoneServices\API\Controllers;

use PhoneServices\Services\NumberService;

class NumbersController extends BaseController
{
    private $service;
    
    public function __construct()
    {
        $this->service = new NumberService();
    }
    
    /**
     * GET /api/numbers
     */
    public function index(array $params = []): array
    {
        $userId = $this->getUserId();
        $filters = $_GET;
        
        if ($userId > 0) {
            $numbers = $this->service->getUserNumbers($userId);
        } else {
            $numbers = $this->service->getAllNumbers($filters);
        }
        
        return ['success' => true, 'data' => $numbers];
    }
    
    /**
     * POST /api/numbers/purchase
     */
    public function purchase(array $params = []): array
    {
        $input = array_merge($_POST, $this->getInput());
        $error = $this->validate($input, ['number', 'country']);
        if ($error) {
            return ['success' => false, 'error' => $error];
        }
        
        $userId = $this->getUserId();
        if (!$userId) {
            return ['success' => false, 'error' => 'Authentication required'];
        }
        
        $result = $this->service->purchaseNumber(
            $userId,
            $input['number'],
            $input['country'],
            $input['type'] ?? 'local',
            $input['options'] ?? []
        );
        
        if (isset($result['error'])) {
            return ['success' => false, 'error' => $result['error']];
        }
        
        $this->log('Number purchased via API', ['user' => $userId]);
        return ['success' => true, 'data' => $result];
    }
    
    /**
     * POST /api/numbers/:id/renew
     */
    public function renew(array $params = []): array
    {
        $id = (int) ($params['id'] ?? 0);
        $userId = $this->getUserId();
        
        $number = $this->service->getNumber($id);
        if (!$number || ($userId > 0 && $number['user_id'] != $userId)) {
            return ['success' => false, 'error' => 'Number not found'];
        }
        
        $result = $this->service->renewNumber($id, (int) ($_POST['months'] ?? 1));
        return $result;
    }
    
    /**
     * POST /api/numbers/:id/suspend
     */
    public function suspend(array $params = []): array
    {
        $id = (int) ($params['id'] ?? 0);
        $userId = $this->getUserId();
        
        $number = $this->service->getNumber($id);
        if (!$number || ($userId > 0 && $number['user_id'] != $userId)) {
            return ['success' => false, 'error' => 'Number not found'];
        }
        
        $this->service->suspendNumber($id, $_POST['reason'] ?? '');
        return ['success' => true];
    }
    
    /**
     * POST /api/numbers/:id/release
     */
    public function release(array $params = []): array
    {
        $id = (int) ($params['id'] ?? 0);
        $userId = $this->getUserId();
        
        $number = $this->service->getNumber($id);
        if (!$number || ($userId > 0 && $number['user_id'] != $userId)) {
            return ['success' => false, 'error' => 'Number not found'];
        }
        
        $this->service->releaseNumber($id);
        return ['success' => true];
    }

    /**
     * GET /api/numbers/search?country=US&type=local
     *
     * @return array<string,mixed>
     */
    public function search(array $params = []): array
    {
        $country = strtoupper(substr((string) ($_GET['country'] ?? ''), 0, 2));

        if (!preg_match('/^[A-Z]{2}$/', $country)) {
            return $this->error('A valid ISO country code is required');
        }

        $type = in_array((string) ($_GET['type'] ?? 'local'), ['local', 'tollfree', 'mobile', 'second'], true)
            ? (string) $_GET['type']
            : 'local';

        $filters = [
            'area_code' => preg_replace('/[^0-9]/', '', (string) ($_GET['area_code'] ?? '')),
            'contains'  => preg_replace('/[^0-9A-Za-z]/', '', (string) ($_GET['contains'] ?? '')),
            'limit'     => min(50, max(1, (int) ($_GET['limit'] ?? 20))),
        ];

        $results = $this->service->searchNumbers($country, $type, array_filter($filters));

        return $this->ok($results, ['count' => count($results)]);
    }

    /**
     * GET /api/numbers/countries
     *
     * @return array<string,mixed>
     */
    public function countries(array $params = []): array
    {
        return $this->ok($this->service->getAvailableCountries());
    }

    /**
     * POST /api/numbers/:id/assign  { "service_id": 123 }
     *
     * @return array<string,mixed>
     */
    public function assign(array $params = []): array
    {
        $numberId = (int) ($params['id'] ?? 0);
        $input = array_merge($_POST, $this->getInput());
        $serviceId = (int) ($input['service_id'] ?? 0);

        if ($numberId <= 0 || $serviceId <= 0) {
            return $this->error('A number id and service_id are required');
        }

        if (!$this->isSystemContext() && !$this->ownsOrFail('mod_phoneservices_numbers', $numberId)) {
            return $this->error('Number not found', 404);
        }

        if (!$this->service->assignNumber($numberId, $serviceId)) {
            return $this->error('The number could not be assigned');
        }

        $this->log('Number assigned', ['number' => $numberId, 'service' => $serviceId]);

        return $this->ok(['number_id' => $numberId, 'service_id' => $serviceId]);
    }

}
