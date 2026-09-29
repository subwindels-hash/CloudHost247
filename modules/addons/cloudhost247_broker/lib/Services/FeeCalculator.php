<?php
namespace CloudHost247\Broker\Services;

use CloudHost247\Broker\Repositories\FeeRepository;

/**
 * Keeps every charge separate (requirement #22): acquisition price, brokerage
 * fee, transfer fee and optional service fee are always computed and shown
 * individually, never folded into a single opaque total.
 */
final class FeeCalculator
{
    private $fees;

    public function __construct(FeeRepository $fees = null)
    {
        $this->fees = $fees ?: new FeeRepository();
    }

    /**
     * @param float  $acquisitionPrice the agreed domain acquisition amount
     * @param string $currency
     * @param string $providerKey
     * @return array acquisition_price, brokerage_fee, transfer_fee, service_fee, total, currency, breakdown
     */
    public function calculate($acquisitionPrice, $currency, $providerKey = '')
    {
        $acquisitionPrice = round((float) $acquisitionPrice, 2);
        $brokerageFee = $this->feeFor('brokerage_fee', $acquisitionPrice, $currency, $providerKey);
        $transferFee = $this->feeFor('transfer_fee', $acquisitionPrice, $currency, $providerKey);
        $serviceFee = $this->feeFor('service_fee', $acquisitionPrice, $currency, $providerKey);
        $total = round($acquisitionPrice + $brokerageFee + $transferFee + $serviceFee, 2);
        return array(
            'acquisition_price' => $acquisitionPrice,
            'brokerage_fee' => $brokerageFee,
            'transfer_fee' => $transferFee,
            'service_fee' => $serviceFee,
            'total' => $total,
            'currency' => $currency,
        );
    }

    private function feeFor($appliesTo, $acquisitionPrice, $currency, $providerKey)
    {
        $candidates = array();
        foreach ($this->fees->enabled() as $rule) {
            if ($rule->applies_to !== $appliesTo) { continue; }
            if ($rule->provider_key && $rule->provider_key !== $providerKey) { continue; }
            if ($rule->currency && $rule->currency !== $currency) { continue; }
            $candidates[] = $rule;
        }
        if (!$candidates) { return 0.0; }
        // Prefer the most specific rule: provider+currency > provider only > currency only > global.
        usort($candidates, function ($a, $b) {
            $score = function ($rule) { return ($rule->provider_key ? 2 : 0) + ($rule->currency ? 1 : 0); };
            return $score($b) - $score($a);
        });
        $rule = $candidates[0];
        $amount = $rule->fee_type === 'percentage' ? round($acquisitionPrice * ((float) $rule->amount / 100), 2) : round((float) $rule->amount, 2);
        if ($rule->min_amount !== null && $amount < (float) $rule->min_amount) { $amount = round((float) $rule->min_amount, 2); }
        return $amount;
    }
}
