{if $hostx_blocks[$block_slug]}
   <div class="tabs-sec {if $hostx_theme_settings.enable_sticky_header eq 'on'}tabs-sticky{/if}">
      {eval var=$hostx_blocks[$block_slug]->description}
      <div class="container">
         <div class="tab-content">
            {foreach $hostx_blocks[$block_slug]->widgets as $widget}
               {eval var=$widget->widget_description|html_entity_decode}
            {/foreach}
         </div>
      </div>
   </div>
{else}
<div class="tabs-sec {if $hostx_theme_settings.enable_sticky_header eq 'on'}tabs-sticky{/if}">
   <ul class="nav nav-tabs" role="tablist">
      <li class="nav-item active">
         <a class="nav-link" data-toggle="tab" href="#featureTabBlock">Features</a>
      </li>
      <li class="nav-item">
         <a class="nav-link" data-toggle="tab" href="#compareTabBlock">Compare</a>
      </li>
      <li class="nav-item">
         <a class="nav-link" data-toggle="tab" href="#faqTabBlock">FAQ</a>
      </li>
   </ul>
   <div class="container">
      <div class="tab-content">
         <div id="featureTabBlock" class="container tab-pane active">
            <table>
               <tbody>
                  <tr>
                     <th width="40%" class="first-th">Plan feature</th>
                     <th width="20%">
                        <p>signal</p>
                        <span>$1.99/mo</span>
                     </th>
                     <th width="20%">
                        <p>Premium</p>
                        <span>$2.99/mo</span>
                     </th>
                     <th width="20%">
                        <p>Busniess</p>
                        <span>$4.99/mo</span>
                     </th>
                  </tr>
                  <tr>
                     <td class="first-b">Bandwidth <i class="fa fa-question-circle-o" aria-hidden="true"></i></td>
                     <td>100GB</td>
                     <td>Unlimited</td>
                     <td>Unlimited</td>
                  </tr>
                  <tr>
                     <td class="first-b">MySql Databases <i class="fa fa-question-circle-o" aria-hidden="true"></i></td>
                     <td>2</td>
                     <td>Unlimited</td>
                     <td>Unlimited</td>
                  </tr>
                  <tr>
                     <td class="first-b">Free Domain Registration <i class="fa fa-question-circle-o" aria-hidden="true"></i></td>
                     <td><i class="fa fa-remove"></i></td>
                     <td><i class="fa fa-check"></i></td>
                     <td><i class="fa fa-check"></i></td>
                  </tr>
                  <tr>
                     <td class="first-b">Free SSL Certificates <i class="fa fa-question-circle-o" aria-hidden="true"></i></td>
                     <td><i class="fa fa-check"></i></td>
                     <td><i class="fa fa-check"></i></td>
                     <td><i class="fa fa-check"></i></td>
                  </tr>
                  <tr>
                     <td class="first-b">Daily Backups <i class="fa fa-question-circle-o" aria-hidden="true"></i></td>
                     <td><i class="fa fa-remove"></i></td>
                     <td><i class="fa fa-remove"></i></td>
                     <td><i class="fa fa-check"></i></td>
                  </tr>
                  <tr>
                     <td class="first-b">Email Accounts <i class="fa fa-question-circle-o" aria-hidden="true"></i></td>
                     <td>1</td>
                     <td>100</td>
                     <td>100</td>
                  </tr>
                  <tr>
                     <td class="first-b">99.9% uptime Guarantee <i class="fa fa-question-circle-o" aria-hidden="true"></i></td>
                     <td><i class="fa fa-check"></i></td>
                     <td><i class="fa fa-check"></i></td>
                     <td><i class="fa fa-check"></i></td>
                  </tr>
               </tbody>
               <tfoot class="thead-inverse">
                  <tr>
                     <th width="40%"></th>
                     <th><a href="#" class="btn btn-primary compare-blk-btn">Select</a></th>
                     <th><a  href="#" class="btn btn-primary compare-blk-btn">Select</a></th>
                     <th><a  href="#" class="btn btn-primary compare-blk-btn">Select</a></th>
                     <th></th>
                  </tr>
               </tfoot>
            </table>
         </div>
         <div id="compareTabBlock" class="container tab-pane fade">
            <h3>Linux Plan details:</h3>
            <div class="plan-detail">
               <table>
                  <tbody>
                     <tr>
                        <th width="40%" class="first-th"></th>
                        <th width="20%">
                           <p>Economy</p>
                        </th>
                        <th width="20%">
                           <p>Deluxe</p>
                        </th>
                        <th width="20%">
                           <p>Ultimate</p>
                        </th>
                     </tr>
                     <tr>
                        <td class="first-b">Free domain with annual plan</td>
                        <td><i class="fa fa-check"></i></td>
                        <td><i class="fa fa-check"></i></td>
                        <td><i class="fa fa-check"></i></td>
                     </tr>
                     <tr>
                        <td class="first-b">Websites </td>
                        <td>1</td>
                        <td>Unlimited</td>
                        <td>Unlimited</td>
                     </tr>
                     <tr>
                        <td class="first-b">NVMe SSD Storage</td>
                        <td>100GB</td>
                        <td>Unlimited</td>
                        <td>Unlimited</td>
                     </tr>
                     <tr>
                        <td class="first-b">Monthly bandwidth</td>
                        <td>Unmetered</td>
                        <td>Unmetered</td>
                        <td>Unmetered</td>
                     </tr>
                     <tr>
                        <td class="first-b">Shared CPU</td>
                        <td>1</td>
                        <td>1</td>
                        <td>2</td>
                     </tr>
                     <tr>
                        <td class="first-b">Memory</td>
                        <td>512MB</td>
                        <td>512MB</td>
                        <td>1 GB</td>
                     </tr>
                  </tbody>
               </table>
            </div>
         </div>
         <div id="faqTabBlock" class="container tab-pane fade">
            <div class="accordion-container-main faq">
               <div class="accordion md-accordion" id="accordionEx1" role="tablist" aria-multiselectable="true">
                  <div class="card">
                     <div class="card-header" role="tab" id="headingTwo1">
                        <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#faq1" aria-expanded="false" aria-controls="collapseTwo">
                           <h5 class="mb-0">What is an SSL Certificate?</h5>
                        </a>
                     </div>
                     <div id="faq1" class="collapse" role="tabpanel" aria-labelledby="headingTwo1" data-parent="#accordionEx1">
                        <div class="card-body">Yes all websites created with the Weebly site builder are optimised for mobile.</div>
                     </div>
                  </div>
                  <div class="card current">
                     <div class="card-header" role="tab" id="headingTwo2">
                        <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#faq2" aria-expanded="false" aria-controls="collapseTwo1">
                           <h5 class="mb-0">What is the benefit of SSL?</h5>
                        </a>
                     </div>
                     <div id="faq2" class="collapse" role="tabpanel" aria-labelledby="headingTwo2" data-parent="#accordionEx1">
                        <div class="card-body">Yes all websites created with the Weebly site builder are optimised for mobile.</div>
                     </div>
                  </div>
                  <div class="card">
                     <div class="card-header" role="tab" id="headingTwo3">
                        <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#faq3" aria-expanded="false" aria-controls="collapseThree">
                           <h5 class="mb-0">Does SSL work in all web browsers?</h5>
                        </a>
                     </div>
                     <div id="faq3" class="collapse" role="tabpanel" aria-labelledby="headingTwo3" data-parent="#accordionEx1">
                        <div class="card-body">Yes all websites created with the Weebly site builder are optimised for mobile.</div>
                     </div>
                  </div>
                  <div class="card">
                     <div class="card-header" role="tab" id="headingTwo4">
                        <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#faq4" aria-expanded="false" aria-controls="headingfour">
                           <h5 class="mb-0">How do I apply for an SSL?</h5>
                        </a>
                     </div>
                     <div id="faq4" class="collapse" role="tabpanel" aria-labelledby="headingTwo4" data-parent="#accordionEx1">
                        <div class="card-body">Yes all websites created with the Weebly site builder are optimised for mobile.</div>
                     </div>
                  </div>
                  <div class="card">
                     <div class="card-header" role="tab" id="headingTwo5">
                        <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#faq5" aria-expanded="false" aria-controls="collapsefive">
                           <h5 class="mb-0">How do I generate a Certificate Signing Request (CSR)?</h5>
                        </a>
                     </div>
                     <div id="faq5" class="collapse" role="tabpanel" aria-labelledby="headingTwo5" data-parent="#accordionEx1">
                        <div class="card-body">Yes all websites created with the Weebly site builder are optimised for mobile.</div>
                     </div>
                  </div>
                  <div class="card">
                     <div class="card-header" role="tab" id="headingTwo6">
                        <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#faq6" aria-expanded="false" aria-controls="collapsesix">
                           <h5 class="mb-0">What Kind of Web Hosting Plan Do I Need?</h5>
                        </a>
                     </div>
                     <div id="faq6" class="collapse" role="tabpanel" aria-labelledby="headingTwo6" data-parent="#accordionEx1">
                        <div class="card-body">Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.</div>
                     </div>
                  </div>
                  <div class="card">
                     <div class="card-header" role="tab" id="headingTwo7">
                        <a class="collapsed" data-toggle="collapse" data-parent="#accordionEx1" href="#faq7" aria-expanded="false" aria-controls="collapseseven">
                           <h5 class="mb-0">How do i purchase a dedicated hosting ?</h5>
                        </a>
                     </div>
                     <div id="faq7" class="collapse" role="tabpanel" aria-labelledby="headingTwo7" data-parent="#accordionEx1">
                        <div class="card-body">Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.</div>
                     </div>
                  </div>
               </div>
            </div>
         </div>
      </div>
   </div>
</div>
{/if}