# Dynamic routing on application servers

Customer application routing is NEVER written into Traefik's static or dynamic config files.
The deployment engine emits per-installation Docker labels:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.docker.network=cloudhost247-traefik"
  - "traefik.http.routers.<project>-app.rule=Host(`app.customer.com`)"
  - "traefik.http.routers.<project>-app.entrypoints=websecure"
  - "traefik.http.routers.<project>-app.tls=true"
  - "traefik.http.routers.<project>-app.tls.certresolver=letsencrypt"
  - "traefik.http.services.<project>-app.loadbalancer.server.port=5678"
  # HTTP → HTTPS redirect router for the same host
```

Traefik's Docker provider discovers these labels at container start, so a deployment's routing
appears and disappears with its containers — no restarts, no config files, no wildcard domains
(spec §33). See `cloudhost247-node/src/deployments/compose-generator.ts` (generation) and
`cloudhost247-node/src/deployments/adapters/docker-adapter.ts` (application via the agent).
