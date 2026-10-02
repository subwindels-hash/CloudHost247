<?php
namespace CloudHost247\Marketing\Http;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Integrations\Services\IntegrationManager;
use CloudHost247\Integrations\Support\ResultCode;
use CloudHost247\Marketing\Domain\CampaignStatus;
use CloudHost247\Marketing\Domain\ConsentStatus;
use CloudHost247\Marketing\Domain\QueueStatus;
use CloudHost247\Marketing\Domain\CampaignAudience;
use CloudHost247\Marketing\Domain\SubscriberSource;
use CloudHost247\Marketing\Domain\TemplateBlock;
use CloudHost247\Marketing\Repositories\TemplateRepository;
use CloudHost247\Marketing\Domain\SubscriberStatus;
use CloudHost247\Marketing\Domain\SuppressionReason;
use CloudHost247\Marketing\Repositories\ListRepository;
use CloudHost247\Marketing\Repositories\SettingsRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\SuppressionRepository;
use CloudHost247\Marketing\Repositories\TagRepository;
use CloudHost247\Marketing\Security\InputValidator;
use CloudHost247\Marketing\Services\ExportService;
use CloudHost247\Marketing\Services\ImportService;
use CloudHost247\Marketing\Services\SegmentService;
use CloudHost247\Marketing\Services\CampaignService;
use CloudHost247\Marketing\Services\TemplateService;
use CloudHost247\Marketing\Repositories\QueueRepository;
use CloudHost247\Marketing\Services\AnalyticsService;
use CloudHost247\Marketing\Services\BounceParser;
use CloudHost247\Marketing\Services\QueueService;
use CloudHost247\Marketing\Services\TrackingService;
use CloudHost247\Marketing\Services\SmtpTransport;
use CloudHost247\Marketing\Services\SubscriptionService;
use WHMCS\Database\Capsule;

/**
 * Admin dispatcher. Only views and operations that actually exist are
 * routable — later sessions register theirs here. Everything is capability-
 * and CSRF-guarded; every state change is audit-logged.
 */
final class AdminController
{
    const PROVIDER_KEY = 'cpanel_smtp';

    /** Every view the module currently serves. */
    const VIEWS = array('dashboard', 'settings', 'subscribers', 'subscriber', 'lists', 'import', 'suppressions',
        'segments', 'segment', 'templates', 'template', 'campaigns', 'campaign', 'analytics');

    /**
     * Sections the admin menu already advertises but whose build session has not
     * landed yet. They stay routable so a click never silently lands somewhere
     * else; each renders an explicit notice naming the session that delivers it.
     *
     * @var array<string,int>
     */
    const PLANNED_VIEWS = array(
        'automations' => 10,
    );

    /** Capability required for each mutating view (SESSION 2 scope). */
    const SUBSCRIBER_CAPABILITY = 'marketing.subscribers.manage';
    /** Segments are audience definitions, so they sit behind the campaign capability. */
    const SEGMENT_CAPABILITY = 'marketing.campaigns.manage';
    /** Templates are content, same capability boundary as campaigns. */
    const TEMPLATE_CAPABILITY = 'marketing.campaigns.manage';
    /** A campaign is an audience plus approved content. */
    const CAMPAIGN_CAPABILITY = 'marketing.campaigns.manage';

    private $settings;
    private $subscribers;
    private $suppressions;
    private $lists;
    private $tags;
    private $subscriptions;
    private $imports;
    private $exporter;
    private $segments;
    private $templates;
    private $campaigns;
    private $queue;
    private $analytics;

    public function __construct(
        SettingsRepository $settings = null,
        SubscriberRepository $subscribers = null,
        SuppressionRepository $suppressions = null,
        ListRepository $lists = null,
        TagRepository $tags = null,
        SubscriptionService $subscriptions = null,
        ImportService $imports = null,
        ExportService $exporter = null,
        SegmentService $segments = null,
        TemplateService $templates = null,
        CampaignService $campaigns = null,
        QueueService $queue = null,
        AnalyticsService $analytics = null
    ) {
        $this->settings = $settings ?: new SettingsRepository();
        $this->subscribers = $subscribers ?: new SubscriberRepository();
        $this->suppressions = $suppressions ?: new SuppressionRepository();
        $this->lists = $lists ?: new ListRepository();
        $this->tags = $tags ?: new TagRepository();
        $this->subscriptions = $subscriptions ?: new SubscriptionService($this->subscribers, $this->suppressions, $this->lists, $this->tags);
        $this->imports = $imports ?: new ImportService($this->subscribers, $this->tags, $this->subscriptions);
        $this->exporter = $exporter ?: new ExportService($this->subscribers, $this->lists, $this->tags);
        $this->segments = $segments ?: new SegmentService();
        $this->templates = $templates ?: new TemplateService();
        $this->campaigns = $campaigns ?: new CampaignService(null, null, null, null, null, $this->campaignTransport());
        $this->queue = $queue ?: new QueueService(null, $this->campaigns);
        $this->analytics = $analytics ?: new AnalyticsService();
    }

    public function handle()
    {
        AdminGuard::requireAdmin();
        $view = isset($_GET['view']) ? (string) $_GET['view'] : 'dashboard';
        $plannedSessions = self::PLANNED_VIEWS;
        if (!in_array($view, self::VIEWS, true) && !isset($plannedSessions[$view])) { $view = 'dashboard'; }

        $notice = '';
        $error = '';
        $extra = array();
        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') === 'POST') {
            if ($view === 'settings') {
                // saveSettings() performs its own POST-token + capability guard and
                // reports validation failures as an Error notice (unchanged).
                $notice = $this->saveSettings();
                if (substr($notice, 0, 6) === 'Error:') { $error = $notice; $notice = ''; }
            } elseif ($view === 'campaigns' || $view === 'campaign') {
                $this->requireMutation(self::CAMPAIGN_CAPABILITY);
                try {
                    $result = $this->handleCampaignAction();
                    $notice = isset($result['notice']) ? $result['notice'] : '';
                    $error = isset($result['error']) ? $result['error'] : '';
                    if (isset($result['campaignTest'])) { $extra['campaignTest'] = $result['campaignTest']; }
                } catch (\InvalidArgumentException $e) {
                    $error = 'Error: ' . $e->getMessage();
                } catch (\RuntimeException $e) {
                    $error = 'Error: ' . $e->getMessage();
                }
            } elseif ($view === 'templates' || $view === 'template') {
                $this->requireMutation(self::TEMPLATE_CAPABILITY);
                try {
                    $result = $this->handleTemplateAction();
                    $notice = isset($result['notice']) ? $result['notice'] : '';
                    $error = isset($result['error']) ? $result['error'] : '';
                    if (isset($result['templatePreview'])) { $extra['templatePreview'] = $result['templatePreview']; }
                } catch (\InvalidArgumentException $e) {
                    $error = 'Error: ' . $e->getMessage();
                } catch (\RuntimeException $e) {
                    $error = 'Error: ' . $e->getMessage();
                }
            } elseif ($view === 'segments' || $view === 'segment') {
                $this->requireMutation(self::SEGMENT_CAPABILITY);
                try {
                    $result = $this->handleSegmentAction();
                    $notice = isset($result['notice']) ? $result['notice'] : '';
                    $error = isset($result['error']) ? $result['error'] : '';
                } catch (\InvalidArgumentException $e) {
                    $error = 'Error: ' . $e->getMessage();
                } catch (\RuntimeException $e) {
                    $error = 'Error: ' . $e->getMessage();
                }
            } elseif (in_array($view, array('subscribers', 'subscriber', 'lists', 'suppressions', 'import'), true)) {
                // The guard runs outside the try block on purpose: a missing
                // capability or CSRF token must refuse the request outright, never
                // be downgraded into a rendered error message.
                $this->requireMutation(self::SUBSCRIBER_CAPABILITY);
                try {
                    if ($view === 'subscribers' || $view === 'subscriber') { $result = $this->handleSubscriberAction(); }
                    elseif ($view === 'lists') { $result = $this->handleListAction(); }
                    elseif ($view === 'suppressions') { $result = $this->handleSuppressionAction(); }
                    else { $result = $this->handleImportAction(); }
                    $notice = isset($result['notice']) ? $result['notice'] : '';
                    $error = isset($result['error']) ? $result['error'] : '';
                    if (isset($result['download'])) { $extra['download'] = $result['download']; }
                    if (isset($result['importPreview'])) { $extra['importPreview'] = $result['importPreview']; }
                } catch (\InvalidArgumentException $e) {
                    $error = 'Error: ' . $e->getMessage();
                } catch (\RuntimeException $e) {
                    $error = 'Error: ' . $e->getMessage();
                }
            }
        }

        $data = array(
            'view' => $view,
            'notice' => $notice,
            'error' => $error,
            'download' => null,
            'csrf' => $this->csrfToken(),
            'stats' => $this->dashboardStats(),
            'settings' => $this->settings->all(),
            'integration' => $this->integrationStatus(),
            'tables' => $this->tableHealth(),
            'plannedSession' => isset($plannedSessions[$view]) ? $plannedSessions[$view] : 0,
            'capabilities' => array(
                'settings.manage' => $this->capAllowed('marketing.settings.manage'),
                'campaigns.manage' => $this->capAllowed('marketing.campaigns.manage'),
                'subscribers.manage' => $this->capAllowed(self::SUBSCRIBER_CAPABILITY),
                'sending.manage' => $this->capAllowed('marketing.sending.manage'),
                'analytics.view' => $this->capAllowed('marketing.analytics.view'),
            ),
        );

        $viewError = '';
        if ($view === 'subscribers') { $data = array_merge($data, $this->subscriberListView()); }
        elseif ($view === 'subscriber') {
            $detail = $this->subscriberDetailView();
            $data = array_merge($data, $detail);
            if (empty($detail['subscriberDetail'])) { $viewError = 'That subscriber does not exist.'; }
        } elseif ($view === 'lists') { $data = array_merge($data, $this->listView()); }
        elseif ($view === 'import') { $data = array_merge($data, $this->importView()); }
        elseif ($view === 'suppressions') { $data = array_merge($data, $this->suppressionView()); }
        elseif ($view === 'segments') { $data = array_merge($data, $this->segmentListView()); }
        elseif ($view === 'segment') {
            $detail = $this->segmentDetailView();
            $data = array_merge($data, $detail);
            if (empty($detail['segmentDetail'])) { $viewError = 'That segment does not exist.'; }
        } elseif ($view === 'analytics') { $data = array_merge($data, $this->analyticsView()); }
        elseif ($view === 'campaigns') { $data = array_merge($data, $this->campaignListView()); }
        elseif ($view === 'campaign') {
            $detail = $this->campaignDetailView();
            $data = array_merge($data, $detail);
            if (empty($detail['campaignDetail'])) { $viewError = 'That campaign does not exist.'; }
        } elseif ($view === 'templates') { $data = array_merge($data, $this->templateListView()); }
        elseif ($view === 'template') {
            $detail = $this->templateDetailView();
            $data = array_merge($data, $detail);
            if (empty($detail['templateDetail'])) { $viewError = 'That template does not exist.'; }
        }

        foreach ($extra as $key => $value) { $data[$key] = $value; }
        if ($error === '' && $viewError !== '') { $data['error'] = $viewError; }

        return $data;
    }

    /** Mirrors requireCapability() semantics exactly: no policy row means normal addon authorization. */
    private function capAllowed($capability)
    {
        try {
            AdminGuard::requireCapability('cloudhost247_marketing', $capability);
            return true;
        } catch (\Throwable $error) {
            return false;
        }
    }

    private function csrfToken()
    {
        return function_exists('generate_token') ? generate_token('plain') : '';
    }

    /** Every mutating handler starts here: POST + CSRF + capability. */
    private function requireMutation($capability)
    {
        AdminGuard::requirePostToken();
        AdminGuard::requireCapability('cloudhost247_marketing', $capability);
    }

    // ------------------------------------------------------------ subscribers

    private function subscriberListView()
    {
        $filters = array(
            'status' => isset($_GET['status']) ? (string) $_GET['status'] : '',
            'consent_status' => isset($_GET['consent']) ? (string) $_GET['consent'] : '',
            'source' => isset($_GET['source']) ? (string) $_GET['source'] : '',
            'search' => isset($_GET['q']) ? substr((string) $_GET['q'], 0, 64) : '',
            'list_id' => isset($_GET['list']) ? (int) $_GET['list'] : 0,
            'tag_id' => isset($_GET['tag']) ? (int) $_GET['tag'] : 0,
        );
        foreach (array('status' => SubscriberStatus::class, 'consent_status' => ConsentStatus::class, 'source' => SubscriberSource::class) as $key => $class) {
            if ($filters[$key] !== '' && !$class::isValid($filters[$key])) { $filters[$key] = ''; }
        }
        $page = isset($_GET['page']) ? max(1, (int) $_GET['page']) : 1;
        $perPage = isset($_GET['per_page']) ? (int) $_GET['per_page'] : 50;
        $result = $this->subscribers->paginate($filters, $page, $perPage);

        return array('subscribers' => array_merge($result, array(
            'filters' => $filters,
            'lists' => $this->lists->all(),
            'tags' => $this->tags->all(),
            'statuses' => SubscriberStatus::all(),
            'consents' => ConsentStatus::all(),
            'sources' => SubscriberSource::all(),
            'counts' => $this->subscribers->countsByStatus(),
        )));
    }

    private function subscriberDetailView()
    {
        $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
        $subscriber = $id > 0 ? $this->subscribers->find($id) : null;
        if (!$subscriber) {
            return array('subscriberDetail' => null);
        }
        $suppression = $this->suppressions->findByEmail((string) $subscriber->email);
        return array('subscriberDetail' => array(
            'subscriber' => $subscriber,
            'lists' => $this->lists->forSubscriber($id),
            'tags' => $this->tags->forSubscriber($id),
            'all_lists' => $this->lists->all('active'),
            'all_tags' => $this->tags->all(),
            'suppression' => $suppression,
            'sendable' => $this->subscriptions->checkSendable((string) $subscriber->email),
            'consents' => ConsentStatus::all(),
        ));
    }

    /** POST actions for the subscriber screens. */
    private function handleSubscriberAction()
    {
        $action = isset($_POST['action']) ? (string) $_POST['action'] : '';

        if ($action === 'subscriber.save') {
            $input = array(
                'email' => isset($_POST['email']) ? (string) $_POST['email'] : '',
                'first_name' => isset($_POST['first_name']) ? (string) $_POST['first_name'] : '',
                'last_name' => isset($_POST['last_name']) ? (string) $_POST['last_name'] : '',
                'company' => isset($_POST['company']) ? (string) $_POST['company'] : '',
                'phone' => isset($_POST['phone']) ? (string) $_POST['phone'] : '',
                'country' => isset($_POST['country']) ? (string) $_POST['country'] : '',
                'list_ids' => isset($_POST['list_ids']) ? array_map('intval', (array) $_POST['list_ids']) : array(),
                'tags' => isset($_POST['tags']) ? preg_split('/[;,]/', (string) $_POST['tags']) : array(),
                'consent_status' => isset($_POST['consent_status']) ? (string) $_POST['consent_status'] : ConsentStatus::UNKNOWN,
                'consent_source' => isset($_POST['consent_source']) ? (string) $_POST['consent_source'] : 'admin',
            );
            $result = $this->subscriptions->subscribe($input, SubscriberSource::MANUAL);
            if (!$result['ok'] && $result['reason'] === 'suppressed') {
                return array('notice' => '', 'error' => 'That address is on the suppression list (' . $result['suppression_reason'] . '). Release the suppression first if this is intended.');
            }
            return array('notice' => $result['created'] ? 'Subscriber added.' : 'Subscriber updated.', 'error' => '');
        }

        if ($action === 'subscriber.unsubscribe') {
            $email = isset($_POST['email']) ? (string) $_POST['email'] : '';
            $result = $this->subscriptions->unsubscribe($email, 'admin', 'Administrator unsubscribe');
            return $result['ok']
                ? array('notice' => 'Address unsubscribed and suppressed.', 'error' => '')
                : array('notice' => '', 'error' => 'That is not a usable email address.');
        }

        if ($action === 'subscriber.resubscribe') {
            $email = isset($_POST['email']) ? (string) $_POST['email'] : '';
            $result = $this->subscriptions->resubscribe($email, isset($_POST['consent_source']) ? (string) $_POST['consent_source'] : 'admin');
            if ($result['ok']) { return array('notice' => 'Subscriber restored to subscribed.', 'error' => ''); }
            $reason = $result['reason'] === 'suppressed'
                ? 'The address is still on the suppression list. Release the suppression first — that step is audited separately.'
                : 'That address has no subscriber record to restore.';
            return array('notice' => '', 'error' => $reason);
        }

        if ($action === 'subscriber.tag.add' || $action === 'subscriber.tag.remove') {
            $id = isset($_POST['subscriber_id']) ? (int) $_POST['subscriber_id'] : 0;
            $subscriber = $this->subscribers->find($id);
            if (!$subscriber) { return array('notice' => '', 'error' => 'That subscriber does not exist.'); }
            $raw = isset($_POST['tag']) ? trim((string) $_POST['tag']) : '';
            if ($raw === '') { return array('notice' => '', 'error' => 'A tag name is required.'); }
            $key = strtolower(preg_replace('/[^a-z0-9_-]/i', '-', $raw));
            if (!$this->tags->findByKey($key)) {
                if ($action === 'subscriber.tag.remove') { return array('notice' => 'That tag is not assigned.', 'error' => ''); }
                $tag = $this->tags->ensure($key, $raw);
            } else {
                $tag = $this->tags->findByKey($key);
            }
            if ($action === 'subscriber.tag.add') {
                $this->tags->assign($id, (int) $tag->id);
                AuditLogger::record('cloudhost247_marketing', 'subscriber.tag_added', 'marketing_subscriber', $id, array(), array('tag' => $key), 'success');
                return array('notice' => 'Tag assigned.', 'error' => '');
            }
            $this->tags->remove($id, (int) $tag->id);
            AuditLogger::record('cloudhost247_marketing', 'subscriber.tag_removed', 'marketing_subscriber', $id, array('tag' => $key), array(), 'success');
            return array('notice' => 'Tag removed.', 'error' => '');
        }

        if ($action === 'subscriber.lists') {
            $id = isset($_POST['subscriber_id']) ? (int) $_POST['subscriber_id'] : 0;
            $subscriber = $this->subscribers->find($id);
            if (!$subscriber) { return array('notice' => '', 'error' => 'That subscriber does not exist.'); }
            $wanted = isset($_POST['list_ids']) ? array_map('intval', (array) $_POST['list_ids']) : array();
            $current = $this->lists->idsForSubscriber($id);
            $added = $this->lists->addMembers($id, $wanted);
            $removed = 0;
            foreach (array_diff($current, $wanted) as $listId) { $removed += $this->lists->removeMember($id, (int) $listId); }
            AuditLogger::record('cloudhost247_marketing', 'subscriber.lists_changed', 'marketing_subscriber', $id,
                array('list_ids' => $current), array('list_ids' => $wanted), 'success');
            return array('notice' => 'Memberships updated (' . $added . ' added, ' . $removed . ' removed).', 'error' => '');
        }

        if ($action === 'subscribers.export') {
            $filters = isset($_POST['filters']) && is_array($_POST['filters']) ? $_POST['filters'] : array();
            $csv = $this->exporter->subscribersCsv($filters);
            return array('notice' => '', 'error' => '', 'download' => array(
                'filename' => 'cloudhost247-subscribers-' . date('Ymd-His') . '.csv',
                'content' => $csv,
            ));
        }

        return array('notice' => '', 'error' => 'Unknown subscriber action.');
    }

    // ------------------------------------------------------------------ lists

    private function listView()
    {
        $rows = array();
        foreach ($this->lists->all() as $list) {
            $rows[] = array('list' => $list, 'members' => $this->lists->memberCount((int) $list->id));
        }
        return array('listsView' => array('rows' => $rows, 'statuses' => array('active', 'archived')));
    }

    private function handleListAction()
    {
        $action = isset($_POST['action']) ? (string) $_POST['action'] : '';

        if ($action === 'list.save') {
            $id = isset($_POST['list_id']) ? (int) $_POST['list_id'] : 0;
            if ($id > 0) {
                $list = $this->lists->update($id, array(
                    'name' => isset($_POST['name']) ? (string) $_POST['name'] : '',
                    'description' => isset($_POST['description']) ? (string) $_POST['description'] : '',
                ));
                AuditLogger::record('cloudhost247_marketing', 'list.updated', 'marketing_list', (int) $list->id, array(), array('name' => (string) $list->name), 'success');
                return array('notice' => 'List updated.', 'error' => '');
            }
            $key = isset($_POST['list_key']) ? (string) $_POST['list_key'] : '';
            if (trim($key) === '') {
                $key = strtolower(preg_replace('/[^a-z0-9_-]/i', '-', (string) (isset($_POST['name']) ? $_POST['name'] : 'list')));
            }
            $list = $this->lists->create($key, isset($_POST['name']) ? (string) $_POST['name'] : '', isset($_POST['description']) ? (string) $_POST['description'] : '');
            AuditLogger::record('cloudhost247_marketing', 'list.created', 'marketing_list', (int) $list->id, array(), array('key' => (string) $list->list_key), 'success');
            return array('notice' => 'List created.', 'error' => '');
        }

        if ($action === 'list.archive') {
            $id = isset($_POST['list_id']) ? (int) $_POST['list_id'] : 0;
            $list = $this->lists->archive($id);
            AuditLogger::record('cloudhost247_marketing', 'list.archived', 'marketing_list', (int) $list->id, array(), array('status' => 'archived'), 'success');
            return array('notice' => 'List archived. Campaigns already sent keep their recipient records.', 'error' => '');
        }

        if ($action === 'list.members.add') {
            $listId = isset($_POST['list_id']) ? (int) $_POST['list_id'] : 0;
            if (!$this->lists->find($listId)) { return array('notice' => '', 'error' => 'That list does not exist.'); }
            $emails = preg_split('/[\s,;]+/', (string) (isset($_POST['emails']) ? $_POST['emails'] : ''), -1, PREG_SPLIT_NO_EMPTY);
            $added = 0;
            $skipped = array();
            foreach (array_slice($emails, 0, 500) as $email) {
                if (!InputValidator::isPlausibleEmail($email)) { $skipped[] = 'invalid: ' . substr($email, 0, 40); continue; }
                $result = $this->subscriptions->subscribe(array('email' => $email, 'list_ids' => array($listId), 'consent_status' => ConsentStatus::UNKNOWN), SubscriberSource::MANUAL);
                if ($result['ok']) { $added++; } else { $skipped[] = 'suppressed: ' . $email; }
            }
            return array('notice' => $added . ' address(es) added to the list.', 'error' => $skipped ? 'Skipped — ' . implode(', ', array_slice($skipped, 0, 10)) : '');
        }

        return array('notice' => '', 'error' => 'Unknown list action.');
    }

    // ------------------------------------------------------------- campaigns

    /**
     * The cPanel SMTP transport, wired to the central vault. It reports whether
     * the provider is usable and why not, so the operator is told what to fix
     * instead of being offered a button that does nothing.
     */
    private function campaignTransport()
    {
        return new SmtpTransport();
    }

    /** Availability, reason and non-secret identity of the delivery provider. */
    private function transportSummary()
    {
        $transport = $this->campaigns->transport();
        $summary = array(
            'available' => $transport->isAvailable(),
            'key' => $transport->key(),
            'reason' => $transport->reason(),
            'identity' => null,
        );
        if ($transport instanceof SmtpTransport) { $summary['identity'] = $transport->identity(); }
        return $summary;
    }

    /**
     * Reporting screen. Reads only, and it names the one campaign it is
     * reporting on — an aggregate with a deleted campaign cannot silently drop
     * rows, it reports them under their id.
     */
    private function analyticsView()
    {
        $days = isset($_GET['days']) ? (int) $_GET['days'] : 30;
        $campaignId = isset($_GET['campaign_id']) ? (int) $_GET['campaign_id'] : 0;
        $data = array('analyticsView' => array(
            'days' => max(1, min(365, $days)),
            'overview' => $this->analytics->overview($days),
            'campaign_id' => $campaignId,
            'summary' => $campaignId > 0 ? $this->analytics->campaignSummary($campaignId) : null,
            'clickMap' => $campaignId > 0 ? $this->analytics->clickMap($campaignId) : null,
            'activity' => $campaignId > 0 ? $this->analytics->recipientActivity($campaignId, 100) : array(),
            'timeline' => $this->analytics->timeline($campaignId, 14),
            'canView' => $this->capAllowed('marketing.analytics.view'),
        ));
        if ($campaignId > 0 && $data['analyticsView']['summary'] === null) {
            $data['analyticsView']['missing'] = true;
        }
        return $data;
    }

    private function campaignListView()
    {
        $filters = array(
            'status' => isset($_GET['status']) ? (string) $_GET['status'] : '',
            'search' => isset($_GET['q']) ? substr((string) $_GET['q'], 0, 64) : '',
        );
        if ($filters['status'] !== '' && !CampaignStatus::isValid($filters['status'])) { $filters['status'] = ''; }
        $page = isset($_GET['page']) ? max(1, (int) $_GET['page']) : 1;
        return array('campaignsView' => array_merge($this->campaigns->repository()->paginate($filters, $page, 25), array(
            'filters' => $filters,
            'counts' => $this->campaigns->repository()->countsByStatus(),
            'statuses' => CampaignStatus::all(),
            'canManage' => $this->capAllowed(self::CAMPAIGN_CAPABILITY),
            'transport' => $this->transportSummary(),
            'lists' => $this->lists->all('active'),
            'segments' => $this->segments->repository()->all('active'),
            'templates' => $this->templates->repository()->all('active'),
            'audiences' => CampaignAudience::all(),
        )));
    }

    private function campaignDetailView()
    {
        $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
        $campaign = $id > 0 ? $this->campaigns->repository()->find($id) : null;
        if (!$campaign) { return array('campaignDetail' => null); }
        $queueCounts = (new QueueRepository())->countsForCampaign((int) $campaign->id);

        return array('campaignDetail' => array(
            'row' => $campaign,
            'checklist' => $this->campaigns->checklist($campaign),
            'audience' => $this->campaigns->audiencePreview($campaign),
            'editable' => in_array((string) $campaign->status, CampaignService::EDITABLE_STATUSES, true),
            'transport' => $this->transportSummary(),
            'lists' => $this->lists->all('active'),
            'segments' => $this->segments->repository()->all('active'),
            'templates' => $this->templates->repository()->all('active'),
            'canManage' => $this->capAllowed(self::CAMPAIGN_CAPABILITY),
            'links' => (new TrackingService())->linksFor((int) $campaign->id),
            'queue' => array_merge($queueCounts, array(
                'total' => array_sum($queueCounts),
                'settings' => array(
                    'batch_size' => (int) $this->settings->get('batch_size'),
                    'messages_per_minute' => (int) $this->settings->get('messages_per_minute'),
                    'hourly_limit' => (int) $this->settings->get('hourly_limit'),
                ),
            )),
        ));
    }

    private function handleCampaignAction()
    {
        $action = isset($_POST['action']) ? (string) $_POST['action'] : '';
        $id = isset($_POST['campaign_id']) ? (int) $_POST['campaign_id'] : 0;

        if ($action === 'campaign.save') {
            $input = array(
                'name' => isset($_POST['name']) ? (string) $_POST['name'] : '',
                'subject' => isset($_POST['subject']) ? (string) $_POST['subject'] : '',
                'preview_text' => isset($_POST['preview_text']) ? (string) $_POST['preview_text'] : '',
                'from_name' => isset($_POST['from_name']) ? (string) $_POST['from_name'] : '',
                'from_email' => isset($_POST['from_email']) ? (string) $_POST['from_email'] : '',
                'reply_to' => isset($_POST['reply_to']) ? (string) $_POST['reply_to'] : '',
                'template_id' => isset($_POST['template_id']) ? (int) $_POST['template_id'] : 0,
                'audience_type' => isset($_POST['audience_type']) ? (string) $_POST['audience_type'] : CampaignAudience::LIST,
                'audience_id' => isset($_POST['audience_id']) ? (int) $_POST['audience_id'] : 0,
            );
            if ($id > 0) {
                $campaign = $this->campaigns->update($id, $input);
                $notice = 'Campaign saved.';
                if ($campaign->status === CampaignStatus::DRAFT && isset($_POST['previous_status'])) {
                    $notice = 'Campaign saved and returned to draft — approve it again before it can be scheduled.';
                }
            } else {
                $campaign = $this->campaigns->create($input, isset($_SESSION['adminid']) ? (int) $_SESSION['adminid'] : 0);
                $notice = 'Campaign created as a draft.';
            }
            return array('notice' => $notice, 'error' => '', 'campaign_id' => (int) $campaign->id);
        }

        if ($action === 'campaign.ready') {
            $result = $this->campaigns->markReady($id);
            return array('notice' => $result['message'], 'error' => '');
        }

        if ($action === 'campaign.schedule' || $action === 'campaign.resume') {
            $datetime = isset($_POST['scheduled_at']) ? (string) $_POST['scheduled_at'] : '';
            $timezone = isset($_POST['scheduled_timezone']) ? (string) $_POST['scheduled_timezone'] : 'UTC';
            $result = $action === 'campaign.schedule'
                ? $this->campaigns->schedule($id, $datetime, $timezone)
                : $this->campaigns->resume($id, $datetime, $timezone);
            return array('notice' => $result['message'], 'error' => '');
        }

        if ($action === 'campaign.send_now') {
            $result = $this->campaigns->sendNow($id);
            return array('notice' => $result['message'], 'error' => '');
        }

        if ($action === 'campaign.pause') {
            $result = $this->campaigns->pause($id);
            return array('notice' => $result['message'], 'error' => '');
        }

        if ($action === 'campaign.cancel') {
            $result = $this->campaigns->cancel($id);
            return array('notice' => $result['message'], 'error' => '');
        }

        if ($action === 'campaign.archive') {
            $result = $this->campaigns->archive($id);
            return array('notice' => $result['message'], 'error' => '');
        }

        if ($action === 'bounce.ingest') {
            $evidence = isset($_POST['evidence']) ? (string) $_POST['evidence'] : '';
            if (trim($evidence) === '') { return array('notice' => '', 'error' => 'Paste the bounce message first.'); }
            $parsed = (new BounceParser())->parse($evidence);
            $tracking = new TrackingService();
            $hard = 0;
            $soft = 0;
            foreach ($parsed['hard'] as $email) {
                $result = $tracking->recordBounce($email, 'hard', 'dsn');
                if (!empty($result['ok'])) { $hard++; }
            }
            foreach ($parsed['soft'] as $email) {
                $result = $tracking->recordBounce($email, 'soft', 'dsn');
                if (!empty($result['ok'])) { $soft++; }
            }
            AuditLogger::record('cloudhost247_marketing', 'bounce.evidence_ingested', 'marketing_campaign', $id, array(), array(
                'hard' => $hard, 'soft' => $soft, 'unrecognised' => (int) $parsed['unrecognised'],
            ), $hard + $soft > 0 ? 'success' : 'denied');
            if ($hard + $soft === 0) {
                return array('notice' => '', 'error' => 'No recipient could be read from that evidence; nothing was changed.');
            }
            $summary = 'Recorded ' . $hard . ' permanent and ' . $soft . ' temporary failure(s).';
            if ((int) $parsed['unrecognised'] > 0) { $summary .= ' ' . (int) $parsed['unrecognised'] . ' block(s) could not be read and were left alone.'; }
            return array('notice' => $summary, 'error' => '');
        }

        if ($action === 'campaign.work') {
            if (!$this->campaigns->transport()->isAvailable()) {
                return array('notice' => '', 'error' => 'Nothing was queued or sent: ' . $this->campaigns->transport()->reason());
            }
            $summary = $this->queue->run(array('campaign_id' => $id, 'worker' => 'admin-' . (isset($_SESSION['adminid']) ? (int) $_SESSION['adminid'] : 0)));
            $message = 'Worker pass finished: ' . $summary['sent'] . ' accepted by the relay, '
                . $summary['retried'] . ' to retry, ' . $summary['failed'] . ' failed'
                . ($summary['rate_limited'] !== '' ? ' — ' . $summary['rate_limited'] : '') . '.';
            AuditLogger::record('cloudhost247_marketing', 'campaign.worked', 'marketing_campaign', $id,
                array(), $summary, 'success');
            return array('notice' => $message, 'error' => '');
        }

        if ($action === 'campaign.test') {
            $result = $this->campaigns->sendTest($id, isset($_POST['test_email']) ? (string) $_POST['test_email'] : '');
            return array(
                'notice' => 'Test message accepted by ' . $result['transport'] . ' for delivery.',
                'error' => '',
                'campaignTest' => $result,
            );
        }

        return array('notice' => '', 'error' => 'Unknown campaign action.');
    }

    // ------------------------------------------------------------- templates

    private function templateListView()
    {
        $rows = $this->templates->repository()->all();
        $descriptions = array();
        foreach ($rows as $row) {
            $design = TemplateRepository::designOf($row);
            $descriptions[(int) $row->id] = count($design['blocks']) . ' block(s)';
        }
        return array('templatesView' => array(
            'rows' => $rows,
            'descriptions' => $descriptions,
            'catalog' => $this->templates->catalog(),
            'canManage' => $this->capAllowed(self::TEMPLATE_CAPABILITY),
        ));
    }

    private function templateDetailView()
    {
        $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
        $template = $id > 0 ? $this->templates->repository()->find($id) : null;
        $design = array('blocks' => array());
        $warnings = array();
        if ($template) {
            $design = $this->templates->normaliseDesign($template->design_json, false);
            $warnings = $this->templates->preview($design)['warnings'];
        }
        return array('templateDetail' => $template ? array(
            'row' => $template,
            'design' => $design,
            'warnings' => $warnings,
            'catalog' => $this->templates->catalog(),
        ) : null);
    }

    private function handleTemplateAction()
    {
        $action = isset($_POST['action']) ? (string) $_POST['action'] : '';

        if ($action === 'template.preview') {
            $rendered = $this->templates->preview($this->designFromPost());
            return array(
                'notice' => $rendered['warnings'] ? 'Preview rendered with warnings — see below.' : 'Preview rendered.',
                'error' => '',
                'templatePreview' => array('html' => $rendered['html'], 'text' => $rendered['text'], 'warnings' => $rendered['warnings']),
            );
        }

        if ($action === 'template.save' || $action === 'template.add_block') {
            $id = isset($_POST['template_id']) ? (int) $_POST['template_id'] : 0;
            $design = $this->designFromPost();
            $name = isset($_POST['name']) ? (string) $_POST['name'] : '';
            $category = isset($_POST['category']) ? (string) $_POST['category'] : 'general';
            $key = isset($_POST['template_key']) ? (string) $_POST['template_key'] : '';
            if (trim($key) === '') { $key = strtolower(preg_replace('/[^a-z0-9_-]/i', '-', $name)); }
            // A brand-new template and a block just added both carry catalog
            // defaults, so they save with warnings that the editor displays; the
            // explicit Save button on an existing template is strict and refuses
            // missing required values.
            $result = $this->templates->save(array(
                'template_key' => $key,
                'name' => $name,
                'category' => $category,
                'design' => $design,
            ), $id, $id > 0 && $action === 'template.save');
            $template = $result['template'];
            $notice = ($id > 0 ? 'Template updated.' : 'Template created.') . ' ' . count($design['blocks']) . ' block(s).';
            $error = '';
            if ($result['warnings']) { $error = 'Warnings — ' . implode(' ', $result['warnings']); }
            return array('notice' => $notice, 'error' => $error, 'template_id' => (int) $template->id);
        }

        if ($action === 'template.archive' || $action === 'template.activate' || $action === 'template.delete') {
            $id = isset($_POST['template_id']) ? (int) $_POST['template_id'] : 0;
            if ($action === 'template.archive') { $this->templates->archive($id); return array('notice' => 'Template archived.', 'error' => ''); }
            if ($action === 'template.activate') { $this->templates->activate($id); return array('notice' => 'Template reactivated.', 'error' => ''); }
            $this->templates->delete($id);
            return array('notice' => 'Template deleted.', 'error' => '');
        }

        return array('notice' => '', 'error' => 'Unknown template action.');
    }

    /** @return array{blocks:array} the design as posted (block rows plus an optional add) */
    private function designFromPost()
    {
        $rows = isset($_POST['block']) && is_array($_POST['block']) ? $_POST['block'] : array();
        $blocks = array();
        foreach ($rows as $row) {
            if (!is_array($row)) { continue; }
            if (!empty($row['remove'])) { continue; }
            $type = isset($row['type']) ? (string) $row['type'] : '';
            if (!TemplateBlock::isValid($type)) { continue; }
            $block = array('type' => $type);
            foreach (TemplateBlock::definition($type)['fields'] as $name => $field) {
                if (array_key_exists($name, $row)) { $block[$name] = $row[$name]; }
            }
            $blocks[] = $block;
        }
        $add = isset($_POST['add_block']) ? (string) $_POST['add_block'] : '';
        if (TemplateBlock::isValid($add)) { $blocks[] = array_merge(array('type' => $add), TemplateBlock::defaults($add)); }
        return array('blocks' => $blocks);
    }

    // -------------------------------------------------------------- segments

    private function segmentListView()
    {
        $rows = $this->segments->repository()->all();
        $definitions = array();
        foreach ($rows as $row) {
            $definitions[(int) $row->id] = array(
                'summary' => $this->segments->describeDefinition($row->definition_json),
                'sentences' => $this->segments->ruleSentences($row->definition_json),
            );
        }
        return array('segmentsView' => array(
            'rows' => $rows,
            'definitions' => $definitions,
            'canManage' => $this->capAllowed(self::SEGMENT_CAPABILITY),
        ));
    }

    private function segmentDetailView()
    {
        $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
        $segment = $id > 0 ? $this->segments->repository()->find($id) : null;
        $definition = array('match' => 'all', 'rules' => array());
        if ($segment) {
            $definition = $this->segments->normaliseDefinition($segment->definition_json, false);
        }
        return array('segmentDetail' => $segment ? array(
            'row' => $segment,
            'definition' => $definition,
            'sentences' => $this->segments->ruleSentences($definition),
            'summary' => $this->segments->describeDefinition($definition),
        ) : null);
    }

    private function handleSegmentAction()
    {
        $action = isset($_POST['action']) ? (string) $_POST['action'] : '';

        if ($action === 'segment.save') {
            $id = isset($_POST['segment_id']) ? (int) $_POST['segment_id'] : 0;
            $definition = array(
                'match' => isset($_POST['match']) ? (string) $_POST['match'] : 'all',
                'rules' => $this->rulesFromPost(),
            );
            if (!$definition['rules']) { return array('notice' => '', 'error' => 'Add at least one rule — an empty segment would mean "everyone".'); }
            $name = isset($_POST['name']) ? (string) $_POST['name'] : '';
            $key = isset($_POST['segment_key']) ? (string) $_POST['segment_key'] : '';
            if (trim($key) === '') { $key = strtolower(preg_replace('/[^a-z0-9_-]/i', '-', $name)); }
            $segment = $this->segments->save(array(
                'segment_key' => $key,
                'name' => $name,
                'description' => isset($_POST['description']) ? (string) $_POST['description'] : '',
                'definition' => $definition,
            ), $id);
            return array('notice' => $id > 0 ? 'Segment updated.' : 'Segment created.', 'error' => '', 'segment_id' => (int) $segment->id);
        }

        if ($action === 'segment.archive' || $action === 'segment.activate') {
            $id = isset($_POST['segment_id']) ? (int) $_POST['segment_id'] : 0;
            if ($action === 'segment.archive') { $this->segments->archive($id); } else { $this->segments->activate($id); }
            return array('notice' => 'Segment ' . ($action === 'segment.archive' ? 'archived' : 'reactivated') . '.', 'error' => '');
        }

        if ($action === 'segment.count') {
            $id = isset($_POST['segment_id']) ? (int) $_POST['segment_id'] : 0;
            $refresh = $this->segments->refreshCount($id);
            $result = $refresh['result'];
            $notice = number_format($result['count']) . ' subscriber(s) match right now';
            if ($result['truncated']) { $notice .= ' (evaluation stopped at the scan limit — refine the rules)'; }
            $notice .= '.';
            $error = $result['error'];
            if ($result['unverified'] > 0) {
                $error = trim($error . ' ' . number_format($result['unverified']) . ' subscriber(s) were not matched because a customer-side condition could not be verified.');
            }
            return array('notice' => $notice, 'error' => $error);
        }

        return array('notice' => '', 'error' => 'Unknown segment action.');
    }

    /** @return array canonical rule rows, blank form rows dropped */
    private function rulesFromPost()
    {
        $fields = isset($_POST['rule_field']) && is_array($_POST['rule_field']) ? $_POST['rule_field'] : array();
        $operators = isset($_POST['rule_operator']) && is_array($_POST['rule_operator']) ? $_POST['rule_operator'] : array();
        $values = isset($_POST['rule_value']) && is_array($_POST['rule_value']) ? $_POST['rule_value'] : array();
        $rules = array();
        foreach ($fields as $index => $field) {
            $field = trim((string) $field);
            $operator = isset($operators[$index]) ? strtolower(trim((string) $operators[$index])) : '';
            $value = isset($values[$index]) ? (string) $values[$index] : '';
            if ($field === '' && $operator === '' && trim($value) === '') { continue; }
            $rules[] = array('field' => $field, 'operator' => $operator, 'value' => $value);
        }
        return $rules;
    }

    // ----------------------------------------------------------- suppressions

    private function suppressionView()
    {
        $filters = array(
            'reason' => isset($_GET['reason']) ? (string) $_GET['reason'] : '',
            'search' => isset($_GET['q']) ? substr((string) $_GET['q'], 0, 64) : '',
        );
        if ($filters['reason'] !== '' && !SuppressionReason::isValid($filters['reason'])) { $filters['reason'] = ''; }
        $page = isset($_GET['page']) ? max(1, (int) $_GET['page']) : 1;
        return array('suppressionsView' => array_merge($this->suppressions->paginate($filters, $page, 50), array(
            'filters' => $filters,
            'counts' => $this->suppressions->countsByReason(),
            'reasons' => SuppressionReason::all(),
        )));
    }

    private function handleSuppressionAction()
    {
        $action = isset($_POST['action']) ? (string) $_POST['action'] : '';

        if ($action === 'suppression.add') {
            $reason = isset($_POST['reason']) ? (string) $_POST['reason'] : '';
            if (!SuppressionReason::isValid($reason)) { throw new \InvalidArgumentException('Choose a suppression reason.'); }
            $result = $this->subscriptions->suppress(isset($_POST['email']) ? (string) $_POST['email'] : '', $reason,
                isset($_POST['detail']) ? (string) $_POST['detail'] : '');
            return array('notice' => $result['created'] ? 'Address suppressed.' : 'Address was already suppressed; the existing reason was kept.', 'error' => '');
        }

        if ($action === 'suppression.release') {
            $force = !empty($_POST['force']);
            $released = $this->subscriptions->releaseSuppression(isset($_POST['email']) ? (string) $_POST['email'] : '', $force);
            if (!$released) { return array('notice' => '', 'error' => 'That address is not on the suppression list.'); }
            return array('notice' => 'Suppression released. The address is still not subscribed — restore it separately if needed.', 'error' => '');
        }

        return array('notice' => '', 'error' => 'Unknown suppression action.');
    }

    // ---------------------------------------------------------------- imports

    private function importView()
    {
        return array('importView' => array(
            'history' => $this->imports->history(25),
            'lists' => $this->lists->all('active'),
            'fields' => ImportService::fields(),
            'max_rows' => ImportService::MAX_ROWS,
            'consents' => ConsentStatus::all(),
        ));
    }

    private function handleImportAction()
    {
        $action = isset($_POST['action']) ? (string) $_POST['action'] : '';
        if ($action !== 'import.preview' && $action !== 'import.apply') {
            return array('notice' => '', 'error' => 'Unknown import action.');
        }

        $payload = $this->readImportPayload();
        $parsed = $this->imports->parse($payload, ImportService::MAX_ROWS);
        if (!$parsed['ok']) { return array('notice' => '', 'error' => $parsed['error']); }

        $mapping = $this->submittedMapping($parsed);
        $options = array(
            'list_ids' => isset($_POST['list_ids']) ? array_map('intval', (array) $_POST['list_ids']) : array(),
            'default_tags' => isset($_POST['default_tags']) ? preg_split('/[;,]/', (string) $_POST['default_tags'], -1, PREG_SPLIT_NO_EMPTY) : array(),
            'consent_status' => isset($_POST['consent_status']) ? (string) $_POST['consent_status'] : ConsentStatus::UNKNOWN,
            'consent_source' => isset($_POST['consent_source']) ? (string) $_POST['consent_source'] : '',
            'source_label' => isset($_POST['source_label']) ? (string) $_POST['source_label'] : 'Pasted content',
        );

        $hash = $this->payloadHash($payload, $mapping, $options);
        if ($action === 'import.preview') {
            $preview = $this->imports->preview($parsed['rows'], $mapping, $options);
            return array('notice' => '', 'error' => '', 'importPreview' => array(
                'counts' => $preview['counts'],
                'mapping' => $mapping,
                'hash' => $hash,
                'header' => $parsed['header'],
                'has_header' => $parsed['has_header'],
                'options' => $options,
            ));
        }

        $submitted = isset($_POST['preview_hash']) ? (string) $_POST['preview_hash'] : '';
        if (!hash_equals($hash, $submitted)) {
            return array('notice' => '', 'error' => 'The content or mapping changed since the preview. Run “Preview import” again so the numbers you approve are the numbers that run.');
        }
        $result = $this->imports->apply($parsed['rows'], $mapping, $options);
        $counts = $result['counts'];
        $summary = $counts['created'] . ' created, ' . $counts['updated'] . ' updated, ' . $counts['skipped_suppressed'] . ' skipped (suppressed), '
            . $counts['skipped_invalid'] . ' skipped (invalid), ' . $counts['skipped_duplicate'] . ' skipped (duplicate), ' . $counts['skipped_empty'] . ' skipped (no address).';
        return array('notice' => 'Import #' . $result['import_id'] . ' finished: ' . $summary, 'error' => '');
    }

    /**
     * Preview and apply must see identical input; the hash is what makes the
     * approved preview binding without storing anything server-side.
     */
    private function payloadHash($payload, array $mapping, array $options)
    {
        ksort($mapping);
        $material = json_encode(array(
            'content' => $payload,
            'mapping' => $mapping,
            'list_ids' => isset($options['list_ids']) ? array_values($options['list_ids']) : array(),
            'default_tags' => isset($options['default_tags']) ? array_values($options['default_tags']) : array(),
            'consent_status' => isset($options['consent_status']) ? $options['consent_status'] : '',
            'consent_source' => isset($options['consent_source']) ? $options['consent_source'] : '',
        ));
        return hash('sha256', $material);
    }

    /** Uploaded file when present, otherwise the pasted textarea. */
    private function readImportPayload()
    {
        if (isset($_FILES['import_file']) && is_array($_FILES['import_file'])) {
            $file = $_FILES['import_file'];
            $error = isset($file['error']) ? (int) $file['error'] : UPLOAD_ERR_NO_FILE;
            if ($error === UPLOAD_ERR_OK) {
                $tmp = isset($file['tmp_name']) ? (string) $file['tmp_name'] : '';
                if ($tmp !== '' && is_uploaded_file($tmp) && (int) $file['size'] <= 8 * 1024 * 1024) {
                    $contents = file_get_contents($tmp);
                    if ($contents !== false) { return (string) $contents; }
                }
            } elseif ($error !== UPLOAD_ERR_NO_FILE) {
                throw new \InvalidArgumentException('The uploaded file could not be read (upload error ' . $error . ').');
            }
        }
        return isset($_POST['content']) ? (string) $_POST['content'] : '';
    }

    /**
     * Mapping comes from the submitted form; when a header row is present and
     * no mapping was submitted the service's suggestion is used.
     */
    private function submittedMapping(array $parsed)
    {
        $posted = isset($_POST['mapping']) && is_array($_POST['mapping']) ? $_POST['mapping'] : array();
        $mapping = array();
        $columns = $parsed['has_header'] ? count($parsed['header']) : (count($parsed['rows']) ? count($parsed['rows'][0]) : 0);
        if (!$posted && $parsed['has_header']) { $posted = $this->imports->suggestMapping($parsed['header']); }
        for ($i = 0; $i < $columns; $i++) {
            $field = isset($posted[$i]) ? (string) $posted[$i] : 'ignore';
            if (!in_array($field, ImportService::fields(), true)) { $field = 'ignore'; }
            $mapping[$i] = $field;
        }
        return $mapping;
    }

    // --------------------------------------------------------------- dashboard

    /** Real counters from the module tables only — zero means zero, never fabricated. */
    private function dashboardStats()
    {
        $count = function ($table, $column = null, $value = null) {
            $query = Capsule::table($table);
            if ($column !== null) { $query->where($column, (string) $value); }
            $row = $query->selectRaw('COUNT(*) AS aggregate')->first();
            return $row ? (int) $row->aggregate : 0;
        };
        $subscribers = array();
        foreach (SubscriberStatus::all() as $status) {
            $subscribers[$status] = $count('mod_cloudhost247_marketing_subscribers', 'status', $status);
        }
        $campaigns = array();
        foreach (CampaignStatus::all() as $status) {
            $campaigns[$status] = $count('mod_cloudhost247_marketing_campaigns', 'status', $status);
        }
        $queue = array();
        foreach (QueueStatus::all() as $status) {
            $queue[$status] = $count('mod_cloudhost247_marketing_email_queue', 'status', $status);
        }
        return array(
            'subscribers' => $subscribers,
            'subscriber_total' => $count('mod_cloudhost247_marketing_subscribers'),
            'suppressed_total' => $count('mod_cloudhost247_marketing_suppressions'),
            'lists_total' => $count('mod_cloudhost247_marketing_lists', 'status', 'active'),
            'tags_total' => $count('mod_cloudhost247_marketing_tags'),
            'campaigns' => $campaigns,
            'queue' => $queue,
            'events_total' => $count('mod_cloudhost247_marketing_email_events'),
            'imports_total' => $count('mod_cloudhost247_marketing_imports'),
        );
    }

    /** Non-secret integration status only (spec #16: credentials stay in the vault). */
    private function integrationStatus()
    {
        $status = array(
            'key' => self::PROVIDER_KEY,
            'configured' => false,
            'tested' => false,
            'result_code' => '',
            'result_label' => 'Not configured',
            'last_checked_at' => '',
            'configure_url' => 'addonmodules.php?module=cloudhost247_integrations&view=configure&integration=' . self::PROVIDER_KEY,
            'events_url' => 'addonmodules.php?module=cloudhost247_integrations&view=events&provider_key=' . self::PROVIDER_KEY,
        );
        try {
            if (!IntegrationManager::installed()) { return $status; }
            $row = IntegrationManager::repository()->findFor(
                self::PROVIDER_KEY,
                \CloudHost247\Integrations\Support\Environment::active()
            );
            if (!$row) { return $status; }
            $status['configured'] = (int) $row->enabled === 1;
            $status['result_code'] = isset($row->status) ? (string) $row->status : '';
            if ($status['result_code'] !== '') {
                $status['result_label'] = ResultCode::label($status['result_code']);
            } elseif ($status['configured']) {
                $status['result_label'] = 'Configured — connection test pending';
            } else {
                $status['result_label'] = 'Configured but disabled';
            }
            $status['last_checked_at'] = isset($row->last_checked_at) && $row->last_checked_at ? (string) $row->last_checked_at : '';
            $status['tested'] = $status['last_checked_at'] !== '';
        } catch (\Throwable $error) {
            // Status readout must never break the dashboard.
        }
        return $status;
    }

    private function tableHealth()
    {
        $tables = array(
            'mod_cloudhost247_marketing_campaigns', 'mod_cloudhost247_marketing_subscribers',
            'mod_cloudhost247_marketing_lists', 'mod_cloudhost247_marketing_list_members',
            'mod_cloudhost247_marketing_segments', 'mod_cloudhost247_marketing_templates',
            'mod_cloudhost247_marketing_campaign_recipients', 'mod_cloudhost247_marketing_email_queue',
            'mod_cloudhost247_marketing_email_events', 'mod_cloudhost247_marketing_suppressions',
            'mod_cloudhost247_marketing_automations', 'mod_cloudhost247_marketing_automation_steps',
            'mod_cloudhost247_marketing_automation_runs', 'mod_cloudhost247_marketing_imports',
            'mod_cloudhost247_marketing_links', 'mod_cloudhost247_marketing_settings',
            'mod_cloudhost247_marketing_tags', 'mod_cloudhost247_marketing_subscriber_tags',
        );
        $health = array();
        foreach ($tables as $table) {
            $exists = false;
            try { $exists = Capsule::schema()->hasTable($table); } catch (\Throwable $error) {}
            $health[$table] = $exists;
        }
        return $health;
    }

    private function saveSettings()
    {
        AdminGuard::requirePostToken();
        AdminGuard::requireCapability('cloudhost247_marketing', 'marketing.settings.manage');
        $before = $this->settings->all();
        $input = isset($_POST['setting']) && is_array($_POST['setting']) ? $_POST['setting'] : array();
        try {
            $sanitized = array();
            foreach ($this->settings->defaults() as $key => $default) {
                if (!array_key_exists($key, $input)) { continue; }
                $value = (string) $input[$key];
                switch ($key) {
                    case 'batch_size': $value = (string) InputValidator::positiveInt($value, 1, 500, 'Batch size'); break;
                    case 'messages_per_minute': $value = (string) InputValidator::positiveInt($value, 1, 600, 'Messages per minute'); break;
                    case 'hourly_limit': $value = (string) InputValidator::positiveInt($value, 1, 100000, 'Hourly limit'); break;
                    case 'concurrent_workers': $value = (string) InputValidator::positiveInt($value, 1, 8, 'Concurrent workers'); break;
                    case 'retry_attempts': $value = (string) InputValidator::positiveInt($value, 0, 10, 'Retry attempts'); break;
                    case 'bounce_soft_threshold': $value = (string) InputValidator::positiveInt($value, 1, 20, 'Bounce threshold'); break;
                    case 'queue_lock_seconds': $value = (string) InputValidator::positiveInt($value, 30, 3600, 'Queue lock seconds'); break;
                    case 'events_retention_days': $value = (string) InputValidator::positiveInt($value, 7, 730, 'Events retention'); break;
                    case 'enabled':
                    case 'open_tracking_enabled':
                    case 'click_tracking_enabled': $value = $value === '1' ? '1' : '0'; break;
                    case 'default_from_email':
                    case 'default_reply_to': $value = $value === '' ? '' : InputValidator::email($value, $key); break;
                    case 'default_timezone':
                        $value = trim($value);
                        if (!in_array($value, \DateTimeZone::listIdentifiers(), true)) {
                            throw new \InvalidArgumentException('Unknown timezone: ' . $value);
                        }
                        break;
                    case 'retry_backoff_minutes':
                        $parts = preg_split('/[,\s]+/', $value, -1, PREG_SPLIT_NO_EMPTY);
                        $clean = array();
                        foreach ($parts as $part) { $clean[] = (string) InputValidator::positiveInt($part, 1, 10080, 'Backoff step'); }
                        if (!$clean) { throw new \InvalidArgumentException('At least one retry backoff step is required.'); }
                        $value = implode(',', $clean);
                        break;
                    case 'support_url':
                    case 'account_url':
                    case 'tracking_base_url': $value = $value === '' ? '' : rtrim(InputValidator::url($value, $key), '/'); break;
                    case 'default_from_name':
                    case 'company_name': $value = InputValidator::shortText($value, 128, $key); break;
                    case 'physical_address': $value = InputValidator::shortText($value, 500, $key); break;
                    case 'compliance_note': $value = InputValidator::shortText($value, 500, $key); break;
                    case 'footer_html':
                        // Sanitized when rendered by the footer builder (Service layer);
                        // store only a bounded fragment here.
                        $value = InputValidator::shortText($value, 4000, $key);
                        break;
                    case 'default_provider':
                        $value = InputValidator::key($value, 'Default provider');
                        if ($value !== self::PROVIDER_KEY) {
                            throw new \InvalidArgumentException('Only the cpanel_smtp delivery provider exists; additional providers can be added through CloudHost247 API & Integrations without changing this module.');
                        }
                        break;
                    default:
                        $value = InputValidator::shortText($value, 255, $key);
                }
                $sanitized[$key] = $value;
            }
            foreach ($sanitized as $key => $value) { $this->settings->set($key, $value); }
            AuditLogger::record('cloudhost247_marketing', 'settings.updated', 'marketing_settings', 'default', array('keys' => array_keys($sanitized)), array('keys' => array_keys($sanitized)), 'success');
            return 'Settings saved.';
        } catch (\InvalidArgumentException $e) {
            AuditLogger::record('cloudhost247_marketing', 'settings.updated', 'marketing_settings', 'default', array('keys' => array_keys($before)), array(), 'failed', $e->getMessage());
            return 'Error: ' . $e->getMessage();
        }
    }
}
