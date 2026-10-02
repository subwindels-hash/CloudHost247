<?php
namespace CloudHost247\NetworkTools\Core\Registry\Catalog;

/**
 * Diagnostics & monitoring tools (docs sections 80, 81).
 */
final class DiagnosticsCatalog
{
    public static function definitions()
    {
        return array(
            'diagnostics/domain-health' => array(
                'name' => 'Domain Health Center',
                'category' => 'diagnostics',
                'icon' => 'heart',
                'summary' => 'One page that shows DNS, email, web, network and security facts about a domain.',
                'description' => 'Collects the DNS, email authentication, web, network and TLS facts for a domain in one report, each with an explicit PASS/WARNING/ERROR/NOT CHECKED/UNKNOWN status and the evidence behind it.',
                'explanation' => 'Every section reports what was actually observed. Sections that could not run say NOT CHECKED or UNKNOWN — the page never invents a status, and there is no invented health score: only documented, per-check verdicts.',
                'fields' => array(
                    array('name' => 'domain', 'type' => 'domain', 'label' => 'Domain', 'required' => true, 'target' => true),
                    array('name' => 'dkim_selector', 'type' => 'dkim_selector', 'label' => 'DKIM selector', 'required' => false, 'default' => 'default'),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Context\\DomainHealthService',
                'target_field' => 'domain',
                'timeout_seconds' => 40,
                'cache_seconds' => 180,
                'exports' => array('json', 'csv', 'pdf', 'png'),
                'result_view' => 'domain-health',
                'notes' => array('The health view is a factual summary of checks that ran; it is not a security certification.'),
            ),
            'diagnostics/monitors' => array(
                'name' => 'Domain Monitoring',
                'category' => 'diagnostics',
                'icon' => 'bell',
                'summary' => 'Watch SSL expiry, DNS records and email configuration and be told when they change.',
                'description' => 'Creates monitors for a domain (certificate expiry, a specific DNS record, or the SPF/DKIM/DMARC set) and checks them on the WHMCS cron, notifying through the existing CloudHost247 notification system.',
                'explanation' => 'Monitoring compares the current state with the state recorded at the last run and notifies on a change or an expiry threshold. A monitor that could not run is reported as not checked, never as unchanged.',
                'fields' => array(
                    array('name' => 'action', 'type' => 'select', 'label' => 'Action', 'required' => true, 'default' => 'list', 'options' => array('list' => 'List my monitors', 'create' => 'Create a monitor', 'delete' => 'Delete a monitor')),
                    array('name' => 'monitor_type', 'type' => 'select', 'label' => 'Monitor type', 'required' => false, 'default' => 'dns_change', 'options' => array('dns_change' => 'DNS record change', 'ssl_expiry' => 'SSL certificate expiry', 'email_config' => 'Email authentication configuration')),
                    array('name' => 'target', 'type' => 'text', 'label' => 'Target', 'required' => false, 'maxlength' => 191, 'help' => 'Domain for SSL and email monitors; "domain TYPE" for a DNS record, e.g. "example.com A".'),
                    array('name' => 'expected', 'type' => 'text', 'label' => 'Expected value', 'required' => false, 'maxlength' => 255, 'help' => 'Optional for DNS monitors: the value you expect. Leave empty to alert on any change.'),
                    array('name' => 'monitor_id', 'type' => 'number', 'label' => 'Monitor ID (for delete)', 'required' => false, 'min' => 1, 'max' => 2147483647),
                    array('name' => 'interval_hours', 'type' => 'number', 'label' => 'Check every (hours)', 'required' => false, 'default' => 6, 'min' => 1, 'max' => 168),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Context\\MonitorService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'visibility' => 'customer',
                'rate_tier' => 'standard',
                'cache_seconds' => 0,
                'exports' => array('json', 'csv'),
                'result_view' => 'monitors',
            ),
        );
    }
}
