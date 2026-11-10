import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthenticatedUser } from '../../hooks/useAuthenticatedUser';
import { CloudHostingService } from '../../services/cloud-hosting';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ErrorBoundary } from '../../components/AppErrorBoundary';
import { Card } from '../../components/Card';
import { StatCard } from '../../components/StatCard';
import { Chart } from '../../components/Chart';
import { Table } from '../../components/Table';

export default function CloudHostingOverviewPage() {
  usePageMeta('Cloud Application Hosting Overview', 'Manage your applications, databases, domains, and deployments with Dokploy integration.');

  const { user } = useAuthenticatedUser();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await CloudHostingService.getOverview(user.id);
        setData(result);
      } catch (err) {
        setError(err.message || 'Failed to load overview');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.id]);

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="error-message">{error}</div>;
  if (!data) return null;

  return (
    <div className="cloud-hosting-overview">
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--developers">
        <div className="ch247-hero__inner">
          <h1>Cloud Application Hosting</h1>
          <p>Manage your applications, databases, domains, and deployments with Dokploy integration.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-grid">
          <StatCard title="Total Applications" value={data.totalApplications} icon="app" />
          <StatCard title="Running Applications" value={data.runningApplications} icon="rocket" />
          <StatCard title="Databases" value={data.totalDatabases} icon="database" />
          <StatCard title="Domains" value={data.totalDomains} icon="globe" />
          <StatCard title="Deployments" value={data.totalDeployments} icon="history" />
          <StatCard title="Consumption" value={`${data.consumption} GB`} icon="activity" />
        </div>
      </section>

      <section className="ch247-section ch247-section--muted">
        <div className="ch247-page ch247-page--wide">
          <h2>Quick Actions</h2>
          <div className="ch247-action-grid">
            <Card title="Deploy New Application" description="Connect GitHub, GitLab, or Bitbucket" to="/dashboard/cloud-hosting/deploy" />
            <Card title="Create Database" description="PostgreSQL, MySQL, MongoDB, Redis" to="/dashboard/cloud-hosting/databases" />
            <Card title="Connect Domain" description="Custom domains and SSL certificates" to="/dashboard/cloud-hosting/domains" />
            <Card title="Manage Environments" description="Environment variables and secrets" to="/dashboard/cloud-hosting/environments" />
          </div>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--cta">
          <h2>Subscription Status</h2>
          <p>Your Cloud Application Hosting plan is {data.subscriptionStatus}</p>
          <div className="ch247-subscription-info">
            <span>Plan: {data.planName}</span>
            <span>Limits: {data.limits}</span>
            <span>Renewal: {data.renewalDate}</span>
          </div>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <h2>Recent Activity</h2>
          <Table columns={['Action', 'Resource', 'Status', 'Date']} data={data.recentActivity} />
        </div>
      </section>
    </div>
  );
}

interface OverviewData {
  totalApplications: number;
  runningApplications: number;
  totalDatabases: number;
  totalDomains: number;
  totalDeployments: number;
  consumption: string;
  subscriptionStatus: string;
  planName: string;
  limits: string;
  renewalDate: string;
  recentActivity: ActivityItem[];
}

interface ActivityItem {
  action: string;
  resource: string;
  status: 'success' | 'failed' | 'pending';
  date: string;
}
