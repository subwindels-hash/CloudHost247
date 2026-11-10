import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthenticatedUser } from '../../hooks/useAuthenticatedUser';
import { CloudHostingService } from '../../services/cloud-hosting';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ErrorBoundary } from '../../components/AppErrorBoundary';
import { Table } from '../../components/Table';
import { SearchBar } from '../../components/SearchBar';
import { FilterBar } from '../../components/FilterBar';

export default function CloudHostingHistoryPage() {
  usePageMeta('Deployment History', 'Track deployment history and logs with Dokploy.');

  const { user } = useAuthenticatedUser();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterOptions>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await CloudHostingService.getDeployments(user.id, searchQuery, filters);
        setDeployments(result);
      } catch (err) {
        setError(err.message || 'Failed to load deployments');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.id, searchQuery, filters]);

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="cloud-hosting-history">
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--developers">
        <div className="ch247-hero__inner">
          <h1>Deployment History</h1>
          <p>Track deployment history and logs with Dokploy.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <div className="ch247-action-bar">
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search deployments..." />
            <FilterBar filters={filters} onChange={setFilters} />
          </div>

          <Table 
            columns={[
              { key: 'application', label: 'Application', sortable: true },
              { key: 'version', label: 'Version', sortable: true },
              { key: 'status', label: 'Status', sortable: true },
              { key: 'date', label: 'Date', sortable: true },
              { key: 'commit', label: 'Commit', sortable: false },
              { key: 'actions', label: 'Actions', sortable: false }
            ]}
            data={deployments}
            rowKey="id"
            renderCell={(column, row) => {
              switch (column.key) {
                case 'actions':
                  return (
                    <div className="action-buttons">
                      <Button size="small" variant="secondary" to={`/dashboard/cloud-hosting/history/${row.id}`}>View</Button>
                      <Button size="small" variant="secondary" onClick={() => handleLogs(row.id)}>Logs</Button>
                      <Button size="small" variant="secondary" onClick={() => handleRollback(row.id)}>Rollback</Button>
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

interface Deployment {
  id: string;
  application: string;
  version: string;
  status: 'success' | 'failed' | 'pending' | 'rolling-back';
  date: string;
  commit: string;
}

interface FilterOptions {
  status?: 'success' | 'failed' | 'pending' | 'rolling-back';
  application?: string;
}

const handleLogs = async (deploymentId: string) => {
  // Implementation for deployment logs via Dokploy API
};

const handleRollback = async (deploymentId: string) => {
  // Implementation for deployment rollback via Dokploy API
};
