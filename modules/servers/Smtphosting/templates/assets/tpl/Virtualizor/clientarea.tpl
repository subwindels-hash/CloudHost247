<div class="row">
    <div class="col-lg-12 center-block">
        {if $data}
            <table class="table">
                <div class="panel-heading">
                    <b>{$MGLANG->T('Virtualizor','information')}</b>
                </div>

                <tr>
                    <td>{$MGLANG->T('Virtualizor', 'status')}</td>
                    <td>
                        {if $data['status']}
                            <span style="color: green; font-weight: bold;">{$MGLANG->T('Virtualizor', 'statusOnline')}</span>
                        {else}
                            <span style="color: red; font-weight: bold;">{$MGLANG->T('Virtualizor', 'statusOffline')}</span>
                        {/if}
                    </td>
                </tr>
                {if $data['hostname']}
                    <tr>
                        <td>{$MGLANG->T('Virtualizor', 'hostname')}</td>
                        <td>{$data['hostname']}</td>
                    </tr>
                {/if}
                {if $data['cpu']['limit']}
                    <tr>
                        <td>{$MGLANG->T('Virtualizor', 'cpu')}</td>
                        <td>{$data['cpu']['used']} / {$data['cpu']['limit']}{$MGLANG->T('Virtualizor', 'MHz')} ({number_format($data['cpu']['used']/$data['cpu']['limit'] * 100, 2)}%)</td>
                    </tr>
                {/if}
                {if $data['ram']['limit']}
                    <tr>
                        <td>{$MGLANG->T('Virtualizor', 'ram')}</td>
                        <td>{$data['ram']['used']} / {$data['ram']['limit']}{$MGLANG->T('Virtualizor', 'MB')} ({number_format($data['ram']['used']/$data['ram']['limit'] * 100, 2)}%)</td>
                    </tr>
                {/if}
                {if $data['disk']['disk']['limit']}
                    <tr>
                        <td>{$MGLANG->T('Virtualizor', 'disk')}</td>
                        <td>{$data['disk']['disk']['used']} / {$data['disk']['disk']['limit']}{$MGLANG->T('Virtualizor', 'MB')} ({number_format($data['disk']['disk']['used']/$data['disk']['disk']['limit']*100, 2)}%)</td>
                    </tr>
                {/if}
                {if $data['disk']['inodes']['limit']}
                    <tr>
                        <td>{$MGLANG->T('Virtualizor', 'inodes')}</td>
                        <td>{$data['disk']['inodes']['used']}
                            / {$data['disk']['inodes']['limit']}{$MGLANG->T('Virtualizor', 'MB')} ({number_format($data['disk']['inodes']['used'] / $data['disk']['inodes']['limit'] * 100, 2)}%)
                        </td>
                    </tr>
                {/if}
                {if $data['bandwidth']['limit']}
                    <tr>
                        <td>{$MGLANG->T('Virtualizor', 'bandwidth')}</td>
                        <td>{$data['bandwidth']['used']} / {$data['bandwidth']['limit']}{$MGLANG->T('Virtualizor', 'MB')} ({number_format($data['bandwidth']['used'] / $data['bandwidth']['limit'] * 100, 2)}%)</td>
                    </tr>
                {/if}
                {if $data['ips']}
                    <tr>
                        <td>{$MGLANG->T('Virtualizor', 'ips')}</td>
                        <td>{implode(',', array_values($data['ips']))}</td>
                    </tr>
                {/if}
            </table>
        {/if}
    </div>
</div>