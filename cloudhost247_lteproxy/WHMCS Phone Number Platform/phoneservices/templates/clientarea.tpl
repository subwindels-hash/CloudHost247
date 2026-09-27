<div class="phoneservices-client-wrapper">
    <div class="phoneservices-sidebar">
        <ul class="nav nav-pills nav-stacked">
            <li class="<?php echo $action === 'dashboard' ? 'active' : ''; ?>">
                <a href="{$modulelink}"><i class="fas fa-tachometer-alt"></i> Dashboard</a>
            </li>
            <li class="<?php echo $action === 'numbers' ? 'active' : ''; ?>">
                <a href="{$modulelink}&action=numbers"><i class="fas fa-phone"></i> My Numbers</a>
            </li>
            <li class="<?php echo $action === 'voip' ? 'active' : ''; ?>">
                <a href="{$modulelink}&action=voip"><i class="fas fa-microphone"></i> VoIP Calling</a>
            </li>
            <li class="<?php echo $action === 'sms' ? 'active' : ''; ?>">
                <a href="{$modulelink}&action=sms"><i class="fas fa-envelope"></i> SMS & Messaging</a>
            </li>
            <li class="<?php echo $action === 'esim' ? 'active' : ''; ?>">
                <a href="{$modulelink}&action=esim"><i class="fas fa-sim-card"></i> eSIM & Data</a>
            </li>
            <li class="<?php echo $action === 'usage' ? 'active' : ''; ?>">
                <a href="{$modulelink}&action=usage"><i class="fas fa-chart-line"></i> Usage & Billing</a>
            </li>
        </ul>
    </div>
    <div class="phoneservices-content">
        {$content}
    </div>
</div>

<style>
.phoneservices-client-wrapper {
    display: flex;
    gap: 20px;
}
.phoneservices-sidebar {
    min-width: 220px;
    max-width: 220px;
}
.phoneservices-sidebar .nav-pills > li > a {
    color: #555;
    padding: 10px 15px;
    border-radius: 4px;
}
.phoneservices-sidebar .nav-pills > li.active > a {
    background-color: #337ab7;
    color: #fff;
}
.phoneservices-content {
    flex: 1;
    min-width: 0;
}
@media (max-width: 768px) {
    .phoneservices-client-wrapper {
        flex-direction: column;
    }
    .phoneservices-sidebar {
        max-width: 100%;
        min-width: 100%;
    }
}
</style>
