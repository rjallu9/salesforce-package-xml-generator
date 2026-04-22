$(document).ready(function () {
    const vscode = acquireVsCodeApi();
        
    const loadOrgs = () => {
        vscode.postMessage({ command: 'getAuthOrgs', refresh:false });
    };

    loadOrgs();

    $("#tabs").tabs();
    $("#tabs").hide();

    let orgs = [];    
    let types = [];    
    let selectedTypes = new Set();
    
    let componentsMap = new Map();  
    let selectedComps = new Map();    
    let stdFieldsMap = new Map(); 

    window.addEventListener('message', (event) => {
        if(event.data.command === 'orgsList') {
            orgs = event.data.orgs;
            $("#source-org").show();
            $("#source-org-refresh").show();
            $("#spinner").hide();
            loadSourceOrgs();
        } else if(event.data.command === 'loading') {
            $(".spinnerlabel").text(event.data.message);       
        } else if(event.data.command === 'error') {
            $("#errors").text(event.data.message);   
            $("#spinner").hide();
        } else if(event.data.command === 'components') {
            componentsMap.set(event.data.type, event.data.components);                         
        } else if(event.data.command === 'stdFields') { 
            stdFieldsMap.set(event.data.name, event.data.fields);
        } else if(event.data.command === 'typesComponents') {
            if(stdFieldsMap.size > 0) {
                componentsMap.keys().forEach(function(type) {
                    if(type === 'CustomField') {
                        const stdFields = Array.from(stdFieldsMap.values()).flat();
                        stdFields.forEach((name) => {
                            componentsMap.get(type).push({ name, type:'CustomField', lastModifiedByName:'', lastModifiedDate:'', parent: 'CustomObject' });
                        });
                    }             
                });
            }  
            componentsMap.keys().forEach((name) => {
                types.push({name, hidden: false, count: componentsMap.get(name).length});
                selectedTypes.add(name);
            });
            types.sort((a, b) => a.name.localeCompare(b.name));
            refreshTypes();    
            $("#spinner").hide();    
            $("#compTypes").show();
            $('#tabs').show();    
            $("#refresh-lbl").show(); 
            $("#refreshlabel").text('Last Refresh Date: '+event.data.timestamp);   
            $("#source-actions").show();
            refreshComponents();
        } else if(event.data.command === 'hidespinner') {
            $("#spinner").hide();
        } 
    });

    function loadSourceOrgs() {
        $('#source-org-field').empty();
        $('#source-org-field').append($("<option>").val('').text(''));
        orgs.forEach(org => {
            $('#source-org-field').append($("<option>").val(org.orgId).text(org.name));
        });
    } 

    $('#source-org-field').on("change", function(e){    
        resetComponents();  
        $("#compTypes").hide();
        $("#errors").text('');
        $('#tabs').hide();
        $("#refresh-lbl").hide();  
        $("#source-actions").hide();
        if($('#source-org-field').val() !== '') {
            vscode.postMessage({ command: 'loadTypesComponents', sourceOrgId: $(this).val(), refresh:false});
            $("#spinner").show();   
            $(".spinnerlabel").text("Refreshing Components");
        }       
    });

    $("#source-org-refresh").on('click', function (e) {
        resetComponents();
        $("#compTypes").hide();
        $("#errors").text('');
        $('#tabs').hide();
        $("#refresh-lbl").hide(); 
        vscode.postMessage({ command: 'getAuthOrgs', refresh:true});
        $("#spinner").show();   
        $(".spinnerlabel").text("Refreshing Orgs");
    });

    $("#hard-refresh").on('click', function (e) {
        resetComponents();
        refreshTargetView(); 
        vscode.postMessage({ command: 'loadTypesComponents', sourceOrgId: $("#source-org-field").val(), refresh:true});
        $("#spinner").show();   
        $(".spinnerlabel").text("Refreshing Components");
    });

    function resetComponents() {
        types = [];
        selectedTypes.clear();
        componentsMap.clear();
        selectedComps.clear();        
        stdFieldsMap.clear();

        refreshTypes();  
        refreshComponents();

        $('.selected').text('Selected (0)');
        $('#selectedtable').DataTable().clear().draw(); 
        $('#deleteall-row-chk').prop('checked', false);
        $('#download').prop('disabled', true);
    }

    $('#availabletable').DataTable({
        paging: true,
        pageLength: 100,
        lengthChange: false,
        scrollY: '400px',
        scrollCollapse: true, 
        fixedColumns: true,
        order: [[4, 'desc'],[1, 'asc'],[2, 'asc']],
        columns: [
            { data: null, sortable: false },
            { data: 'type' },
            { data: 'name' },            
            { data: 'lastModifiedByName' },
            { data: 'lastModifiedDate', "type": "date", width:'200px' },
            { data: 'parent' }
        ],
        columnDefs: [
            {
                orderable: false,
                render: function (data, type, row) {
                    if (selectedComps.has(row.type + "." + row.name)) {
                        return '<input type="checkbox" class="row-chk" value="' + row.type + "." + row.name + '" checked>';
                    } else {
                        return '<input type="checkbox" class="row-chk" value="' + row.type + "." + row.name + '">';
                    }
                },
                targets: 0
            },
            {
                target: 5,
                visible: false
            }
        ],
        rowCallback: function(row, data, dataIndex){
            if (selectedComps.has(data.type + "." + data.name)) {
                var checkbox = $(row).find('.row-chk');
                if(!$(checkbox).prop('checked')) {
                    $(checkbox).prop('checked', true);
                }
                $(row).addClass('select-row');   
            } else {
                var checkbox = $(row).find('.row-chk');
                if($(checkbox).prop('checked')) {
                    $(checkbox).prop('checked', false);
                }
                $(row).removeClass('select-row');    
            }
        },
        language: {
            emptyTable: 'No components are matched to the selected criteria',
            info: "Total: _TOTAL_ component(s) available"
        }
    });

    $('#selectedtable').DataTable({
        paging: true,
        pageLength: 100,
        lengthChange: false,
        scrollY: '400px',
        scrollCollapse: true, 
        fixedColumns: true,
        order: [[0, 'asc'],[1, 'asc']],
        columns: [
            { data: null, sortable: false },
            { data: 'type' },
            { data: 'name' },            
            { data: 'lastModifiedByName' },
            { data: 'lastModifiedDate', "type": "date", width:'200px' },
            { data: 'source' }
        ],
        columnDefs: [
            {
                orderable: false,
                render: function (data, type, row) {
                    return '<input type="checkbox" class="delete-row-chk" value="' + row.type + "." + row.name + '" checked>';
                },
                targets: 0
            },
            {
                orderable: false,
                render: function (data, type, row) {
                    if (row.dest) {
                        return '<a href="#" class="fileview" data-parent="'+row.parent+'" data-name="'+row.type+"."+row.name+'" style="color:#4daafc">View</a>';
                    } else {
                        return 'N/A';
                    }
                },
                targets: 5
            }
        ],
        language: {
            info: "Total: _TOTAL_ component(s)"
        }
    });

    $(".dd-text-field").on("click", function(e){
        e.stopPropagation();
        if ($(".dd-option-box").is(":hidden")) {            
            $(".dd-option-box").show();
            $(".dd-option-box").css({width: $(this).outerWidth()});
            types.forEach(function(type) {
                type.hidden = false;           
            });
            refreshTypes();
        }        
	});

    $(".dd-text-field").on("input", function(e){
		const txt = $(this).val().toLowerCase();
        types.forEach(function(type) {
            type.hidden = txt !== '' ? !type.name.toLowerCase().startsWith(txt) : false;           
        });
        refreshTypes();
    });

    $('.dd-option-box').on('click', function (e) {
        e.stopPropagation();
    });

    //'All' checkbox
    $(document).on('change', '.dd-select-all', function() {
        $(".spinnerlabel").text("Refreshing Components");
        $("#spinner").show();
        if ($(this).is(':checked')) {
            $('.dd-option-chk').each(function(indx, chxbox) {
                if(!$(chxbox).prop('checked')) {
                    $(chxbox).prop('checked', true);
                    $(chxbox).parent().addClass('select-row');
                    $(chxbox).parent().parent().addClass('select-row');
                    const selectedValue = $(chxbox).val();
                    selectedTypes.add(selectedValue);
                }                
            });
        } else {
            $('.dd-option-chk').each(function(indx, chxbox) {
                if($(chxbox).prop('checked')) {
                    $(chxbox).prop('checked', false);
                    $(chxbox).parent().removeClass('select-row');
                    $(chxbox).parent().parent().removeClass('select-row');
                }                
            });  
            selectedTypes.clear();
        }
        refreshComponents();
        $('.dd-text-field').attr("placeholder", selectedTypes.size+' Type(s) selected');  
        $("#spinner").hide();  
    });

    //Type checkbox
    $(document).on('change', '.dd-option-chk', function() {
        if ($(this).is(':checked')) {
            $(this).parent().addClass('select-row');
            $(this).parent().parent().addClass('select-row');
            selectedTypes.add($(this).val());           
        } else {
            $(this).parent().removeClass('select-row');
            $(this).parent().parent().removeClass('select-row');
            selectedTypes.delete($(this).val());
        }        
        refreshComponents();
        $('.dd-select-all').prop('checked', selectedTypes.size === types.length);
        $('.dd-text-field').attr("placeholder", selectedTypes.size+ ' Type(s) selected');      
    });

	$("body").on("click",function(e){
        $(".dd-text-field").val('');
        $(".dd-option-box").hide();
	});

    $(document).keydown(function(e) {
        if (e.key === "Escape") {
           $(".dd-text-field").val('');
           $(".dd-option-box").hide();
        }
    });
    $(document).mousedown(function(e) {
       if($(e.target)[0]?.classList[0]?.startsWith('dd-')) {
            return;
       } else {
            $(".dd-text-field").val('');
            $(".dd-option-box").hide();
       }
    });

    function refreshTypes() {
        $('.dd-options ui').empty();
        var visibleTypesCount = 0;
        types.forEach(function(type) {
            if(!type.hidden) {
                visibleTypesCount++;
                $('.dd-options ui').append(`
                    <li class="dd-option ${(selectedTypes.has(type.name)) ? 'select-row' : ''}">
                        <div class=${(selectedTypes.has(type.name)) ? 'select-row' : ''}>
                            <input type="checkbox" value=${type.name} id=${type.name} class="dd-option-chk" 
                                    ${selectedTypes.has(type.name)? "checked" : ""}>
                            <label class="dd-option-lbl" for=${type.name}>${type.name} (${type.count})</label>
                        </div>
                    </li>
                `);
            }
        }); 
        $('.dd-text-field').attr("placeholder", selectedTypes.size+ ' Type(s) selected');
        if(types.length === visibleTypesCount) {
            $('#select-all-div').show();
            $('.dd-select-all').prop('checked', selectedTypes.size === types.length);
        } else {
            $('#select-all-div').hide();
        }        
    }

    function refreshComponents() {
        let components = [];
        selectedTypes.forEach(function(type) {
            if(componentsMap.has(type)) {
                components = [...components, ...componentsMap.get(type)];
            }
        }); 
        $('#availabletable').DataTable().clear().rows.add(components).draw();
        $('.available').text('Available ('+components.length+')');
        $('.all-row-chk').prop('checked', false);
    }

    $(document).on('change', '.row-chk', function() {
        let val = $(this).val();
        if ($(this).is(':checked')) {
            selectedComps.set(val, $('#availabletable').DataTable().row($(this).closest('tr')).data());       
        } else {
            selectedComps.delete(val);
        } 
        refreshSelection();
    });

    $(document).on('change', '.delete-row-chk', function() {
        if (!$(this).is(':checked')) {
            selectedComps.delete($(this).val());
        }
        refreshSelection();
    });

    $(document).on('change', '.deleteall-row-chk', function() {
        if (!$(this).is(':checked')) {
            selectedComps.clear();
        }
        refreshSelection();
    });

    $('.all-row-chk').on('change', function() {
        if ($(this).is(':checked')) {
            $('#availabletable').DataTable().rows({ search: "applied" }).data().each(e => {
                selectedComps.set(e.type+"."+e.name, e);  
            });
        } else {
            selectedComps.clear();
        }   
        refreshSelection();
    });

    function refreshSelection() {
        $('.row-chk').each(function(indx, chxbox) {
            $(chxbox).prop('checked', selectedComps.has($(chxbox).val()));
            if(selectedComps.has($(chxbox).val())) {
                $(chxbox).parent().parent().addClass('select-row');
            } else {
                $(chxbox).parent().parent().removeClass('select-row');
            }               
        });

        $('.all-row-chk').prop('checked', $('#availabletable').DataTable().data().length === selectedComps.size);
        $('#packagexml').prop('disabled', selectedComps.size === 0);
        $('#download').prop('disabled', selectedComps.size === 0); 

        $('.selected').text('Selected ('+selectedComps.size+')');   
        $('#selectedtable').DataTable().clear().rows.add(Array.from(selectedComps.values())).draw(); 
        $('#selectedtable').DataTable().column(5).visible(false);
        $('#deleteall-row-chk').prop('checked', selectedComps.size > 0);
        refreshTargetView();
    }

    $('#packagexml').on('click', function (e) {
        let packagexml = getPackageXml();
        navigator.clipboard.writeText( `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${packagexml}\t<version>62.0</version>\n</Package>`);
        vscode.postMessage({ command: 'toastMessage', message: 'Package.xml copied to clipboard'});
    });

    $('#download').on('click', function (e) {
        $(".spinnerlabel").text("Downloading");
        $("#spinner").show();
        let packagexml = getPackageXml();
        vscode.postMessage({ command: 'download', sourceOrgId: $('#source-org-field').val(), packagexml:packagexml});  
    });  

    function getPackageXml() {
        var comps = new Map();
        Array.from(selectedComps.values()).forEach(comp => {
            if(comps.has(comp.type)) {
                comps.get(comp.type).push(comp.name);
            } else {
                comps.set(comp.type, [comp.name]);
            }
        });
        let packagexml = '';
        Array.from(comps.keys()).forEach(type => {
            packagexml += '\t<types>\n';
            comps.get(type).forEach(e => {
                packagexml += '\t\t<members>'+e+'</members>\n';
            });
            packagexml += '\t\t<name>'+type+'</name>\n';
            packagexml += '\t</types>\n';
        });
        return packagexml;
    }

    $(".tab").on('click', function (e) {
        if($('#'+e.currentTarget.attributes.name.value).DataTable().page() === 0) {
            $('#'+e.currentTarget.attributes.name.value).DataTable().draw(); 
        }        
    });
});

