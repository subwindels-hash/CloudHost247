{if $errors}
    <div class="alert alert-danger" role="alert">
        {$errors[0]}, Please contact to the support!
    </div>
{else}
{assign var=unique_id value=10|mt_rand:20000000}
<link href="{$assets}/css/style.css?v={$unique_id}" rel="stylesheet">
<script src="{$assets}/js/script.js?v={$unique_id}"></script>
<script src="{$assets}/js/highcharts.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
<script src="{$assets}/js/jquerygrowl.js" type="text/javascript"></script>
<link href="{$assets}/css/jquerygrowl.css" rel="stylesheet" type="text/css" />
{if $clientareatemplate|strstr:"lagom"}
    <link href="{$assets}/css/compatible_lagom.css?v={$unique_id}" rel="stylesheet">
{elseif  $clientareatemplate|strstr:"twenty-x"}
    <link href="{$assets}/css/compatible_twenty-x.css?v={$unique_id}" rel="stylesheet">
{elseif  $clientareatemplate|strstr:"six"}
    <link href="{$assets}/css/compatible_six.css?v={$unique_id}" rel="stylesheet">
{elseif  $clientareatemplate|strstr:"clientx-child"}
    <link href="{$assets}/css/compatible_clientx_child.css?v={$unique_id}" rel="stylesheet">
{elseif $clientareatemplate eq "cloudx"}
<link href="{$assets}/css/compatible_cloudx.css?v={$unique_id}" rel="stylesheet">
{elseif $clientareatemplate eq "hostx"}
<link href="{$assets}/css/compatible_hostx.css?v={$unique_id}" rel="stylesheet">
{/if}
<div class="new-client-area-box">
    <div class="client-area-host-name justify-content-between">
        <h3>{$LANG["hostName"]} <span class="serverName">{$ovhCustomHostname|@ucfirst}</span> <span class="editServerName ml-1" data-toggle="modal" data-target="#editServerName"><i class="fas fa-pen "></i></span></h3>
        {if $serverInfo->state eq "ok" || $serverInfo->state eq "running"}
        <h3>{$LANG["state"]} : <span class="badge badge-success">{$serverInfo->state|capitalize}</span></h3>
        {else}
        <h3>{$LANG["state"]} : <span class="label label-danger">{$serverInfo->state|capitalize}</span></h3>
        {/if}
    </div>
    <div class="client-area-spec-wrapper">
        <div class="client-area-spec-box">
            <span class="client-spec-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <g clip-path="url(#clip0_6_2627)">
                        <path
                            d="M18 2H10L4 8V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V4C20 2.9 19.1 2 18 2ZM18 20H6V8.83L10.83 4H18V20ZM9 7H11V11H9V7ZM12 7H14V11H12V7ZM15 7H17V11H15V7Z"
                            fill="#1A1D1F" />
                    </g>
                    <defs>
                        <clipPath id="clip0_6_2627">
                            <rect width="24" height="24" fill="white" />
                        </clipPath>
                    </defs>
                </svg>
            </span>
            <div class="client-spec-content">
                <h4>{$LANG["memory"]}</h4>
                {math assign="memorySize" equation='x/y' x=$serverInfo->memoryLimit y="1024.00" format="%.2f"}
                <h3>{$memorySize} GB</h3>
            </div>
        </div>
        <div class="client-area-spec-box">
            <span class="client-spec-icon si-clr2">
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="27" viewBox="0 0 26 27" fill="none">
                    <g clip-path="url(#clip0_1_2252)">
                        <path
                            d="M24.375 14.3437C24.5905 14.3437 24.7971 14.2549 24.9495 14.0966C25.1019 13.9384 25.1875 13.7238 25.1875 13.5C25.1875 13.2762 25.1019 13.0616 24.9495 12.9034C24.7971 12.7451 24.5905 12.6562 24.375 12.6562H21.9375V9.28125H24.375C24.5905 9.28125 24.7971 9.19235 24.9495 9.03412C25.1019 8.87589 25.1875 8.66128 25.1875 8.4375C25.1875 8.21372 25.1019 7.99911 24.9495 7.84088C24.7971 7.68264 24.5905 7.59375 24.375 7.59375L21.8562 7.59375C21.6879 6.75456 21.2774 5.98853 20.6794 5.39765C20.0814 4.80678 19.3242 4.41911 18.5087 4.28625V1.6875C18.5087 1.46372 18.4231 1.24911 18.2708 1.09088C18.1184 0.932645 17.9117 0.84375 17.6962 0.84375C17.4808 0.84375 17.2741 0.932645 17.1217 1.09088C16.9694 1.24911 16.8837 1.46372 16.8837 1.6875V4.21875H13.8125V1.6875C13.8125 1.46372 13.7269 1.24911 13.5745 1.09088C13.4222 0.932645 13.2155 0.84375 13 0.84375C12.7845 0.84375 12.5778 0.932645 12.4255 1.09088C12.2731 1.24911 12.1875 1.46372 12.1875 1.6875V4.21875L8.75875 4.21875V1.6875C8.75875 1.46372 8.67315 1.24911 8.52077 1.09088C8.3684 0.932645 8.16174 0.84375 7.94625 0.84375C7.73076 0.84375 7.5241 0.932645 7.37173 1.09088C7.21935 1.24911 7.13375 1.46372 7.13375 1.6875V4.36219C6.39336 4.55476 5.72019 4.96004 5.19138 5.53158C4.66256 6.10313 4.29948 6.81781 4.14375 7.59375L1.625 7.59375C1.40951 7.59375 1.20285 7.68264 1.05048 7.84088C0.898102 7.99911 0.8125 8.21372 0.8125 8.4375C0.8125 8.66128 0.898102 8.87589 1.05048 9.03412C1.20285 9.19235 1.40951 9.28125 1.625 9.28125H4.0625V12.6562H1.625C1.40951 12.6562 1.20285 12.7451 1.05048 12.9034C0.898102 13.0616 0.8125 13.2762 0.8125 13.5C0.8125 13.7238 0.898102 13.9384 1.05048 14.0966C1.20285 14.2549 1.40951 14.3437 1.625 14.3437H4.0625V17.7187H1.625C1.40951 17.7187 1.20285 17.8076 1.05048 17.9659C0.898102 18.1241 0.8125 18.3387 0.8125 18.5625C0.8125 18.7863 0.898102 19.0009 1.05048 19.1591C1.20285 19.3174 1.40951 19.4062 1.625 19.4062H4.14375C4.29948 20.1822 4.66256 20.8969 5.19138 21.4684C5.72019 22.04 6.39336 22.4452 7.13375 22.6378L7.13375 25.3125C7.13375 25.5363 7.21935 25.7509 7.37173 25.9091C7.5241 26.0674 7.73076 26.1562 7.94625 26.1562C8.16174 26.1562 8.3684 26.0674 8.52077 25.9091C8.67315 25.7509 8.75875 25.5363 8.75875 25.3125L8.75875 22.7812L12.1875 22.7812V25.3125C12.1875 25.5363 12.2731 25.7509 12.4255 25.9091C12.5778 26.0674 12.7845 26.1562 13 26.1562C13.2155 26.1562 13.4222 26.0674 13.5745 25.9091C13.7269 25.7509 13.8125 25.5363 13.8125 25.3125V22.7812H16.8837V25.3125C16.8837 25.5363 16.9694 25.7509 17.1217 25.9091C17.2741 26.0674 17.4808 26.1562 17.6962 26.1562C17.9117 26.1562 18.1184 26.0674 18.2708 25.9091C18.4231 25.7509 18.5087 25.5363 18.5087 25.3125V22.7137C19.3242 22.5809 20.0814 22.1932 20.6794 21.6023C21.2774 21.0115 21.6879 20.2454 21.8562 19.4062H24.375C24.5905 19.4062 24.7971 19.3174 24.9495 19.1591C25.1019 19.0009 25.1875 18.7863 25.1875 18.5625C25.1875 18.3387 25.1019 18.1241 24.9495 17.9659C24.7971 17.8076 24.5905 17.7187 24.375 17.7187H21.9375V14.3437H24.375ZM17.875 21.0937L8.125 21.0937C7.47853 21.0937 6.85855 20.8271 6.40143 20.3524C5.94431 19.8777 5.6875 19.2338 5.6875 18.5625L5.6875 8.4375C5.6875 7.76617 5.94431 7.12234 6.40143 6.64764C6.85855 6.17293 7.47853 5.90625 8.125 5.90625L17.875 5.90625C18.5215 5.90625 19.1415 6.17293 19.5986 6.64764C20.0557 7.12234 20.3125 7.76617 20.3125 8.4375V18.5625C20.3125 19.2338 20.0557 19.8777 19.5986 20.3524C19.1415 20.8271 18.5215 21.0937 17.875 21.0937Z"
                            fill="#1A1D1F" />
                        <path
                            d="M16.25 7.59375L9.75 7.59375C9.10353 7.59375 8.48355 7.86043 8.02643 8.33514C7.56931 8.80984 7.3125 9.45367 7.3125 10.125L7.3125 16.875C7.3125 17.5463 7.56931 18.1902 8.02643 18.6649C8.48355 19.1396 9.10353 19.4062 9.75 19.4062H16.25C16.8965 19.4062 17.5165 19.1396 17.9736 18.6649C18.4307 18.1902 18.6875 17.5463 18.6875 16.875V10.125C18.6875 9.45367 18.4307 8.80984 17.9736 8.33514C17.5165 7.86043 16.8965 7.59375 16.25 7.59375ZM17.0625 16.875C17.0625 17.0988 16.9769 17.3134 16.8245 17.4716C16.6722 17.6299 16.4655 17.7188 16.25 17.7188H9.75C9.53451 17.7188 9.32785 17.6299 9.17548 17.4716C9.0231 17.3134 8.9375 17.0988 8.9375 16.875V10.125C8.9375 9.90122 9.0231 9.68661 9.17548 9.52838C9.32785 9.37014 9.53451 9.28125 9.75 9.28125L16.25 9.28125C16.4655 9.28125 16.6722 9.37014 16.8245 9.52838C16.9769 9.68661 17.0625 9.90122 17.0625 10.125V16.875Z"
                            fill="#1A1D1F" />
                    </g>
                    <defs>
                        <clipPath id="clip0_1_2252">
                            <rect width="26" height="27" fill="white" />
                        </clipPath>
                    </defs>
                </svg>
            </span>
            <div class="client-spec-content">
                <h4>{$LANG["cpu"]}</h4>
                <h3>{$serverInfo->vcore} CORE</h3>
            </div>
        </div>
        <div class="client-area-spec-box">
            <span class="client-spec-icon si-clr3">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="21" viewBox="0 0 24 21" fill="none">
                    <path
                        d="M18.5445 2.63939L18.5446 2.63952L21.5151 12.793C21.4329 12.7813 21.349 12.775 21.2632 12.775H2.73684C2.65104 12.775 2.56713 12.7813 2.48489 12.793L5.45544 2.63955C5.45544 2.63954 5.45545 2.63953 5.45545 2.63952C5.51758 2.4275 5.70206 2.2875 5.91411 2.2875H18.0859C18.2937 2.2875 18.4836 2.43022 18.5445 2.63939ZM19.5263 15.7437H18.9474C18.57 15.7437 18.2684 16.0567 18.2684 16.4375C18.2684 16.8183 18.57 17.1313 18.9474 17.1313H19.5263C19.9037 17.1313 20.2053 16.8183 20.2053 16.4375C20.2053 16.0567 19.9037 15.7437 19.5263 15.7437ZM16.0526 15.7437H15.4737C15.0963 15.7437 14.7947 16.0567 14.7947 16.4375C14.7947 16.8183 15.0963 17.1313 15.4737 17.1313H16.0526C16.43 17.1313 16.7316 16.8183 16.7316 16.4375C16.7316 16.0567 16.43 15.7437 16.0526 15.7437ZM2.25789 18.2188V15.8438V14.6562C2.25789 14.3825 2.47601 14.1625 2.73684 14.1625H21.2632C21.524 14.1625 21.7421 14.3825 21.7421 14.6562V18.2188C21.7421 18.4925 21.524 18.7125 21.2632 18.7125H2.73684C2.47601 18.7125 2.25789 18.4925 2.25789 18.2188ZM2.73684 20.1H21.2632C22.2783 20.1 23.1 19.2536 23.1 18.2188V13.8167C23.1 13.5187 23.0582 13.2231 22.9744 12.9372C22.9744 12.9372 22.9744 12.9371 22.9744 12.9371L19.8446 2.24269C19.6149 1.45324 18.8925 0.9 18.0859 0.9H5.91411C5.09472 0.9 4.38852 1.44139 4.15535 2.24268L1.02571 12.9344C1.0257 12.9345 1.02569 12.9345 1.02567 12.9346C0.941786 13.2173 0.9 13.5142 0.9 13.8167V18.2188C0.9 19.2536 1.72167 20.1 2.73684 20.1Z"
                        fill="#1A1D1F" stroke="#1A1D1F" stroke-width="0.2" />
                </svg>
            </span>
            <div class="client-spec-content">
                <h4>{$LANG["disk"]}</h4>
                <h3>{$serverInfo->model->disk} GB</h3>
            </div>
        </div>
        <div class="client-area-spec-box">
            <span class="client-spec-icon si-clr4">
                <svg xmlns="http://www.w3.org/2000/svg" width="23" height="23" viewBox="0 0 23 23" fill="none">
                    <g clip-path="url(#clip0_1_2268)">
                        <path
                            d="M7.87001 11.243C7.87001 9.46624 8.70411 7.88451 9.99954 6.8662L8.0168 3.69269C6.35513 4.88612 5.10478 6.61347 4.51489 8.62417C5.43835 9.21854 6.05075 10.2571 6.05075 11.4374C6.05075 12.5759 5.48473 13.5796 4.61586 14.1838C5.25008 16.0884 6.48598 17.7188 8.09814 18.8504L9.94211 15.5707C8.67866 14.5528 7.87001 12.9922 7.87001 11.243Z"
                            fill="#1A1D1F" />
                        <path
                            d="M5.11367 11.4374C5.11367 12.7651 4.03541 13.8422 2.70801 13.8422C1.37995 13.8422 0.30249 12.7651 0.30249 11.4374C0.30249 10.1103 1.37995 9.0332 2.70801 9.0332C4.03541 9.0332 5.11367 10.1103 5.11367 11.4374Z"
                            fill="#1A1D1F" />
                        <path
                            d="M18.6218 17.2527C19.1812 17.2527 19.7079 17.3896 20.1707 17.6326C21.6122 16.1134 22.5436 14.1088 22.6977 11.8885L18.9617 11.8162C18.6741 14.6182 16.3069 16.8011 13.4298 16.8011C12.6335 16.8011 11.8735 16.6336 11.1877 16.3306L9.33057 19.5797C10.5686 20.1889 11.9584 20.5312 13.4298 20.5312C14.0647 20.5312 14.6874 20.4669 15.2875 20.3444C15.4155 18.6164 16.8591 17.2527 18.6218 17.2527Z"
                            fill="#1A1D1F" />
                        <path
                            d="M21.0259 20.5959C21.0259 21.9234 19.9499 23 18.6218 23C17.2936 23 16.2168 21.9234 16.2168 20.5959C16.2168 19.2674 17.2936 18.191 18.6218 18.191C19.9499 18.191 21.0259 19.2674 21.0259 20.5959Z"
                            fill="#1A1D1F" />
                        <path
                            d="M20.4264 5.13454C19.8821 5.51999 19.216 5.74811 18.4967 5.74811C16.6491 5.74811 15.1531 4.25174 15.1531 2.40525C15.1531 2.30717 15.1575 2.21232 15.1648 2.11713C14.6031 2.0096 14.0226 1.95441 13.4297 1.95441C11.9447 1.95441 10.5403 2.30391 9.29565 2.92289L11.1419 6.17415C11.8401 5.85961 12.6145 5.68267 13.4297 5.68267C16.2814 5.68267 18.6318 7.83032 18.953 10.5963L22.6889 10.4823C22.5239 8.44258 21.6978 6.5898 20.4264 5.13454Z"
                            fill="#1A1D1F" />
                        <path
                            d="M20.9001 2.40529C20.9001 3.73339 19.8262 4.81015 18.4967 4.81015C17.1686 4.81015 16.0918 3.73339 16.0918 2.40529C16.0918 1.07709 17.1686 0 18.4966 0C19.8262 0 20.9001 1.07709 20.9001 2.40529Z"
                            fill="#1A1D1F" />
                    </g>
                    <defs>
                        <clipPath id="clip0_1_2268">
                            <rect width="23" height="23" fill="white" />
                        </clipPath>
                    </defs>
                </svg>
            </span>
            <div class="client-spec-content">
                <h4>{$LANG["os"]}</h4>
                <h3 class="topOs"></h3>
            </div>
        </div>
    </div>
    <div class="ca-content-wrapper">
        <div class="row gutter-10">
            <div class="col-md-6">
                <div class="ca-content-bx">
                    <h6>{$LANG["finance"]}</h6>
                    <p>{$LANG["paidBefore"]} <span>{$params["model"]->nextduedate}</span>
                    </p>
                    <h4>${$params["model"]->amount}</h4>
                    <div class="ca-content-table-bx">
                        <table>
                            <tr>
                                <td>
                                    <p>{$LANG["orderDate"]}</p>
                                </td>
                                <td>
                                    <p>
                                        <span>{$params["model"]->regdate}</span>
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <p>{$LANG["nextPayment"]}</p>
                                </td>
                                <td>
                                    <p>
                                        <span>Until {$params["model"]->nextduedate}</span>
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    <p>{$LANG["billingCycle"]}</p>
                                </td>
                                <td>
                                    <p>
                                        <span>{$params["model"]->billingcycle}</span>
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="ca-content-bx">
                    <h6>{$LANG["networkHeading"]}</h6>
                    <p>{$LANG["networkSubHeading"]}</p>
                    <div class="copyIP">
                        <h4 class="ipv4Copy"></h4>
                        <input type="hidden" value="{$ipParts[0]}" id="myInput">
                        <!-- The button used to copy the text -->
                        <div class="customtooltip">
                            <i class="fas fa-copy" onclick="copyText(this)" onmouseout="updateText()"></i>
                            <span class="tooltiptext" id="myTooltip">Copy to clipboard</span>
                        </div>
                    </div>
                    <div class="ca-content-table-bx">
                        <div class="connected-box-main">
                            <p>{$LANG["networkstatus"]}</p>
                            <div class="connected-box">
                                <span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="10" viewBox="0 0 11 10"
                                        fill="none">
                                        <circle cx="5.20895" cy="4.93942" r="4.93942" fill="#59C189" />
                                    </svg>
                                </span>
                                {if $serverInfo->state == "ok" ||$serverInfo->state == "running"}
                                Connected
                                {else}
                                Disconnected
                                {/if}
                            </div>
                        </div>
                        <div class="connected-graph-bx">
                            <svg xmlns="http://www.w3.org/2000/svg" width="83" height="79" viewBox="0 0 83 79"
                                fill="none">
                                <mask id="mask0_3_2324" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0"
                                    width="83" height="79">
                                    <path fill-rule="evenodd" clip-rule="evenodd"
                                        d="M14.4158 66.3821V71.2673C14.4158 75.295 11.171 78.5948 7.20541 78.5948C3.23983 78.5948 0 75.295 0 71.2673V66.3821C0 62.3495 3.24485 59.0495 7.20541 59.0495C11.166 59.0495 14.4158 62.3493 14.4158 66.3821ZM30.0719 39.5092C26.1065 39.5092 22.8614 42.8042 22.8614 46.8368V71.2671C22.8614 75.2948 26.1063 78.5946 30.0719 78.5946C34.0375 78.5946 37.2773 75.2948 37.2773 71.2671V46.8368C37.2773 42.8042 34.0324 39.5092 30.0719 39.5092ZM52.9333 19.9641C48.9679 19.9641 45.7279 23.259 45.7279 27.2916V71.2671C45.7279 75.2948 48.9679 78.5946 52.9333 78.5946C56.8987 78.5946 60.1387 75.2948 60.1387 71.2671V27.2916C60.1387 23.259 56.8987 19.9641 52.9333 19.9641ZM75.7946 0.418762C71.8292 0.418762 68.5892 3.71861 68.5892 7.7463V71.2671C68.5892 75.2948 71.8292 78.5946 75.7946 78.5946C79.76 78.5946 83 75.2948 83 71.2671V7.74648C83 3.71878 79.76 0.418762 75.7946 0.418762Z"
                                        fill="#FFBC99" />
                                </mask>
                                <g mask="url(#mask0_3_2324)">
                                    <rect x="-9.81128" y="-9.84845" width="27.6864" height="99.0882" fill="#AFDCC3" />
                                    <rect x="17.2075" y="-9.70319" width="24.2927" height="99.1951" fill="#FFBC99" />
                                    <rect x="41.1899" y="-9.84845" width="27.6864" height="99.0882" fill="#2280FF" />
                                    <rect x="63.0479" y="-8.39124" width="27.6864" height="99.0882" fill="#474F5A" />
                                </g>
                            </svg>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-12">
                <div class="ca-content-bx tab-inner-bx">
                    <h6>Accessibilities</h6>
                    <!-- <p>here’s what happening with your Host today</p> -->
                    <div class="Access-cards-wrapper">
                        <ul class="nav nav-tabs mainTab">
                            <li class="active"><a data-toggle="tab" href="#detail">{$LANG["tabDetails"]}</a></li>
                            {if $aclSettingsVps["Power"] neq "on" && !"power"|in_array:$enableSettingsAddon}
                            <li><a data-toggle="tab" data-menuname="power" href="#power">{$LANG["tabPower"]}</a></li>
                            {/if}
                            {if $aclSettingsVps["IMPI_Console"] neq "on"&& !"impiConsole"|in_array:$enableSettingsAddon}
                            <li><a data-toggle="tab" data-menuname="impi" href="#impi">{$LANG["tabIMPI"]}
                                    {$LANG["console"]}</a></li>
                            {/if}
                            {if $aclSettingsVps["Network_Usage"] neq "on" &&
                            !"networkUsage"|in_array:$enableSettingsAddon}
                            <li><a data-toggle="tab" data-menuname="usage" href="#usage">{$LANG["tabUsage"]}</a></li>
                            {/if}
                            {if $aclSettingsVps["Monitoring"] neq "on" && !"monitoring"|in_array:$enableSettingsAddon}
                            <li><a data-toggle="tab" data-menuname="monitoring"
                                    href="#monitoring">{$LANG["tabMonitoring"]}</a></li>
                            {/if}
                            {if $aclSettingsVps["Manage_IPs"] neq "on" && !"manageIps"|in_array:$enableSettingsAddon}
                            <li><a data-toggle="tab" data-menuname="manage_ips"
                                    href="#manage_ips">{$LANG["tabManageIPs"]}</a></li>
                            {/if}
                            {if $aclSettingsVps["Manage_Snapshot"] neq "on" && !"manageSnapshot"|in_array:$enableSettingsAddon}
                            <li><a data-toggle="tab" data-menuname="snapshot"
                                    href="#snapshot">{$LANG["snapshotManage"]}</a></li>
                            {/if}
                            <!-- <li><a data-toggle="tab" data-menuname="disk" href="#disk">{$LANG["disk"]}</a></li> -->
                            <!-- <li><a data-toggle="tab" data-menuname="ftp_backup"
                                    href="#ftp_backup">{$LANG["tabFTPBackup"]}</a>
                            </li> -->
                            {if $aclSettingsVps["Automated_Backup"] neq "on" && !"automatedBackup"|in_array:$enableSettingsAddon}
                                <li><a data-toggle="tab" data-menuname="automated_backup" href="#automated_backup">Automated Backup</a></li>
                            {/if}
                        </ul>
                        <div class="tab-content">
                            <div id="detail" class="tab-pane fade in active show">
                                <ul class="nav nav-tabs subTab">
                                    <li class="active"><a data-toggle="tab" data-type="service" href="#serverDetailInfo"
                                            class="">Service Info</a></li>
                                    <li><a data-toggle="tab" data-type="hardware_info" href="#hardware_info">Hardware
                                            Info</a></li>
                                </ul>
                                <div class="tab-content">
                                    <div class="serverDetailInfo tab-pane fade in active show"
                                        id="serverDetailInfo">
                                        <div class="row">
                                            <div class="col-2">
                                                <strong>Server {$LANG["name"]}</strong>
                                            </div>
                                            <div class="col-4">
                                                <span class="customServerName">{$ovhCustomHostname|@ucfirst}
                                                </span>
                                            </div>
                                            <div class="col"></div>
                                        </div>
                                        <div class="row">
                                            <div class="col-2">
                                                <strong>{$LANG["datacenter"]}</strong>
                                            </div>
                                            <div class="col-4">
                                                <span class="dataCenter"></span>
                                            </div>
                                            <div class="col"></div>
                                        </div>
                                        <div class="row">
                                            <div class="col-2">
                                                <strong>IPv4</strong>
                                            </div>
                                            <div class="col-4">
                                                <span class="getIps ip4"></span>
                                            </div>
                                            <div class="col"></div>
                                        </div>
                                        <div class="row">
                                            <div class="col-2">
                                                <strong>IPv6</strong>
                                            </div>
                                            <div class="col-4">
                                                <span class="getIps ip6"></span>
                                            </div>
                                            <div class="col"></div>
                                        </div>
                                        <div class="row">
                                            <div class="col-2">
                                                <strong>{$LANG["os"]}</strong>
                                            </div>
                                            <div class="col-4">
                                                <span class="opetaingSystem"></span>
                                            </div>
                                            <div class="col"></div>
                                        </div>
                                        <div class="row">
                                            <div class="col-2">
                                                <strong>Model</strong>
                                            </div>
                                            <div class="col-4">
                                                <span class="">{$serverInfo->model->offer} </span>
                                            </div>
                                            <div class="col"></div>
                                        </div>
                                        <div class="row">
                                            <div class="col-2">
                                                <strong>{$LANG["monitoring"]}</strong>
                                            </div>
                                            <div class="col-4">
                                                {if $serverInfo->slaMonitoring eq ""}
                                                <span class="label label-default">{$LANG["monitoring_disable"]}</span>
                                                {else}
                                                <span class="label label-success">{$LANG["monitoring_enable"]}</span>
                                                {/if}
                                            </div>
                                            <div class="col"></div>
                                        </div>
                                        <div class="row">
                                            <div class="col-2">
                                                <strong>Zone</strong>
                                            </div>
                                            <div class="col-4">
                                                <span class="">{$serverInfo->zone} </span>
                                            </div>
                                            <div class="col"></div>
                                        </div>
                                    </div>
                                    <div class="serverDetailInfo tab-pane fade" id="hardware_info">
                                        <div class="row">
                                            <div class="col-3">
                                                <strong>{$LANG["memorySize"]}</strong>
                                            </div>
                                            <div class="col">
                                                {if $serverInfo->model->memory <= 1024} <span>
                                                    {$serverInfo->model->memory}
                                                    MB</span>
                                                    {else}
                                                    <span>{$serverInfo->model->memory/1024} GB</span>
                                                    {/if}
                                            </div>
                                        </div>
                                        <div class="row">
                                            <div class="col-3">
                                                <strong>{$LANG["vpsservide_ram"]}</strong>
                                            </div>
                                            <div class="col">
                                                {math assign="memorySize" equation='x/y' x=$serverInfo->memoryLimit
                                                y="1024.00"}
                                                <span>{$memorySize} GB</span>
                                            </div>
                                        </div>
                                        <div class="row">
                                            <div class="col-3">
                                                <strong>{$LANG["vpsservide_disk"]}</strong>
                                            </div>
                                            <div class="col">
                                                <span>{$serverInfo->model->disk} GB</span>
                                            </div>
                                        </div>
                                        <div class="row">
                                            <div class="col-3">
                                                <strong>{$LANG["diskType"]}</strong>
                                            </div>
                                            <div class="col">
                                                <span style="text-transform: uppercase;">{$serverInfo->offerType}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div id="power" class="tab-pane fade text-center">
                                <ul class="nav nav-tabs subTab">
                                    {if $aclSettingsVps["Power_OnOff"] neq "on" &&
                                    !"powerOnOff"|in_array:$enableSettingsAddon}
                                    <li data-type="onOff" class="active"><a data-toggle="tab" data-type="onOff"
                                            href="#onOff">{$LANG["onOff"]}</a></li>
                                    {/if}
                                    {if $aclSettingsVps["Reboot"] neq "on" && !"reboot"|in_array:$enableSettingsAddon}
                                    <li><a data-toggle="tab" href="#reboot">{$LANG["reboot"]}</a></li>
                                    {/if}
                                    {if $aclSettingsVps["NetBoot"] neq "on" && !"netboot"|in_array:$enableSettingsAddon}
                                    <li data-type="netBoot"><a data-toggle="tab" data-type="netBoot"
                                            href="#netBoot">{$LANG["netBoot"]}</a></li>
                                    {/if}
                                    {if $aclSettingsVps["Reinstall"] neq "on" && !"reinstall"|in_array:$enableSettingsAddon}
                                        <li data-type="reinstall"><a id="reinstallBt" data-toggle="tab" data-type="reinstall" href="#reinstall">Reinstall</a></li>
                                    {/if}
                                </ul>
                                <div class="tab-content">
                                    <div class="tab-pane fade in active show" id="onOff">
                                        {if $serverInfo->state eq "ok" || $serverInfo->state eq "running"}
                                        <p class="powerNotes">{$LANG["offMessage"]} </p>
                                        <button class="btn btn-danger serverOnOff" data-action="stop">{$LANG["offBtn"]}
                                        </button>
                                        {else}
                                        <p class="powerNotes">{$LANG["onMessage"]} </p>
                                        <button class="btn btn-success serverOnOff" data-action="start">{$LANG["onBtn"]}
                                        </button>
                                        {/if}
                                    </div>
                                    <div class="tab-pane fade" id="reboot">
                                        <p class="powerNotes">{$LANG["reboot_msg"]} </p>
                                        <button class="btn btn-success rebootBtn">{$LANG["reboot"]} </button>
                                    </div>
                                    <div class="tab-pane fade" id="netBoot">
                                        <div class="netBootType row">
                                            <div class="col-md-4">{$LANG["netBootTypeText"]} </div>
                                            <div class="col-md-6">
                                                <select class="form-control" id="netBootType">
                                                    <option value="local">{$LANG["local"]}</option>
                                                    <option value="rescue">{$LANG["rescue"]}</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div class="tab-content">
                                            <div class="" id="hardDisk">
                                                <p class="hardDiskNotes">{$LANG["netbootmsg"]} </p>
                                                <button class="btn btn-success netbootBtn">{$LANG["bootnow_btn"]}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="reinstall">
                                        <form id="installOsForm">
                                            <div class="reinstall row">
                                                <div class="col-md-4">Choose Template</div>
                                                <div class="col-md-6">
                                                    <select class="form-control" id="reinstallopt">
                                                        <option value="" disabled selected>loading...</option>
                                                    </select>
                                                </div>
                                            </div>
                                            {* <div class="reinstallssh row">
                                                <div class="col-md-4">SSH Key</div>
                                                <div class="col-md-6">
                                                    <input type="text" class="ssh-field form-control"></input>
                                                </div>
                                            </div> *}
                                            <div class="progress" style="display: none;">
                                                <div class="progress-done" data-done="0" style="width: 0%; opacity: 1;">0%</div>
                                            </div>
                                            <div class="tab-content">
                                                <div class="" id="reinstallbtn">
                                                    <button type="button" class="btn btn-success installBtn">Reinstall</button>
                                                </div>
                                            </div>
                                        </form>
                                    </div>
                                </div>
                            </div>
                            <div id="usage" class="tab-pane fade">
                                <div class="ca-content-bx">
                                    <div class="usageHeader">
                                        <h6>{$LANG["usageHeader"]} </h6>
                                        <p>{$LANG["usageHeaderMess"]}</p>
                                    </div>
                                    <div class="usage-main-sec">
                                        <div class="grapoptiondiv mtrGraghOption mt-3 mb-2">
                                            <div class="grapoptioninnerdiv">
                                                <select name="" class="mrtg form-control" id="mrtg1">
                                                    <option value="cpu:used">{$LANG.cpu_used}</option>
                                                    <option value="cpu:max">{$LANG.cpu_max}</option>
                                                    <option value="mem:used">{$LANG.mem_used}</option>
                                                    <option value="mem:max">{$LANG.mem_max}</option>
                                                    <option value="net:tx">{$LANG.net_tx}</option>
                                                    <option value="net:rx">{$LANG.net_rx}</option>
                                                </select>
                                            </div>
                                            <div class="grapoptioninnerdiv">
                                                <select name="" class="mrtg form-control" id="mrtg3">
                                                    <option value="today">{$LANG.mrtgtoday}</option>
                                                    <option value="lastday">{$LANG.mrtglastday}</option>
                                                    <option value="lastweek">{$LANG.mrtgWeekly}</option>
                                                    <option value="lastmonth">{$LANG.mrtgMonthly}</option>
                                                    <option value="lastyear">{$LANG.mrtgYearly}</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div id="graphdivmain" class="text-center">
                                        <div id="mrtggraphdiv" style="width:100%; height:auto;">
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div id="disk" class="tab-pane fade"></div>
                            <div id="manage_ips" class="tab-pane fade"></div>
                            <div id="interventions" class="tab-pane fade text-center"></div>
                            <div id="ftp_backup" class="tab-pane fade text-center"></div>
                            <div id="monitoring" class="tab-pane fade">
                                <div class="impitest" style="text-align: center;">
                                    <h3 class="text-left">{$LANG["monitoringHeading"]}</h3>
                                    <p class="subHeading"> {$LANG["monitoringSubHeading"]}</p>
                                    <div class="monitoring-custom">
                                        <div class="monitoring-custom-inner {if !$serverInfo->slaMonitoring} active {/if}"
                                            data-action="disable">
                                            <span class="monitoring-checkbox"></span>
                                            <div class="monitoring-checkbox-content">
                                                <h5>{$LANG["monitoringDisabled"]}</h5>
                                                <p>{$LANG["monitoringDisabledMess"]}</p>
                                            </div>
                                        </div>
                                        <div class="monitoring-custom-inner {if $serverInfo->slaMonitoring} active {/if}"
                                            data-action="Enable">
                                            <span class="monitoring-checkbox"></span>
                                            <div class="monitoring-checkbox-content">
                                                <h5>{$LANG["monitoringEnable"]}</h5>
                                                <p>{$LANG["monitoringEnableMess"]}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <button class="btn btn-success mb-3" data-type="monitoring"
                                        onclick="enableDisablMonitoring()">{$LANG["monitoringbtn"]}</button>
                                </div>
                            </div>
                            <div id="impi" class="tab-pane fade text-center">
                                <ul class="nav nav-tabs subTab">
                                    <li class="active"><a data-toggle="tab" href="#console"
                                            class="">{$LANG["serverConsolebtn"]}</a></li>
                                    </li>
                                </ul>
                                <div class="tab-content">
                                    <div class="tab-pane fade in active show" id="Console">
                                        {$LANG["browserImpiMessage"]}
                                        <button class="btn btn-success consoleBtn">{$LANG["console"]}</button>
                                    </div>
                                </div>
                            </div>
                            <div id="snapshot" class="tab-pane fade text-center">
                            </div>
                            <div id="automated_backup" class="tab-pane fade text-center">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
<!-- Modal -->
<div class="modal fade" id="enableACLFtp" tabindex="-1" role="dialog" aria-labelledby="enableACLFtpTitle"
    aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="ftpEnableForm">
                <div class="modal-header">
                    <h5 class="modal-title" id="enableACLFtpTitle">{$LANG.modal_title}</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="staticEmail" class="col-form-label">{$LANG.ip_blocks}</label>
                        <div class="modal-input-upper">
                            <input type="text" name="ipBlock" class="form-control" id="ipBlock" value="" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="staticEmail" class="col-form-label">{$LANG.cifs} (*)</label>
                        <div class="modal-input">
                            <input type="checkbox" class="form-check-input" id="Cifs" name="cifs" checked>{$LANG.cifs}
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="staticEmail" class="col-form-label">{$LANG.bkp_ftp}</label>
                        <div class="modal-input">
                            <input type="checkbox" class="form-check-input" id="FTP" name="ftp">{$LANG.ftpacl}
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="staticEmail" class="col-form-label">{$LANG.nfs}</label>
                        <div class="modal-input">
                            <input type="checkbox" class="form-check-input" id="Nfs" name="nfs" checked>{$LANG.nfsacl}
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">{$LANG.close}</button>
                    <button type="button" class="btn btn-primary enableACL">{$LANG.save_change}</button>
                </div>
            </form>
        </div>
    </div>
</div>
<div class="modal fade" id="addIpDescriptions" tabindex="-1" role="dialog" aria-labelledby="addIpDescriptionsTitle">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="addIpDescriptionsForm">
                <div class="modal-header">
                    <h5 class="modal-title" id="addIpDescriptionsTitle">{$LANG["addIpDescModalHeading"]}</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="addIpDesc" class="col-form-label">{$LANG["addIpDescModallabel"]}</label>
                        <div class="modal-input">
                            <textarea class="form-control" id="addIpDesc" rows="3"></textarea>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">{$LANG["close"]}</button>
                    <button type="button" class="btn btn-primary updateIPDesc">{$LANG["monitoringbtn"]}</button>
                </div>
            </form>
        </div>
    </div>
</div>
{* add reverse ip *}
<div class="modal fade" id="addReverseIp" tabindex="-1" role="dialog" aria-labelledby="addReverseIpTitle">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="addReverseIpForm">
                <div class="modal-header">
                    <h5 class="modal-title" id="addReverseIpTitle">{$LANG["addReverseIPModalHeading"]}</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-info" role="alert" style="text-align: left;font-size: 14px;">
                        {$LANG["addReverseMessage"]}</div>
                    <div class="form-group">
                        <label for="addIpReverseIPAddress"
                            class="col-form-label">{$LANG["addReverseIPAddlabel"]}</label>
                        <div class="modal-input">
                            <input type="text" class="form-check form-control" id="addIpReverseIPAddress"
                                style="width: 100%;" readonly>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="addIpReverse" class="col-form-label">{$LANG["addReverseIPModallabel"]}</label>
                        <div class="modal-input">
                            <input type="text" class="form-check form-control" id="addIpReverse" style="width: 100%;"
                                placeholder="yourdomainname">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">{$LANG["close"]}</button>
                    <button type="button" class="btn btn-primary updateIPReverse">{$LANG["monitoringbtn"]}</button>
                </div>
            </form>
        </div>
    </div>
</div>
{* get firewall rules *}
<div class="modal fade" id="getFirewallRules" tabindex="-1" role="dialog" aria-labelledby="getFirewallRulesTitle">
    <div class="modal-dialog">
        <div class="modal-content">
            <form id="getFirewallRulesForm">
                <div class="modal-header">
                    <h5 class="modal-title" id="getFirewallRulesTitle">{$LANG["getRuleModalHeading"]} <span
                            class="firewallName"> </span></h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <button type="button" class="btn btn-primary showModal">{$LANG["addRuleModalHeading"]}</button>
                <div id="firewaAddllRules" style="display: none;">
                    <div class="form-row">
                        <div class="form-group col-md-6">
                            <label for="firewallSequence">{$LANG["addRuleSequence"]}</label>
                            <select class="form-control" id="firewallSequence" name="firewallSequence">
                                <option value="0">0</option>
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3">3</option>
                                <option value="4">4</option>
                                <option value="5">5</option>
                                <option value="6">6</option>
                                <option value="7">7</option>
                                <option value="8">8</option>
                                <option value="9">9</option>
                                <option value="10">10</option>
                                <option value="11">11</option>
                                <option value="12">12</option>
                                <option value="13">13</option>
                                <option value="14">14</option>
                                <option value="15">15</option>
                                <option value="16">16</option>
                                <option value="17">17</option>
                                <option value="18">18</option>
                                <option value="19">19</option>
                            </select>
                        </div>
                        <div class="form-group col-md-6">
                            <label for="firewallAction">{$LANG["addRuleAction"]}</label>
                            <select class="form-control" id="firewallAction" name="firewallAction">
                                <option value="permit">PERMIT</option>
                                <option value="deny">DENY</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group col-md-6">
                            <label for="firewallProtocol">{$LANG["addRuleProtocol"]}</label>
                            <select class="form-control" id="firewallProtocol" name="firewallProtocol">
                                <option value="ah">AH</option>
                                <option value="esp">ESP</option>
                                <option value="gre">GRE</option>
                                <option value="icmp">ICMP</option>
                                <option value="ipv4">IPv4</option>
                                <option value="tcp">TCP</option>
                                <option value="udp">UDP</option>
                            </select>
                        </div>
                        <div class="form-group col-md-6">
                            <label for="firewallSourse">{$LANG["addRuleSource"]}</label>
                            <input type="number" class="form-control" id="firewallSourse" name="firewallSourse" min="0">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group col-md-6">
                            <label for="firewallDestinationPort">{$LANG["addRuleDestinationPort"]}</label>
                            <input type="number" class="form-control" name="firewallDestinationPort"
                                id="firewallDestinationPort" min="0">
                        </div>
                        <div class="form-group col-md-6">
                            <label for="firewallSourcePort">{$LANG["addRuleSourcePort"]}</label>
                            <input type="number" class="form-control" name="firewallSourcePort" id="firewallSourcePort"
                                min="0">
                        </div>
                    </div>
                    <div class="form-row onlyWithTCP" style="display: none;">
                        <div class="form-group col-md-6">
                            <label for="firewallOption">{$LANG["addRuleOption"]}</label>
                            <select class="form-control" name="firewallOption" id="firewallOption">
                                <option value="">None</option>
                                <option value="established">Established</option>
                                <option value="syn">SYN</option>
                            </select>
                        </div>
                        <div class="form-group col-md-6">
                            <input type="checkbox" class="" name="firewallFragements" id="firewallFragements" min="0">
                            <label for="firewallFragements">{$LANG["addRuleFragements"]}</label>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group col-md-12">
                            <button type="button"
                                class="btn btn-primary addDirewallRule float-right">{$LANG["monitoringbtn"]}</button>
                        </div>
                    </div>
                </div>
                <div class="modal-body">
                    <table class="table table-hover" id="getFirewallRulesTable">
                        <thead>
                            <tr>
                                <th>{$LANG["getRuleTblHeadingPriotrity"]}</th>
                                <th>{$LANG["getRuleTblHeadingAction"]}</th>
                                <th>{$LANG["getRuleTblHeadingProtocol"]}</th>
                                <th>{$LANG["getRuleTblHeadingSourceIp"]}</th>
                                <th>{$LANG["getRuleTblHeadingSourcePort"]}</th>
                                <th>{$LANG["getRuleTblHeadingDestPort"]}</th>
                                <th>{$LANG["getRuleTblHeadingOptions"]}</th>
                                <th>{$LANG["getRuleTblHeadingStatus"]}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                        </tbody>
                    </table>
                </div>
            </form>
        </div>
    </div>
</div>
{* view Ip details *}
<div class="modal fade" id="viewIpDetails" tabindex="-1" role="dialog" aria-labelledby="viewIpDetailsTitle"
    aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="viewIpDetailsForm">
                <div class="modal-header">
                    <h5 class="modal-title" id="viewIpDetailsTitle">{$LANG["viewIpDetailModalHeading"]} <span
                            id="viewIpDetailsIpBlock"></span> </h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="mainSec">
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                    </div>
                </div>
            </form>
        </div>
    </div>
</div>
{* Additinal IP *}
<div class="modal fade" id="additinalIpModalCenter" tabindex="-1" role="dialog"
    aria-labelledby="additinalIpModalCenterTitle" aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="addReverseIpForm">
                <div class="modal-header">
                    <h5 class="modal-title" id="additinalIpModalLongTitle">{$LANG["additinalIpModalHeading"]}</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="additionalIp" class="col-form-label">{$LANG["numberOfIp"]}</label>
                        <div class="modal-input">
                            <input type="number" class="form-control" id="additionalIp" min="1" value="1"
                                style="width: 100%;"
                                data-perIpPrice="{$aditionalIpPrice->additionalIPprice * $clientCurrency[" rate"]}"
                                data-currencyCode="{$clientCurrency[" prefix"]}">
                            <div class="form-text">{$LANG["numberOfIpMessage"]} : {$aditionalIpPrice->additionalIPprice
                                * $clientCurrency["rate"]}
                                * <span id="ipPrices"> 1 = {$aditionalIpPrice->additionalIPprice *
                                    $clientCurrency["rate"]}{$clientCurrency["prefix"]} </span></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary addAdditionalIp">Confirm</button>
                    </div>
                </div>
            </form>
        </div>
    </div>
</div>
{* create snapshot *}
<div class="modal fade" id="snapshotCreateBtn" tabindex="-1" role="dialog" aria-labelledby="snapshotCreateBtnTitle"
    aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="snapshotCreate">
                <div class="modal-header">
                    <h5 class="modal-title" id="additinalIpModalLongTitle">Create snapshot</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span
                            aria-hidden="true">&times;</span> </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="snapshotDesc" class="col-form-label">{$LANG["snapshotDesc"]}</label>
                        <div class="modal-input">
                            <textarea class="form-control" id="snapshotDesc" rows="3"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary snapshotCreate">Confirm</button>
                    </div>
                </div>
            </form>
        </div>
    </div>
</div>
{* edit snpshot *}
<div class="modal fade" id="editSnapshot" tabindex="-1" role="dialog" aria-labelledby="editSnapshotTitle"
    aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="snapshotedit">
                <div class="modal-header">
                    <h5 class="modal-title">{$LANG["snapshoteditDesc"]}</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span
                            aria-hidden="true">&times;</span> </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="snapshoteditDesc" class="col-form-label">{$LANG["snapshotDesc"]}</label>
                        <div class="modal-input">
                            <textarea class="form-control" id="snapshoteditDesc" rows="3"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary snapshoteditDesc">Confirm</button>
                    </div>
                </div>
            </form>
        </div>
    </div>
</div>
{* edit custom server name *}
<div class="modal fade" id="editServerName" tabindex="-1" role="dialog" aria-labelledby="editServerNameTitle"
    aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="serverNameEdit">
                <div class="modal-header">
                    <h5 class="modal-title">Edit/Update Server Name</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span
                            aria-hidden="true">&times;</span> </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="customServerName" class="col-form-label">Enter Server Name</label>
                        <div class="modal-input">
                           <input type="text" name="customServerName" value="" class="form-control" id="customServerName"> 
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary updateServerName">Confirm</button>
                    </div>
                </div>
            </form>
        </div>
    </div>
</div>
{* add reverse ip for IPv6 *}
<div class="modal fade" id="addReverseIp6" tabindex="-1" role="dialog" aria-labelledby="addReverseIp6Title">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="addReverseIp6Form">
                <div class="modal-header">
                    <h5 class="modal-title" id="addReverseIp6Title">{$LANG["addReverseIP6ModalHeading"]}</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-info" role="alert" style="text-align: left;font-size: 14px;">
                        {$LANG["addReverseMessage"]}</div>
                    <div class="form-group">
                        <label for="addIpReverseIP6Address" class="col-form-label">{$LANG["addReverseIPAddlabel"]}</label>
                        <div class="modal-input">
                            <input type="text" class="form-check form-control" id="addIpReverseIP6Address" style="width: 100%;" readonly>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="ipAddress6" class="col-form-label">{$LANG["ipAddress6label"]}</label>
                        <div class="modal-input">
                            <input type="text" class="form-check form-control" id="ipAddress6" style="width: 100%;"name="ipAddress6" placeholder="Enter IPv6 Address" >
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="addIp6Reverse" class="col-form-label">{$LANG["addReverseIPModallabel"]}</label>
                        <div class="modal-input">
                            <input type="text" class="form-check form-control" id="addIp6Reverse" style="width: 100%;" placeholder="yourdomainname">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
                    <button type="button" class="btn btn-primary updateIP6Reverse">Confirm</button>
                </div>
            </form>
        </div>
    </div>
</div>
{/if}