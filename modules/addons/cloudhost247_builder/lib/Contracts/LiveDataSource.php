<?php
namespace CloudHost247\Builder\Contracts;

/**
 * Live platform data for the hosting widgets.
 *
 * Every method returns null when the underlying source cannot be read. That is
 * a deliberate contract: a hosting widget must never invent a price, a TLD, a
 * cart total or a service status. "Unknown" travels all the way to the
 * renderer, which shows the administrator a clear notice in the editor and
 * omits the block from the published page rather than printing a placeholder
 * that a customer could mistake for a real offer.
 */
interface LiveDataSource
{
    /** True when the WHMCS catalogue tables can be read right now. */
    public function available();

    /** Human explanation for available() === false. */
    public function unavailableReason();

    /** @return array|null list of array('id','name') */
    public function productGroups();

    /**
     * @param int $groupId 0 for every visible group
     * @return array|null list of array('id','name','description','group','group_id','order_url','price')
     */
    public function products($groupId = 0, $limit = 12, $cycle = 'monthly');

    /** @return array|null single product row in the same shape as products() */
    public function product($id, $cycle = 'monthly');

    /**
     * @return array|null array('amount','formatted','currency','setup','cycle') or
     *                    null when the product has no price for that cycle
     */
    public function price($productId, $cycle = 'monthly');

    /**
     * @param string[] $tlds filter, e.g. array('.com', '.ng'); empty for all
     * @return array|null list of array('tld','register','transfer','renew','currency')
     */
    public function domainPricing(array $tlds = array(), $limit = 8);

    /**
     * Current visitor's cart.
     *
     * @return array|null array('items','lines','url','checkout_url')
     */
    public function cart();

    /** @return array|null published testimonials entered by an administrator */
    public function reviews($limit = 3);

    /**
     * Measured integration health from the API & Integrations centre.
     *
     * @return array|null list of array('label','state','detail','checked_at')
     */
    public function serviceStatus($limit = 6);

    /** @return array|null array('code','prefix','suffix') */
    public function currency();
}
