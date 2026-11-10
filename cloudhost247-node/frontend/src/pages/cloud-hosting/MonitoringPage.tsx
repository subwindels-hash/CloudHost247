import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthenticatedUser } from '../../hooks/useAuthenticatedUser';
import { CloudHostingService } from '../../services/cloud-hosting';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ErrorBoundary } from '../../components/AppErrorBoundary';
import { Chart } from '../../components/Chart';
import { Table } from '../../components/Table';
import { FilterBar } from '../../components/FilterBar';

export default function CloudHostingMonitoringPage() {
  usePageMeta('Monitoring', 'Monitor resource usage and health with Dokploy.');

  const { user } = useAuthenticatedUser();
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterOptions>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await CloudHostingService.getMonitoringMetrics(user.id, filters);
        setMetrics(result);
      } catch (err) {
        setError(err.message || 'Failed to load monitoring');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.id, filters]);

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="error-message">{error}</div>;
  if (!metrics) return null;

  return (
    <div className="cloud-hosting-monitoring">
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--developers">
        <div className="ch247-hero__inner">
          <h1>Monitoring</h1>
          <p>Monitor resource usage and health with Dokploy.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <FilterBar filters={filters} onChange={setFilters} />

          <div className="monitoring-charts">
            <Chart title="CPU Usage" data={metrics.cpu} type="line" />
            <Chart title="Memory Usage" data={metrics.memory} type="line" />
            <Chart title="Storage Usage" data={metrics.storage} type="bar" />
            <Chart title="Network Traffic" data={metrics.network} type="line" />
          </div>

          <Table 
            columns={[
              { key: 'resource', label: 'Resource', sortable: true },
              { key: 'usage', label: 'Usage', sortable: true },
              { key: 'limit', label: 'Limit', sortable: true },
              { key: 'status', label: 'Status', sortable: true },
              { key: 'actions', label: 'Actions', sortable: false }
            ]}
            data={metrics.resources}
            rowKey="id"
            renderCell={(column, row) => {
              switch (column.key) {
                case 'actions':
                  return (
                    <div className="action-buttons">
                      <Button size="small" variant="secondary" to={`/dashboard/cloud-hosting/monitoring/${row.id}`}>View</Button>
                      <Button size="small" variant="secondary" onClick={() => handleAlerts(row.id)}>Alerts</Button>
                    </div>
                  );
                case 'status':
                  return <span className={`status-${row.status}`}>{row.status}</span>;
                default:
                  return row[column.key];
              }
            }}
          />
        </div>
      </section>
    </div>
  );
}

interface MetricsData {
  cpu: ChartData;
  memory: ChartData;
  storage: ChartData;
  network: ChartData;
  resources: ResourceItem[];
}

interface ChartData {
  labels: string[];
  values: number[];
}

interface ResourceItem {
  id: string;
  resource: string;
  usage: string;
  limit: string;
  status: 'healthy' | 'warning' | 'critical' | 'offline';
}

interface FilterOptions {
  resource?: string;
  status?: 'healthy' | 'warning' | 'critical' | 'offline';
}

const handleAlerts = async (resourceId: string) => {
  // Implementation for resource alerts via Dokploy API
};
