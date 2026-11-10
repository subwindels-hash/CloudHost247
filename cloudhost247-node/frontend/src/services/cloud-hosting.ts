import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

export class CloudHostingService {
  // Overview
  static async getOverview(customerId: string, searchQuery?: string, filters?: any): Promise<OverviewData> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/overview`, {
      params: { customerId, searchQuery, ...filters },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  // Applications
  static async getApplications(customerId: string, searchQuery?: string, filters?: any): Promise<Application[]> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/applications`, {
      params: { customerId, searchQuery, ...filters },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  static async deployApplication(customerId: string, formData: DeployFormData): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/deploy`, {
      customerId,
      ...formData
    }, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async restartApplication(appId: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/applications/${appId}/restart`, {}, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async deleteApplication(appId: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/cloud-application-hosting/applications/${appId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  // Databases
  static async getDatabases(customerId: string, searchQuery?: string, filters?: any): Promise<Database[]> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/databases`, {
      params: { customerId, searchQuery, ...filters },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  static async createDatabase(customerId: string, formData: DatabaseFormData): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/databases`, {
      customerId,
      ...formData
    }, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async backupDatabase(dbId: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/databases/${dbId}/backup`, {}, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async deleteDatabase(dbId: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/cloud-application-hosting/databases/${dbId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  // Domains
  static async getDomains(customerId: string, searchQuery?: string, filters?: any): Promise<Domain[]> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/domains`, {
      params: { customerId, searchQuery, ...filters },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  static async connectDomain(customerId: string, formData: DomainFormData): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/domains`, {
      customerId,
      ...formData
    }, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async manageSSL(domainId: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/domains/${domainId}/ssl`, {}, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async deleteDomain(domainId: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/cloud-application-hosting/domains/${domainId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  // Environments
  static async getEnvironments(customerId: string, searchQuery?: string, filters?: any): Promise<Environment[]> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/environments`, {
      params: { customerId, searchQuery, ...filters },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  static async addEnvironment(customerId: string, formData: EnvironmentFormData): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/environments`, {
      customerId,
      ...formData
    }, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async editEnvironment(envId: string, formData: EnvironmentFormData): Promise<void> {
    await axios.put(`${API_BASE_URL}/cloud-application-hosting/environments/${envId}`, formData, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async deleteEnvironment(envId: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/cloud-application-hosting/environments/${envId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  // Deployments
  static async getDeployments(customerId: string, searchQuery?: string, filters?: any): Promise<Deployment[]> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/deployments`, {
      params: { customerId, searchQuery, ...filters },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  static async getDeploymentLogs(deploymentId: string): Promise<string> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/deployments/${deploymentId}/logs`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  static async rollbackDeployment(deploymentId: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/deployments/${deploymentId}/rollback`, {}, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  // Monitoring
  static async getMonitoringMetrics(customerId: string, filters?: any): Promise<MetricsData> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/monitoring`, {
      params: { customerId, ...filters },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  static async getResourceAlerts(resourceId: string): Promise<Alert[]> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/monitoring/${resourceId}/alerts`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  // Backups
  static async getBackups(customerId: string, searchQuery?: string, filters?: any): Promise<Backup[]> {
    const response = await axios.get(`${API_BASE_URL}/cloud-application-hosting/backups`, {
      params: { customerId, searchQuery, ...filters },
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    return response.data;
  }

  static async createBackup(customerId: string, formData: BackupFormData): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/backups`, {
      customerId,
      ...formData
    }, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async restoreBackup(backupId: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/cloud-application-hosting/backups/${backupId}/restore`, {}, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }

  static async deleteBackup(backupId: string): Promise<void> {
    await axios.delete(`${API_BASE_URL}/cloud-application-hosting/backups/${backupId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
  }
}

// Type definitions
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

interface Application {
  id: string;
  name: string;
  runtime: string;
  status: 'running' | 'stopped' | 'deploying' | 'failed';
  domain: string;
  deployment: string;
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

interface Database {
  id: string;
  name: string;
  type: 'postgresql' | 'mysql' | 'mongodb' | 'redis';
  status: 'running' | 'stopped' | 'creating' | 'failed';
  size: string;
  connection: string;
}

interface DatabaseFormData {
  name: string;
  type: 'postgresql' | 'mysql' | 'mongodb' | 'redis';
  size: string;
  credentials: {
    username: string;
    password: string;
  };
}

interface Domain {
  id: string;
  domain: string;
  status: 'active' | 'pending' | 'expired' | 'failed';
  ssl: 'valid' | 'expiring' | 'invalid' | 'none';
  application: string;
  expiration: string;
}

interface DomainFormData {
  domain: string;
  applicationId: string;
  ssl: boolean;
}

interface Environment {
  id: string;
  name: string;
  application: string;
  variables: number;
  secrets: number;
}

interface EnvironmentFormData {
  name: string;
  applicationId: string;
  variables: Record<string, string>;
  secrets: Record<string, string>;
}

interface Deployment {
  id: string;
  application: string;
  version: string;
  status: 'success' | 'failed' | 'pending' | 'rolling-back';
  date: string;
  commit: string;
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

interface Alert {
  id: string;
  resource: string;
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  date: string;
}

interface Backup {
  id: string;
  name: string;
  resource: string;
  type: 'database' | 'application' | 'full';
  date: string;
  size: string;
  status: 'success' | 'failed' | 'pending' | 'restoring';
}

interface BackupFormData {
  name: string;
  resourceId: string;
  type: 'database' | 'application' | 'full';
}
