<?php
namespace CloudHost247\Ovh\Pricing;

final class SourcePriceExtractor
{
    public function extract(array $plan, $duration = null)
    {
        $candidates = array();
        foreach ($this->priceRows($plan) as $row) {
            $rowDuration = isset($row['duration']) ? (string) $row['duration'] : (isset($row['interval']) ? (string) $row['interval'] : null);
            if ($duration !== null && $rowDuration !== null && $rowDuration !== $duration) continue;
            $price = $this->numericPrice($row);
            $currency = $this->currency($row, $plan);
            if ($price !== null && $price > 0 && $currency !== null) $candidates[] = array('price'=>$price,'currency'=>$currency,'duration'=>$rowDuration,'source'=>$row);
        }
        if (count($candidates) !== 1) return array('status'=>'ambiguous','candidates'=>$candidates);
        return array_merge(array('status'=>'resolved'),$candidates[0]);
    }
    private function priceRows(array $plan)
    {
        foreach (array('prices','pricing','pricings') as $key) if (isset($plan[$key]) && is_array($plan[$key])) {
            $rows = $plan[$key];
            if ($this->isAssoc($rows)) $rows = array($rows);
            return $rows;
        }
        return array();
    }
    private function numericPrice(array $row)
    {
        if (isset($row['priceInUcents']) && is_numeric($row['priceInUcents'])) return (float)$row['priceInUcents']/100000000;
        foreach (array('price','value','amount') as $key) if (isset($row[$key])) {
            $value = is_array($row[$key]) ? (isset($row[$key]['value'])?$row[$key]['value']:null) : $row[$key];
            if (is_numeric($value)) return (float)$value;
        }
        return null;
    }
    private function currency(array $row,array $plan)
    {
        foreach (array($row,isset($row['price'])&&is_array($row['price'])?$row['price']:array(),$plan) as $source)
            foreach (array('currencyCode','currency') as $key) if (!empty($source[$key]) && preg_match('/^[A-Z]{3}$/',strtoupper($source[$key]))) return strtoupper($source[$key]);
        return null;
    }
    private function isAssoc(array $value) { return $value !== array() && array_keys($value)!==range(0,count($value)-1); }
}
