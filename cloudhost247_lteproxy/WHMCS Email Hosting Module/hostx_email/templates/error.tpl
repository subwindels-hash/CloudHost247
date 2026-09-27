{* HostX Email Module - Client Area Error Template *}
{* Displays error messages in a user-friendly format *}

<div class="hostx-email-error">
    <div class="row">
        <div class="col-md-12">
            <div class="card border-danger mb-4">
                <div class="card-header bg-danger text-white">
                    <h5 class="mb-0">
                        <i class="fas fa-exclamation-triangle mr-2"></i>
                        Service Unavailable
                    </h5>
                </div>
                <div class="card-body text-center">
                    <div class="error-icon mb-4">
                        <i class="fas fa-envelope-open-text text-muted" style="font-size: 4rem;"></i>
                    </div>
                    
                    <h4 class="text-muted mb-3">Unable to Load Email Service</h4>
                    
                    {if $error_message}
                        <div class="alert alert-danger">
                            <i class="fas fa-times-circle mr-2"></i>
                            {$error_message}
                        </div>
                    {else}
                        <p class="text-muted">
                            We're currently experiencing issues loading your email service details.<br>
                            This is usually temporary. Please try again in a few moments.
                        </p>
                    {/if}
                    
                    <div class="mt-4">
                        <button onclick="window.location.reload();" class="btn btn-primary mr-2">
                            <i class="fas fa-sync-alt mr-2"></i>Retry
                        </button>
                        <a href="supporttickets.php" class="btn btn-outline-secondary">
                            <i class="fas fa-life-ring mr-2"></i>Contact Support
                        </a>
                    </div>
                    
                    {if $service_id}
                        <hr class="my-4">
                        <small class="text-muted">
                            Service ID: {$service_id} | 
                            Provider: {$provider_name|default:'Unknown'}
                        </small>
                    {/if}
                </div>
            </div>
            
            {* Troubleshooting Tips *}
            <div class="card">
                <div class="card-header">
                    <h6 class="mb-0">
                        <i class="fas fa-lightbulb mr-2 text-warning"></i>
                        Troubleshooting Tips
                    </h6>
                </div>
                <div class="card-body">
                    <ul class="list-unstyled mb-0">
                        <li class="mb-2">
                            <i class="fas fa-check text-success mr-2"></i>
                            Check if your subscription is active in the <a href="clientarea.php?action=services">Services</a> page
                        </li>
                        <li class="mb-2">
                            <i class="fas fa-check text-success mr-2"></i>
                            If your account was recently created, it may take a few minutes to activate
                        </li>
                        <li class="mb-2">
                            <i class="fas fa-check text-success mr-2"></i>
                            Ensure your domain DNS records are configured correctly
                        </li>
                        <li class="mb-2">
                            <i class="fas fa-check text-success mr-2"></i>
                            Try accessing your email directly through the provider's website
                        </li>
                        <li>
                            <i class="fas fa-check text-success mr-2"></i>
                            If the issue persists, please <a href="supporttickets.php?action=open">open a support ticket</a>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</div>

<style type="text/css">
    .hostx-email-error .card {
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .hostx-email-error .error-icon {
        opacity: 0.5;
    }
    .hostx-email-error .list-unstyled li {
        padding: 0.25rem 0;
    }
</style>
