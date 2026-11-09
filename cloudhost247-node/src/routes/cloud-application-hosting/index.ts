/**
 * Cloud Application Hosting Routes
 *
 * Customer Dashboard Section: CLOUD APPLICATION HOSTING
 * Integrates Dokploy Community Edition as backend deployment engine.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Env } from '../../config/env';
import { DokployAuthentication } from '../../integrations/dokploy/authentication';
import { DokployProjects } from '../../integrations/dokploy/projects';
import { DokployApplications } from '../../integrations/dokploy/applications';
import { DokployDatabases } from '../../integrations/dokploy/databases';
import { DokployDomains } from '../../integrations/dokploy/domains';
import { DokployEnvironments } from '../../integrations/dokploy/environments';
import { DokployDeployments } from '../../integrations/dokploy/deployments';
import { DokployMonitoring } from '../../integrations/dokploy/monitoring';
import { DokployBackups } from '../../integrations/dokploy/backups';
import type { AuthenticatedRequestContext } from '../../lib/require-auth';

export async function cloudApplicationHostingRoutes(fastify: FastifyInstance, env: Env) {
  // Initialize Dokploy integration
  const auth = new DokployAuthentication(env);
  const client = auth.getClient();
  const projectsService = new DokployProjects(client);
  const applicationsService = new DokployApplications(client);
  const databasesService = new DokployDatabases(client);
  const domainsService = new DokployDomains(client);
  const environmentsService = new DokployEnvironments(client);
  const deploymentsService = new DokployDeployments(client);
  const monitoringService = new DokployMonitoring(client);
  const backupsService = new DokployBackups(client);

  // --- OVERVIEW ---
  fastify.get('/api/cloud-hosting/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId; // From authenticated session
    
    // Get customer's Dokploy project
    const project = await projectsService.getOrCreateCustomerProject(customerId);
    
    // Aggregate metrics from Dokploy
    const applications = await client.request<any[]>(
      `/api/projects/${project.id}/applications`,
      'GET',
    );
    
    const databases = await client.request<any[]>(
      `/api/projects/${project.id}/databases`,
      'GET',
    );

    // Calculate consumption (mock implementation - would aggregate from monitoring)
    const overview = {
      totalApplications: applications.length,
      runningApplications: applications.filter(a => a.status === 'running').length,
      stoppedApplications: applications.filter(a => a.status === 'stopped').length,
      failedDeployments: applications.filter(a => a.status === 'failed').length,
      totalDatabases: databases.length,
      cpuConsumption: 0, // Would come from monitoring
      ramConsumption: 0, // Would come from monitoring
      storageConsumption: 0, // Would come from monitoring
      hostingSubscriptionStatus: 'active', // Would come from WHMCS
    };

    reply.send(overview);
  });

  // --- MY APPLICATIONS ---
  fastify.get('/api/cloud-hosting/applications', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const project = await projectsService.getOrCreateCustomerProject(customerId);
    
    const applications = await client.request<any[]>(
      `/api/projects/${project.id}/applications`,
      'GET',
    );

    reply.send(applications);
  });

  fastify.post('/api/cloud-hosting/applications', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const body = request.body as {
      name: string;
      source: { type: 'github' | 'gitlab' | 'bitbucket' | 'docker' | 'git'; repositoryUrl?: string; dockerImage?: string; branch?: string; commitSha?: string };
      runtime: 'nodejs' | 'react' | 'nextjs' | 'vue' | 'angular' | 'php' | 'laravel' | 'python' | 'django' | 'fastapi' | 'static' | 'docker';
      environmentVariables?: Record<string, string>;
    };
    const { name, source, runtime, environmentVariables } = body;
    
    const project = await projectsService.getOrCreateCustomerProject(customerId);
    
    const application = await applicationsService.deployApplication(
      project.id,
      customerId,
      name,
      source,
      runtime,
      environmentVariables,
    );

    reply.status(201).send(application);
  });

  fastify.post('/api/cloud-hosting/applications/:appId/restart', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; params: { projectId: string; appId: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId } = authCtx.params;
    
    const result = await applicationsService.restartApplication(projectId, appId, customerId);
    reply.send(result);
  });

  fastify.post('/api/cloud-hosting/applications/:appId/stop', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; params: { projectId: string; appId: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId } = authCtx.params;
    
    const result = await applicationsService.stopApplication(projectId, appId, customerId);
    reply.send(result);
  });

  fastify.post('/api/cloud-hosting/applications/:appId/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; params: { projectId: string; appId: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId } = authCtx.params;
    
    const result = await applicationsService.startApplication(projectId, appId, customerId);
    reply.send(result);
  });

  fastify.delete('/api/cloud-hosting/applications/:appId', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; params: { projectId: string; appId: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId } = authCtx.params;
    
    const result = await applicationsService.deleteApplication(projectId, appId, customerId);
    reply.send(result);
  });

  // --- DATABASE MANAGER ---
  fastify.post('/api/cloud-hosting/databases', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; body: { projectId: string; type: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'redis'; name: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, type, name } = authCtx.body;
    
    const database = await databasesService.provisionDatabase(projectId, customerId, type, name);
    reply.status(201).send(database);
  });

  // --- DOMAIN MANAGER ---
  fastify.post('/api/cloud-hosting/domains', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; body: { projectId: string; appId: string; domain: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId, domain } = authCtx.body;
    
    const result = await domainsService.connectDomain(projectId, appId, domain, customerId);
    reply.status(201).send(result);
  });

  // --- ENVIRONMENT VARIABLES ---
  fastify.put('/api/cloud-hosting/environments', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; body: { projectId: string; appId: string; variables: Record<string, string> } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId, variables } = authCtx.body;
    
    const result = await environmentsService.updateEnvironmentVariables(
      projectId,
      appId,
      variables,
      customerId,
    );
    reply.send(result);
  });

  // --- DEPLOYMENT HISTORY ---
  fastify.get('/api/cloud-hosting/deployments', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; query: { projectId: string; appId: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId } = authCtx.query;
    
    const history = await deploymentsService.getDeploymentHistory(
      projectId,
      appId,
      customerId,
    );
    reply.send(history);
  });

  fastify.get('/api/cloud-hosting/deployments/:deploymentId/logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; params: { projectId: string; appId: string; deploymentId: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId, deploymentId } = authCtx.params;
    
    const logs = await deploymentsService.getDeploymentLogs(
      projectId,
      appId,
      deploymentId,
      customerId,
    );
    reply.send(logs);
  });

  // --- MONITORING ---
  fastify.get('/api/cloud-hosting/monitoring', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; query: { projectId: string; appId: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId } = authCtx.query;
    
    const stats = await monitoringService.getApplicationStats(
      projectId,
      appId,
      customerId,
    );
    reply.send(stats);
  });

  // --- BACKUP MANAGER ---
  fastify.post('/api/cloud-hosting/backups', async (request: FastifyRequest, reply: FastifyReply) => {
    const authCtx = request as unknown as { user: AuthenticatedRequestContext; body: { projectId: string; appId: string } };
    const customerId = authCtx.user.customerId ?? authCtx.user.userId;
    const { projectId, appId } = authCtx.body;
    
    const backup = await backupsService.createManualBackup(projectId, appId, customerId);
    reply.status(201).send(backup);
  });
}
