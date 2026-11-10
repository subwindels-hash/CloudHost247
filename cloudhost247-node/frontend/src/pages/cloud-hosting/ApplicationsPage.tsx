import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthenticatedUser } from '../../hooks/useAuthenticatedUser';
import { CloudHostingService } from '../../services/cloud-hosting';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ErrorBoundary } from '../../components/AppErrorBoundary';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { SearchBar } from '../../components/SearchBar';
import { FilterBar } from '../../components/FilterBar';

export default function CloudHostingApplicationsPage() {
  usePageMeta('My Applications', 'Deploy, manage, and monitor your applications with Dokploy.');

  const { user } = useAuthenticatedUser();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterOptions>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await CloudHostingService.getApplications(user.id, searchQuery, filters);
        setApplications(result);
      } catch (err) {
        setError(err.message || 'Failed to load applications');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.id, searchQuery, filters]);

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="cloud-hosting-applications">
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--developers">
        <div className="ch247-hero__inner">
          <h1>My Applications</h1>
          <p>Deploy, manage, and monitor your applications with Dokploy integration.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <div className="ch247-action-bar">
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search applications..." />
            <FilterBar filters={filters} onChange={setFilters} />
            <Button to="/dashboard/cloud-hosting/deploy" variant="primary">Deploy New Application</Button>
          </div>

          <Table 
            columns={[
              { key: 'name', label: 'Application Name', sortable: true },
              { key: 'runtime', label: 'Runtime', sortable: true },
              { key: 'status', label: 'Status', sortable: true },
              { key: 'domain', label: 'Domain', sortable: false },
              { key: 'deployment', label: 'Last Deployment', sortable: true },
              { key: 'actions', label: 'Actions', sortable: false }
            ]}
            data={applications}
            rowKey="id"
            renderCell={(column, row) => {
              switch (column.key) {
                case 'actions':
                  return (
                    <div className="action-buttons">
                      <Button size="small" variant="secondary" to={`/dashboard/cloud-hosting/applications/${row.id}`}>View</Button>
                      <Button size="small" variant="secondary" onClick={() => handleRestart(row.id)}>Restart</Button>
                      <Button size="small" variant="danger" onClick={() => handleDelete(row.id)}>Delete</Button>
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

interface Application {
  id: string;
  name: string;
  runtime: string;
  status: 'running' | 'stopped' | 'deploying' | 'failed';
  domain: string;
  deployment: string;
}

interface FilterOptions {
  status?: 'running' | 'stopped' | 'deploying' | 'failed';
  runtime?: string;
}

const handleRestart = async (appId: string) => {
  // Implementation for restarting application via Dokploy API
};

const handleDelete = async (appId: string) => {
  // Implementation for deleting application via Dokploy API
};
