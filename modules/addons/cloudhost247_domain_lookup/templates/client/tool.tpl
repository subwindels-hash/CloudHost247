{* CloudHost247 Domain Lookup - Individual Tool Page *}
{* Displays the active tool interface *}

<div class="cloudhost247-domain-lookup-container">
    <div class="cloudhost247-domain-lookup-header">
        <a href="index.php?m=cloudhost247_domain_lookup" class="cloudhost247-domain-lookup-back">
            <i class="fa fa-arrow-left"></i> Back to Tools
        </a>
    </div>
    
    {* Domain WHOIS Tool *}
    {if $tool == 'domain_whois'}
    <div class="cloudhost247-tool-section" id="tool-domain-whois">
        <div class="cloudhost247-tool-header">
            <h2><i class="fa fa-globe"></i> Domain WHOIS Lookup</h2>
            <p>Look up registration details for any domain name including registrar, dates, name servers, and status.</p>
        </div>
        
        <div class="cloudhost247-tool-form">
            <div class="form-group">
                <div class="input-group input-group-lg">
                    <span class="input-group-addon"><i class="fa fa-globe"></i></span>
                    <input type="text" class="form-control" id="whois-domain" placeholder="Enter domain name (e.g., example.com)">
                    <span class="input-group-btn">
                        <button class="btn btn-primary" type="button" id="btn-whois-lookup">
                            <i class="fa fa-search"></i> Lookup
                        </button>
                    </span>
                </div>
                <span class="help-block">Enter a domain name without http:// or www</span>
            </div>
        </div>
        
        <div class="cloudhost247-tool-loading hidden" id="whois-loading">
            <div class="cloudhost247-spinner"></div>
            <p>Looking up domain information...</p>
        </div>
        
        <div class="cloudhost247-tool-error hidden alert alert-danger" id="whois-error"></div>
        
        <div class="cloudhost247-tool-results hidden" id="whois-results">
            <div class="cloudhost247-results-header">
                <h4><i class="fa fa-list-alt"></i> WHOIS Results</h4>
                <span class="cloudhost247-source-badge" id="whois-source"></span>
                <span class="cloudhost247-cache-badge hidden" id="whois-cached"><i class="fa fa-clock-o"></i> Cached</span>
            </div>
            
            <div class="cloudhost247-results-body">
                <div class="row">
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-globe"></i> Domain</label>
                            <div class="cloudhost247-result-value" id="whois-result-domain"></div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-building"></i> Registrar</label>
                            <div class="cloudhost247-result-value" id="whois-result-registrar"></div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-calendar-plus-o"></i> Creation Date</label>
                            <div class="cloudhost247-result-value" id="whois-result-creation"></div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-calendar-times-o"></i> Expiry Date</label>
                            <div class="cloudhost247-result-value" id="whois-result-expiry"></div>
                        </div>
                    </div>
                </div>
                
                <div class="cloudhost247-result-item">
                    <label><i class="fa fa-server"></i> Name Servers</label>
                    <div class="cloudhost247-result-value" id="whois-result-nameservers"></div>
                </div>
                
                <div class="cloudhost247-result-item">
                    <label><i class="fa fa-tag"></i> Domain Status</label>
                    <div class="cloudhost247-result-value" id="whois-result-status"></div>
                </div>
                
                <div class="cloudhost247-result-item cloudhost247-raw-whois">
                    <label>
                        <i class="fa fa-file-text-o"></i> Raw WHOIS 
                        <button class="btn btn-xs btn-default" id="btn-toggle-raw"><i class="fa fa-eye"></i> Show/Hide</button>
                    </label>
                    <pre class="cloudhost247-raw-data hidden" id="whois-result-raw"></pre>
                </div>
            </div>
        </div>
    </div>
    {/if}
    
    {* IP Lookup Tool *}
    {if $tool == 'ip_whois'}
    <div class="cloudhost247-tool-section" id="tool-ip-whois">
        <div class="cloudhost247-tool-header">
            <h2><i class="fa fa-map-marker"></i> IP Address Lookup</h2>
            <p>Get detailed information about any IP address including location, ISP, organization, and ASN details.</p>
        </div>
        
        <div class="cloudhost247-tool-form">
            <div class="form-group">
                <div class="input-group input-group-lg">
                    <span class="input-group-addon"><i class="fa fa-map-marker"></i></span>
                    <input type="text" class="form-control" id="ip-address" placeholder="Enter IP address (e.g., 8.8.8.8 or type 'me' for your IP)">
                    <span class="input-group-btn">
                        <button class="btn btn-primary" type="button" id="btn-ip-lookup">
                            <i class="fa fa-search"></i> Lookup
                        </button>
                    </span>
                </div>
                <span class="help-block">Enter an IPv4 or IPv6 address, or type "me" to lookup your own IP</span>
            </div>
        </div>
        
        <div class="cloudhost247-tool-loading hidden" id="ip-loading">
            <div class="cloudhost247-spinner"></div>
            <p>Looking up IP information...</p>
        </div>
        
        <div class="cloudhost247-tool-error hidden alert alert-danger" id="ip-error"></div>
        
        <div class="cloudhost247-tool-results hidden" id="ip-results">
            <div class="cloudhost247-results-header">
                <h4><i class="fa fa-list-alt"></i> IP Information</h4>
                <span class="cloudhost247-source-badge" id="ip-source"></span>
                <span class="cloudhost247-cache-badge hidden" id="ip-cached"><i class="fa fa-clock-o"></i> Cached</span>
            </div>
            
            <div class="cloudhost247-results-body">
                <div class="row">
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-laptop"></i> IP Address</label>
                            <div class="cloudhost247-result-value" id="ip-result-address"></div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-building"></i> ISP / Organization</label>
                            <div class="cloudhost247-result-value" id="ip-result-isp"></div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-map-pin"></i> Country</label>
                            <div class="cloudhost247-result-value" id="ip-result-country"></div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-city"></i> City / Region</label>
                            <div class="cloudhost247-result-value" id="ip-result-city"></div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-sitemap"></i> ASN</label>
                            <div class="cloudhost247-result-value" id="ip-result-asn"></div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-clock-o"></i> Timezone</label>
                            <div class="cloudhost247-result-value" id="ip-result-timezone"></div>
                        </div>
                    </div>
                </div>
                
                <div class="row">
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-map"></i> Latitude</label>
                            <div class="cloudhost247-result-value" id="ip-result-lat"></div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="cloudhost247-result-item">
                            <label><i class="fa fa-map"></i> Longitude</label>
                            <div class="cloudhost247-result-value" id="ip-result-lon"></div>
                        </div>
                    </div>
                </div>
                
                <div class="cloudhost247-result-item">
                    <label><i class="fa fa-envelope"></i> Postal Code</label>
                    <div class="cloudhost247-result-value" id="ip-result-postal"></div>
                </div>
            </div>
        </div>
    </div>
    {/if}
    
    {* DNS Lookup Tool *}
    {if $tool == 'dns_lookup'}
    <div class="cloudhost247-tool-section" id="tool-dns-lookup">
        <div class="cloudhost247-tool-header">
            <h2><i class="fa fa-server"></i> DNS Lookup</h2>
            <p>Query DNS records for any domain including A, AAAA, MX, NS, TXT, CNAME, SOA, and more.</p>
        </div>
        
        <div class="cloudhost247-tool-form">
            <div class="row">
                <div class="col-md-8">
                    <div class="form-group">
                        <div class="input-group input-group-lg">
                            <span class="input-group-addon"><i class="fa fa-globe"></i></span>
                            <input type="text" class="form-control" id="dns-domain" placeholder="Enter domain name (e.g., example.com)">
                        </div>
                    </div>
                </div>
                <div class="col-md-2">
                    <div class="form-group">
                        <select class="form-control input-lg" id="dns-type">
                            <option value="ALL">All Records</option>
                            <option value="A">A</option>
                            <option value="AAAA">AAAA</option>
                            <option value="MX">MX</option>
                            <option value="NS">NS</option>
                            <option value="TXT">TXT</option>
                            <option value="CNAME">CNAME</option>
                            <option value="SOA">SOA</option>
                            <option value="PTR">PTR</option>
                            <option value="SRV">SRV</option>
                            <option value="CAA">CAA</option>
                        </select>
                    </div>
                </div>
                <div class="col-md-2">
                    <button class="btn btn-primary btn-lg btn-block" type="button" id="btn-dns-lookup">
                        <i class="fa fa-search"></i> Lookup
                    </button>
                </div>
            </div>
        </div>
        
        <div class="cloudhost247-tool-loading hidden" id="dns-loading">
            <div class="cloudhost247-spinner"></div>
            <p>Querying DNS records...</p>
        </div>
        
        <div class="cloudhost247-tool-error hidden alert alert-danger" id="dns-error"></div>
        
        <div class="cloudhost247-tool-results hidden" id="dns-results">
            <div class="cloudhost247-results-header">
                <h4><i class="fa fa-list-alt"></i> DNS Records</h4>
                <span class="cloudhost247-source-badge">PHP DNS</span>
                <span class="cloudhost247-cache-badge hidden" id="dns-cached"><i class="fa fa-clock-o"></i> Cached</span>
                <span class="cloudhost247-count-badge" id="dns-count"></span>
            </div>
            
            <div class="cloudhost247-results-body">
                <div class="table-responsive">
                    <table class="table table-striped table-hover cloudhost247-dns-table" id="dns-records-table">
                        <thead>
                            <tr>
                                <th>Type</th>
                                <th>Name</th>
                                <th>Value</th>
                                <th>TTL</th>
                                <th>Priority / Extra</th>
                            </tr>
                        </thead>
                        <tbody id="dns-records-body">
                        </tbody>
                    </table>
                </div>
                
                <div class="cloudhost247-dns-empty hidden" id="dns-no-records">
                    <div class="alert alert-info">
                        <i class="fa fa-info-circle"></i> No records found for the selected type.
                    </div>
                </div>
            </div>
        </div>
    </div>
    {/if}
    
    {* Domain Availability Tool *}
    {if $tool == 'availability'}
    <div class="cloudhost247-tool-section" id="tool-availability">
        <div class="cloudhost247-tool-header">
            <h2><i class="fa fa-search"></i> Domain Availability</h2>
            <p>Check if a domain name is available for registration across multiple popular TLDs.</p>
        </div>
        
        <div class="cloudhost247-tool-form">
            <div class="form-group">
                <div class="input-group input-group-lg">
                    <span class="input-group-addon"><i class="fa fa-globe"></i></span>
                    <input type="text" class="form-control" id="avail-domain" placeholder="Enter domain name without TLD (e.g., mycompany)">
                    <span class="input-group-btn">
                        <button class="btn btn-primary" type="button" id="btn-avail-check">
                            <i class="fa fa-search"></i> Check
                        </button>
                    </span>
                </div>
                <span class="help-block">Enter the domain name without extension (e.g., "mycompany" not "mycompany.com")</span>
            </div>
            
            <div class="cloudhost247-tld-selection">
                <label>Select TLDs to check (max 10):</label>
                <div class="cloudhost247-tld-grid" id="tld-grid">
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="com" checked> .com</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="net" checked> .net</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="org" checked> .org</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="io"> .io</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="co"> .co</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="info"> .info</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="biz"> .biz</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="us"> .us</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="me"> .me</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="ca"> .ca</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="uk"> .uk</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="eu"> .eu</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="de"> .de</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="fr"> .fr</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="au"> .au</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="nl"> .nl</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="in"> .in</label>
                    <label class="cloudhost247-tld-checkbox"><input type="checkbox" value="es"> .es</label>
                </div>
            </div>
        </div>
        
        <div class="cloudhost247-tool-loading hidden" id="avail-loading">
            <div class="cloudhost247-spinner"></div>
            <p>Checking domain availability across TLDs... <span id="avail-progress"></span></p>
        </div>
        
        <div class="cloudhost247-tool-error hidden alert alert-danger" id="avail-error"></div>
        
        <div class="cloudhost247-tool-results hidden" id="avail-results">
            <div class="cloudhost247-results-header">
                <h4><i class="fa fa-list-alt"></i> Availability Results</h4>
                <span class="cloudhost247-source-badge" id="avail-source"></span>
            </div>
            
            <div class="cloudhost247-results-body">
                <div class="cloudhost247-avail-grid" id="avail-grid">
                </div>
            </div>
        </div>
    </div>
    {/if}
    
    <input type="hidden" id="cloudhost247-csrf-token" value="{$csrfToken}">
</div>
