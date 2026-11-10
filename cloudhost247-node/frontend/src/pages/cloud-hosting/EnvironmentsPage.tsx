import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthenticatedUser } from '../../hooks/useAuthenticatedUser';
import { CloudHostingService } from '../../services/cloud-hosting';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ErrorBoundary } from '../../components/AppErrorBoundary';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { SearchBar } from '../../components/SearchBar';
import { FilterBar } from '../../components/FilterBar';

export default function CloudHostingEnvironmentsPage() {
  usePageMeta('Environment Variables', 'Manage environment variables and secrets with Dokploy.');

  const { user } = useAuthenticatedUser();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterOptions>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await CloudHostingService.getEnvironments(user.id, searchQuery, filters);
        setEnvironments(result);
      } catch (err) {
        setError(err.message || 'Failed to load environments');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.id, searchQuery, filters]);

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="cloud-hosting-environments">
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--developers">
        <div className="ch247-hero__inner">
          <h1>Environment Variables</h1>
          <p>Manage environment variables and secrets with Dokploy.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <div className="ch247-action-bar">
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search environments..." />
            <FilterBar filters={filters} onChange={setFilters} />
            <Button to="/dashboard/cloud-hosting/environments/add" variant="primary">Add Environment</Button>
          </div>

          <Table 
            columns={[
              { key: 'name', label: 'Environment Name', sortable: true },
              { key: 'application', label: 'Application', sortable: true },
              { key: 'variables', label: 'Variables', sortable: false },
              { key: 'secrets', label: 'Secrets', sortable: false },
              { key: 'actions', label: 'Actions', sortable: false }
            ]}
            data={environments}
            rowKey="id"
            renderCell={(column, row) => {
              switch (column.key) {
                case 'actions':
                  return (
                    <div className="action-buttons">
                      <Button size="small" variant="secondary" to={`/dashboard/cloud-hosting/environments/${row.id}`}>View</Button>
                      <Button size="small" variant="secondary" onClick={() => handleEdit(row.id)}>Edit</Button>
                      <Button size="small" variant="danger" onClick={() => handleDelete(row.id)}>Delete</Button>
                    </div>
                  );
                case 'variables':
                  return <span className="variable-count">{row.variables}</span>;
                case 'secrets':
                  return <span className="secret-count">{row.secrets}</span>;
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

interface Environment {
  id: string;
  name: string;
  application: string;
  variables: number;
  secrets: number;
}

interface FilterOptions {
  application?: string;
}

const handleEdit = async (envId: string) => {
  // Implementation for environment editing via Dokploy API
};

const handleDelete = async (envId: string) => {
  // Implementation for environment deletion via Dokploy API
};
