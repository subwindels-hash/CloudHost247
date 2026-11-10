import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthenticatedUser } from '../../hooks/useAuthenticatedUser';
import { CloudHostingService } from '../../services/cloud-hosting';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ErrorBoundary } from '../../components/AppErrorBoundary';
import { Form } from '../../components/Form';
import { Select } from '../../components/Select';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { StepIndicator } from '../../components/StepIndicator';

export default function CloudHostingDeployPage() {
  usePageMeta('Deploy Application', 'Connect your repository and deploy with Dokploy.');

  const { user } = useAuthenticatedUser();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<DeployFormData>({
    repository: '',
    branch: 'main',
    runtime: 'node',
    name: '',
    environment: 'production',
    resources: { cpu: '1', memory: '1GB', storage: '5GB' }
  });

  const steps = [
    { label: 'Repository', description: 'Connect GitHub, GitLab, or Bitbucket' },
    { label: 'Configuration', description: 'Runtime, environment, and resources' },
    { label: 'Review & Deploy', description: 'Confirm settings and start deployment' }
  ];

  const handleNext = async () => {
    setLoading(true);
    setError(null);
    try {
      if (step === 1) {
        // Validate repository connection
        await CloudHostingService.validateRepository(formData.repository);
        setStep(2);
      } else if (step === 2) {
        // Validate configuration
        await CloudHostingService.validateConfiguration(formData);
        setStep(3);
      } else if (step === 3) {
        // Start deployment
        await CloudHostingService.deployApplication(user.id, formData);
        // Redirect to applications page
        window.location.href = '/dashboard/cloud-hosting/applications';
      }
    } catch (err) {
      setError(err.message || 'Deployment failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="cloud-hosting-deploy">
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--developers">
        <div className="ch247-hero__inner">
          <h1>Deploy Application</h1>
          <p>Connect your repository and deploy with Dokploy.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <StepIndicator steps={steps} currentStep={step} />

          <Form onSubmit={handleNext}>
            {step === 1 && (
              <div className="deploy-step">
                <h2>Connect Repository</h2>
                <Input 
                  label="Repository URL" 
                  value={formData.repository} 
                  onChange={(e) => setFormData({...formData, repository: e.target.value})}
                  placeholder="https://github.com/user/repo.git"
                  required
                />
                <Input 
                  label="Branch" 
                  value={formData.branch} 
                  onChange={(e) => setFormData({...formData, branch: e.target.value})}
                  placeholder="main"
                />
              </div>
            )}

            {step === 2 && (
              <div className="deploy-step">
                <h2>Configuration</h2>
                <Select 
                  label="Runtime" 
                  value={formData.runtime} 
                  onChange={(e) => setFormData({...formData, runtime: e.target.value})}
                  options={[
                    { label: 'Node.js', value: 'node' },
                    { label: 'Python', value: 'python' },
                    { label: 'PHP', value: 'php' },
                    { label: 'Docker', value: 'docker' }
                  ]}
                />
                <Input 
                  label="Application Name" 
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="my-app"
                  required
                />
                <Select 
                  label="Environment" 
                  value={formData.environment} 
                  onChange={(e) => setFormData({...formData, environment: e.target.value})}
                  options={[
                    { label: 'Production', value: 'production' },
                    { label: 'Staging', value: 'staging' },
                    { label: 'Development', value: 'development' }
                  ]}
                />
                <div className="resource-config">
                  <h3>Resource Limits</h3>
                  <Input 
                    label="CPU (cores)" 
                    type="number"
                    value={formData.resources.cpu} 
                    onChange={(e) => setFormData({...formData, resources: {...formData.resources, cpu: e.target.value}})}
                  />
                  <Input 
                    label="Memory (GB)" 
                    type="number"
                    value={formData.resources.memory} 
                    onChange={(e) => setFormData({...formData, resources: {...formData.resources, memory: e.target.value}})}
                  />
                  <Input 
                    label="Storage (GB)" 
                    type="number"
                    value={formData.resources.storage} 
                    onChange={(e) => setFormData({...formData, resources: {...formData.resources, storage: e.target.value}})}
                  />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="deploy-step">
                <h2>Review & Deploy</h2>
                <div className="deploy-summary">
                  <h3>Repository</h3>
                  <p>{formData.repository}</p>
                  <h3>Branch</h3>
                  <p>{formData.branch}</p>
                  <h3>Runtime</h3>
                  <p>{formData.runtime}</p>
                  <h3>Application Name</h3>
                  <p>{formData.name}</p>
                  <h3>Environment</h3>
                  <p>{formData.environment}</p>
                  <h3>Resources</h3>
                  <p>CPU: {formData.resources.cpu} cores, Memory: {formData.resources.memory} GB, Storage: {formData.resources.storage} GB</p>
                </div>
              </div>
            )}

            <div className="deploy-actions">
              {step > 1 && <Button variant="secondary" onClick={handleBack}>Back</Button>}
              {step < 3 && <Button type="submit">Next</Button>}
              {step === 3 && <Button type="submit" variant="primary">Deploy</Button>}
            </div>
          </Form>
        </div>
      </section>
    </div>
  );
}

interface DeployFormData {
  repository: string;
  branch: string;
  runtime: string;
  name: string;
  environment: string;
  resources: {
    cpu: string;
    memory: string;
    storage: string;
  };
}
