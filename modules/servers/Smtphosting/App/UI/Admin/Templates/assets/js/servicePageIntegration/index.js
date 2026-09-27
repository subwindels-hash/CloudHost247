function mgUpdateTasksQueue(table)
{
    setTimeout(function () {
        table.updateProjects();
        mgUpdateTasksQueue(table);
    }, 61000);
}

mgEventHandler.on('DatatableCreated', 'scheduledTasks', function (id, params) {
    mgUpdateTasksQueue(params.datatable);
});
