import * as vscode from 'vscode';
import stdValueSet from './assets/stdValueSet.json';
const path = require('path');
const os = require('os');
const axios = require('axios');
const xml2js = require('xml2js');
const { exec } = require('child_process');
const fs = require('fs');

let tmpDirectory = '';
let STD_VALUE_SET = stdValueSet;
let orgsList: any[] = [];
var orgsListPath = '';
var fsPath = '';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('salesforce-package-xml-generator.build', () => {
			const panel = vscode.window.createWebviewPanel(
				'packageBuilder',
				'Salesforce Package.xml Generator',
				vscode.ViewColumn.One,
				{ enableScripts: true, retainContextWhenHidden: true }
			);
			const scriptPath = vscode.Uri.file(
				path.join(context.extensionPath, 'out', 'assets/index.js')
			);
			const scriptUri = panel.webview.asWebviewUri(scriptPath);
			const cssPath = vscode.Uri.file(
				path.join(context.extensionPath, 'out', 'assets/index.css')
			);
			const cssUri = panel.webview.asWebviewUri(cssPath);

			panel.webview.html = getWebviewContent(context.extensionPath, scriptUri, cssUri);

			let isCancelDeploy = false;

			tmpDirectory = context.globalStorageUri.fsPath+"/tmp";
			fsPath = context.globalStorageUri.fsPath;
			orgsListPath = path.join(context.globalStorageUri.fsPath, 'orgsListV2.json');

			panel.webview.onDidReceiveMessage((message) => {
				switch (message.command) {
					case 'getAuthOrgs':	
						if (fs.existsSync(orgsListPath) && !message.refresh) {
							orgsList = JSON.parse(fs.readFileSync(orgsListPath, 'utf-8'));
							panel.webview.postMessage({ command: 'orgsList', orgs: orgsList});
						} else {
							if(fs.existsSync(orgsListPath)) {
								orgsList = JSON.parse(fs.readFileSync(orgsListPath, 'utf-8'));
							}
							getAuthOrgs().then((result:any) => {
								panel.webview.postMessage({command: 'orgsList', orgs: orgsList});		
							}).catch((error) => {
								panel.webview.postMessage({ command: 'error', message:`Unable to load authorized orgs. ${error}`});
							});	
						}				
						break;
					case 'loadTypesComponents':
						var sourceOrg = orgsList.find((org:any) => org.orgId === message.sourceOrgId);	
						validateSession(message.sourceOrgId)
						.then((result:any) => {
							if(result.valid) {
								var metdataPath = path.join(context.globalStorageUri.fsPath+"/"+sourceOrg.orgId, 'metadata.json');
								if (fs.existsSync(metdataPath) && !message.refresh) {
									const metadata = new Map(JSON.parse(fs.readFileSync(metdataPath, 'utf-8')));
									const timestamp = metadata.get('Timestamp');
									metadata.delete('Timestamp');
									for (const [key, value] of metadata) {
										panel.webview.postMessage({ command: 'components', components:value, type:key });								
									}
									panel.webview.postMessage({ command: 'typesComponents', components: '', timestamp });
								} else {
									const now = new Date();
									getTypesComponents(message.sourceOrgId, context.globalStorageUri.fsPath, panel)
									.then((data:any) => {
										panel.webview.postMessage({ command: 'typesComponents', components: data,
											timestamp: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`});
										saveMetadata(data.components, data.sobjects, context.globalStorageUri.fsPath, sourceOrg.orgId);								
									});
								}	
							}
						}).catch((error) => {
							panel.webview.postMessage({ command: 'error', message:`Unable to connect to the Org. ${error}` });
						});				
						break;
					case 'toastMessage':
						vscode.window.showInformationMessage(`${message.message}`);	
						break;					
					case 'download':
						retrieve(message.sourceOrgId, message.packagexml).then((result:any) => {	
							let retrieveJobId = result;
							let intervalId = setInterval(() => {
								retrieveStatus(message.sourceOrgId, retrieveJobId).then((result:any) => {	
									if(result.done	=== 'true') {
										const buffer = Buffer.from(result.zipFile, 'base64');
										const downloadsPath = path.join(os.homedir(), 'Downloads');

										let zipFilePath = path.join(downloadsPath, 'download.zip');
										let counter = 1;
										while (fs.existsSync(zipFilePath)) {
											zipFilePath = path.join(downloadsPath, 'download('+counter+').zip');
											counter++;
										}										
										
										fs.writeFileSync(zipFilePath, buffer);	
										
										clearInterval(intervalId);	
										panel.webview.postMessage({ command: 'hidespinner'});  
										vscode.window.showInformationMessage(`Download completed.`);

										const platform = process.platform;
										if (platform === 'win32') {
											exec(`start "" "${downloadsPath}"`);
										} else if (platform === 'darwin') {
											exec(`open "${downloadsPath}"`);
										} else {
											exec(`xdg-open "${downloadsPath}"`);
										}
									}		
								}).catch((error) => {
									vscode.window.showErrorMessage(`Error: ${JSON.stringify(error)}`);
									clearInterval(intervalId);	
								});
							}, 1000);			
						});
						break;
					default:
						console.log('Unknown command:', message.command);
				}
			});

			panel.onDidDispose(() => {
				if (tmpDirectory && fs.existsSync(tmpDirectory)) {
					try {
						fs.rmSync(tmpDirectory, { recursive: true, force: true });
					} catch (err) {
					}
				}
			});
		
	});

	context.subscriptions.push(disposable);
}

async function scrollTo(text: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const doc = editor.document;
    const textPosition = doc.getText().indexOf(text);

    if (textPosition === -1) {
        return;
    }

    const pos = doc.positionAt(textPosition);
    const range = new vscode.Range(pos, pos);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

function validateSession(orgId:string) {
	var org = orgsList.find((org:any) => org.orgId === orgId);	
	return new Promise((resolve, reject) => {
		sendSoapAPIRequest(orgId, '<urn:getUserInfo/>')
		.then((result:any) => {
			resolve({valid: true});
		}).catch((error:any) => {
			axios({method: 'POST', url: org.instanceUrl+'/services/oauth2/token?client_id=PlatformCLI&grant_type=refresh_token&refresh_token='+org.refreshToken, data: {}, 
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded'
					}
				}
			).then((response:any) => {
				org.accessToken = response.data.access_token;
				fs.writeFile(orgsListPath, JSON.stringify(orgsList, null, 2), 'utf8', (err:any) => {}); 	
				sendSoapAPIRequest(orgId, '<urn:getUserInfo/>')
				.then((result:any) => {
					resolve({valid: true});
				});
			})
			.catch((error:any) => {
				reject(error);
			});
        });;
    });
}

function saveMetadata(metadata:any, sobjects:any, fsPath:string, orgId:string) {
	Array.from(sobjects.values()).flat().forEach((name:any) => {
		metadata.get('CustomField').push({ name, type:'CustomField', lastModifiedByName:'', lastModifiedDate:'', parent:'CustomObject' });
	});
	const now = new Date();
	metadata.set('Timestamp', `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`);
	const dir = path.dirname(fsPath+"/"+orgId+"/metadata.json");
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}	
	fs.writeFile(fsPath+"/"+orgId+"/metadata.json", JSON.stringify(Array.from(metadata), null, 2), 'utf8', (err:any) => {
		if (err) {
			vscode.window.showErrorMessage(`Error..!! ${err}`);
		}
	});   
}

function retrieveStatus(orgId:string, retrieveJobId:string) {
    return new Promise((resolve, reject) => {
		sendSoapMDRequest(orgId, '<met:checkRetrieveStatus><met:asyncProcessId>'+retrieveJobId+
			'</met:asyncProcessId><met:includeZip>true</met:includeZip></met:checkRetrieveStatus>')
		.then((result:any) => {
			const res = result['checkRetrieveStatusResponse']['result'];	
			let fileNames = new Map();
			if(res['done'] === 'true') {
				let tmp = res['fileProperties'] instanceof Array ? res['fileProperties'] : [res['fileProperties']];
				tmp.forEach((file: any) => {
					fileNames.set(file.type+"."+file.fullName, file.fileName);
				});	
			}
			resolve({
				done: res['done'],
				zipFile: res['zipFile'],
				fileNames: fileNames
			});	
        })
        .catch((error:any) => {
            reject(error);			
        });
    });
}

function retrieve(orgId:string, packagexml:string) {
	var org = orgsList.find((org:any) => org.orgId === orgId);	
    return new Promise((resolve, reject) => {
		sendSoapMDRequest(orgId, '<met:retrieve><met:retrieveRequest><met:apiVersion>'+org.apiVersion+'</met:apiVersion>'+
			'<met:singlePackage>true</met:singlePackage><met:unpackaged>'+packagexml+'</met:unpackaged></met:retrieveRequest></met:retrieve>')
		.then((result:any) => {
			const retrieveId = result['retrieveResponse']['result']['id'];	
			resolve(retrieveId);
        })
        .catch((error:any) => {
            reject(error);			
        });
    });
}

function getTypesComponents(orgId:string, globalStorageUri:string, panel:vscode.WebviewPanel) {
	var org = orgsList.find((org:any) => org.orgId === orgId);	
    return new Promise((resolve, reject) => {
		let components = new Map();
		let sobjects = new Map();
		sendSoapMDRequest(orgId, '<met:describeMetadata><met:asOfVersion>'+org.apiVersion+'</met:asOfVersion></met:describeMetadata>')
		.then((result:any) => {
			const types = result['describeMetadataResponse']['result']['metadataObjects'];			
			const typesList:{name:string; inFolder:string; parent:string;}[] = [];
			types.forEach((element:any) => {
				typesList.push({ name: element['xmlName'], inFolder: element['inFolder'], parent:''});
				if(element['childXmlNames']) {
					let tmp = element['childXmlNames'] instanceof Array ? element['childXmlNames'] : [element['childXmlNames']];
					tmp.forEach((childname:any) => {
						typesList.push({ name: childname, inFolder: 'false', parent: element['xmlName']});
					});	
				}
			});		
			panel.webview.postMessage({ command: 'loading', message: 'Refreshing Components(0/'+typesList.length+')'});	

			Promise.all(typesList.map((e:{name:string; inFolder:string; parent:string;}) => {				
				return sendSoapMDRequest(orgId, '<met:listMetadata><met:queries><met:type>'
											+(e.inFolder === 'true' ? (e.name === 'EmailTemplate' ? 'EmailFolder' : e.name+'Folder') : e.name)
											+'</met:type></met:queries></met:listMetadata>')
					.then((result:any) => {
						const comps = result['listMetadataResponse'];
						let results = buildComponents(comps, e.parent);	
						if(e.inFolder === 'true') {
							let folderresults:Object[] = [];	
							return Promise.all(results.map((element:any) => {
								return sendSoapMDRequest(orgId, '<met:listMetadata><met:queries><met:type>'+e.name+
									'</met:type><met:folder>'+element.name+'</met:folder></met:queries></met:listMetadata>')
								.then((result:any) => {
									const comps = result['listMetadataResponse'];
									let fldresults = buildComponents(comps, e.parent);	
									element.type = e.name;
									folderresults = [...folderresults, ...fldresults, element];
								});
							}))
							.then(() => {
								components.set(e.name, folderresults);
								panel.webview.postMessage({ command: 'loading', message: 'Refreshing Components('+components.size+'/'+typesList.length+')'});
								panel.webview.postMessage({ command: 'components', components:folderresults, type:e.name });	
							}).catch(error => {
								vscode.window.showErrorMessage(`Error ${error}`);
							});	
						} else if(e.name === 'CustomObject') {
							components.set(e.name, results);
							panel.webview.postMessage({ command: 'components', components:results, type:e.name });
							const mdobjects = new Set(results.map(obj => obj.name));

							var fieldsPath = path.join(fsPath+"/"+orgId, 'stdFields.json');
							if (fs.existsSync(fieldsPath)) {
								sobjects = new Map(JSON.parse(fs.readFileSync(fieldsPath, 'utf-8')));
							}

							return sendSoapAPIRequest(orgId, '<urn:describeGlobal/>')
								.then((result:any) => {
									const comps = result['describeGlobalResponse']['result']['sobjects'];
									let objects:string[] = [];	
									comps.forEach((e:any) => {
										if(e['custom'] === 'false' && e['layoutable'] === 'true' && mdobjects.has(e['name'])) {
											if(sobjects.has(e['name'])) {
												panel.webview.postMessage({ command: 'stdFields', name:e['name'], fields: sobjects.get(e['name'])});
											} else {
												objects.push(e['name']);
											}											
										}
									});
									if(objects.length > 0) {
										const chunks = [];
										for (let i = 0; i < objects.length; i += 100) {
											chunks.push(objects.slice(i, i + 100));
										}
										return Promise.all(chunks.map((chunk:string[]) => {
											var payload = '';
											chunk.forEach((e:any) => {
												payload += '<urn:sObjectType>'+e+'</urn:sObjectType>';
											});
											return sendSoapAPIRequest(orgId, '<urn:describeSObjects>'+ payload + '</urn:describeSObjects>')
											.then((result:any) => {
												const objs = result['describeSObjectsResponse']['result'];
												const exclFields = new Set(['Id', 'IsDeleted', 'CreatedById', 'CreatedDate', 'LastModifiedById', 'LastModifiedDate', 
													'LastReferencedDate', 'LastViewedDate', 'SystemModstamp', 'MasterRecordId', 'LastActivityDate']);
												objs.forEach((obj:any) => {
													let tmp:string[] = [];
													obj['fields'].forEach((e:any) => {
														if(e['custom'] === 'false' && !exclFields.has(e['name']) && (e['compoundFieldName'] === undefined || e['compoundFieldName'] === 'Name')) {
															tmp.push(obj['name']+'.'+e['name']);
														}
													});
													sobjects.set(obj['name'], tmp);
													panel.webview.postMessage({ command: 'stdFields', name:obj['name'], fields: tmp});
												});	
											}).catch(error => {
												vscode.window.showErrorMessage(`Error ${error}`);
											});
										}))
										.then(() => {
											const dir = path.dirname(fieldsPath);
											if (!fs.existsSync(dir)) {
												fs.mkdirSync(dir, { recursive: true });
											}	
											fs.writeFile(fieldsPath, JSON.stringify(Array.from(sobjects), null, 2), 'utf8', (err:any) => {});  
										}).catch(error => {
											vscode.window.showErrorMessage(`Error ${error}`);
										});	
									}	
								}
							).catch(error => {
								vscode.window.showErrorMessage(`Error ${error}`);
							});
						} else {
							if(e.name === 'StandardValueSet') {
								results = [];						
								STD_VALUE_SET.forEach((e) => {
									results.push({name: e, type: 'StandardValueSet', lastModifiedByName:'', lastModifiedDate: '', parent: ''});
								});
							}
							components.set(e.name, results);
							panel.webview.postMessage({ command: 'loading', message: 'Refreshing Components('+components.size+'/'+typesList.length+')'});
							panel.webview.postMessage({ command: 'components', components:results, type:e.name });
						}			
					}
				).catch(error => {
					vscode.window.showErrorMessage(`Error ${error}`);
				});		
			}))
			.then(() => {
				resolve({'components': components, 'sobjects':sobjects});
			}).catch(error => {
				vscode.window.showErrorMessage(`Error ${error}`);
			});
        })
        .catch((error:any) => {
            reject(error);			
        });
    });
}

function buildComponents(comps:any, parent:string) {
	let results: { name: string; type: string, lastModifiedByName: string; lastModifiedDate: string; parent:string;}[] = [];
	let auditDate = '1970-01-01T00:00:00.000Z';
	if(comps !== "") {
		let tmp = comps['result'] instanceof Array ? comps['result'] : [comps['result']];
		results = tmp.map((comp: any) => ({
			name: comp['fullName'],
			type: comp['type'],
			parent: parent,
			lastModifiedByName: comp['lastModifiedByName'],
			lastModifiedDate: comp['lastModifiedDate'] !== auditDate ? new Date(comp['lastModifiedDate']).toLocaleDateString() : 
						comp['createdDate'] !== auditDate ? new Date(comp['createdDate']).toLocaleDateString() : ''
		}));	
		results = Array.from(
			new Map(results.map(item => [item.type+item.name, item])).values()
		);	
	}
	return results;
}

function sendSoapMDRequest(orgId:string, body:string) {
	let org = orgsList.find((org:any) => org.orgId === orgId);
	const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });	
	let reuest =  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">'+
		'<soapenv:Header><met:SessionHeader><met:sessionId>'+org.accessToken+'</met:sessionId></met:SessionHeader></soapenv:Header>'+
		'<soapenv:Body>'+body+'</soapenv:Body></soapenv:Envelope>';
	
	return new Promise((resolve, reject) => {
		axios.post(org.instanceUrl+"/services/Soap/m/"+org.apiVersion, reuest, { headers: {
					'Content-Type': 'text/xml; charset=utf-8',
					'SOAPAction': 'Update',
				},
			}
		).then((response:any) => {
			parser.parseString(response.data, (err:any, result:any) => {
				if (err) {
					vscode.window.showErrorMessage("Error parsing SOAP XML:", err);
					return;
				}		
				resolve(result['soapenv:Envelope']['soapenv:Body']);
			});
		})
		.catch((error:any) => {
			parser.parseString(error.response.data, (err:any, result:any) => {	
				reject(result['soapenv:Envelope']['soapenv:Body']['soapenv:Fault']['faultstring']);
			});		
		});
	});
}

function sendSoapAPIRequest(orgId:string, body:string) {
	let org = orgsList.find((org:any) => org.orgId === orgId);
	const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });	
	let request =  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">'+
		'<soapenv:Header><urn:SessionHeader><urn:sessionId>'+org.accessToken+'</urn:sessionId></urn:SessionHeader></soapenv:Header>'+
		'<soapenv:Body>'+body+'</soapenv:Body></soapenv:Envelope>';
	
	return new Promise((resolve, reject) => {
		axios.post(org.instanceUrl+"/services/Soap/u/"+org.apiVersion, request, { headers: {
					'Content-Type': 'text/xml; charset=utf-8',
					'SOAPAction': 'Update',
				},
			}
		).then((response:any) => {
			parser.parseString(response.data, (err:any, result:any) => {
				if (err) {
					vscode.window.showErrorMessage("Error parsing SOAP XML:", err);
					return;
				}		
				resolve(result['soapenv:Envelope']['soapenv:Body']);
			});
		})
		.catch((error:any) => {
			parser.parseString(error.response.data, (err:any, result:any) => {	
				reject(result['soapenv:Envelope']['soapenv:Body']['soapenv:Fault']['faultstring']);
			});		
		});
	});
}

function getAuthOrgs() {
    return new Promise((resolve, reject) => {
        exec('sf org list --json', (error:any, stdout:any, stderr:any) => {
            if (error) {
                reject(`Error: ${error}`);
            } else {
                try {
                    const data = JSON.parse(stdout).result;	
					const orgs = [];
					const orgIds:string[] = [];
					orgs.push(...(data.other || []), ...(data.sandboxes || []), ...(data.nonScratchOrgs || []), ...(data.devHubs || []), ...(data.scratchOrgs || []));
					const newOrgs = orgs.filter((org: any) => {
						const isConnected = org.connectedStatus === 'Connected' || org.status === 'Active';
						const isNew = !orgsList.find((o: any) => o.orgId === org.orgId);
						const isUnique = !orgIds.includes(org.orgId);
						if (isConnected && isNew && isUnique) {
							orgIds.push(org.orgId);
							return true;
						}
						return false;
					});
					if (newOrgs.length === 0) {
						resolve(orgsList); // nothing new to fetch
						return;
					}

					// Run all org display calls in parallel
					const displayPromises = newOrgs.map((org: any) => {
						return new Promise<void>((res) => {
							exec(`sf org display --target-org ${org.username} --verbose --json`, (err: any, out: any) => {
									if (err) {
										res(); // don't reject — skip this org
										return;
									}
									try {
										const display = JSON.parse(out).result;
										const sfdxAuthUrl = display.sfdxAuthUrl || '';
										const refreshToken = sfdxAuthUrl.substring(sfdxAuthUrl.indexOf('::') + 2, sfdxAuthUrl.lastIndexOf('@'));
										if (refreshToken) {
											orgsList.push({
												name: `${org.alias}(${org.username})`,
												alias: org.alias,
												orgId: org.orgId,
												accessToken: display.accessToken,
												instanceUrl: display.instanceUrl,
												refreshToken,
												apiVersion: display.apiVersion
											});
										}
									} catch (e) {
									}
									res();
								}
							);
						});
					});
					// Wait for ALL display calls to finish, then resolve
					Promise.all(displayPromises).then(() => {							
						const dir = path.dirname(orgsListPath);
						if (!fs.existsSync(dir)) {
							fs.mkdirSync(dir, { recursive: true });
						}	
						fs.writeFile(orgsListPath, JSON.stringify(orgsList, null, 2), 'utf8', (err:any) => {}); 	
						resolve(orgsList);
					});
                } catch (parseError:any) {
                    reject(`Parse Error: ${parseError.message}`);
                }
            }
        });
    });
}

function getWebviewContent(basedpath:string, scriptUri:vscode.Uri, cssUri:vscode.Uri) {

	return `<!doctype html>
			<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>Salesforce Package.xml Generator</title>
				<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
				<script src="https://code.jquery.com/ui/1.14.1/jquery-ui.min.js"></script>
				<script src="https://cdn.datatables.net/2.1.8/js/dataTables.min.js"></script>				
				<link rel="stylesheet" href="https://cdn.datatables.net/2.1.8/css/dataTables.dataTables.min.css">
				<script src="https://cdn.datatables.net/select/2.1.0/js/dataTables.select.min.js"></script>				
				<link rel="stylesheet" href="https://cdn.datatables.net/select/2.1.0/css/select.dataTables.min.css">
				<link rel="stylesheet" href="https://code.jquery.com/ui/1.14.1/themes/base/jquery-ui.css">
			</head>
			<body>	
				<div style="margin: 20px;">
					<div style="display:flex;justify-content: space-between;align-items: center;">	
						<h1>Salesforce Package.xml Generator</h1>		
						<a href="https://github.com/rjallu9/salesforce-package-xml-generator/issues" title="Report issue" style="height"25px;">
							<svg width="25px" height="25px" viewBox="0 0 36 36" version="1.1"  preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
								<circle cx="18" cy="18" r="14" fill="#0078d4"/>
								<text x="18" y="20" font-family="Arial" font-size="20" text-anchor="middle" alignment-baseline="middle" fill="white">?</text>
							</svg>
						</a>		
					</div>
					<div style="display:flex;justify-content:space-between;flex-wrap:wrap;">	
						<div style="display:flex;">		
							<div id="source-org" style="margin-right:5px;display:none;">	
								<label for="text" for="source-org-field" class="top-label">Org:</label>
								<select type="text" class="source-org-field" id="source-org-field" style="height:36px;">
								</select>		
							</div>
							<div>
								<p id="source-org-refresh" style="margin-bottom:0;margin-top:25px;margin-right:5px;cursor:pointer;display:none;" title="Refresh Orgs">
									<svg width="25" height="25" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
										<circle cx="512" cy="512" r="512" fill="#0078d4"></circle>
										<path d="M512 281.6c71.221 0 136.396 32.619 179.2 85.526V256h51.2v204.8H537.6v-51.2h121.511c-32.857-47.165-87.235-76.8-147.111-76.8-98.97 0-179.2 80.23-179.2 179.2 0 98.97 80.23 179.2 179.2 179.2v-.02c73.665 0 138.994-44.857 166.176-111.988l47.458 19.216C690.689 684.711 606.7 742.38 512 742.38v.02c-127.246 0-230.4-103.154-230.4-230.4 0-127.246 103.154-230.4 230.4-230.4z" fill="white" fill-rule="nonzero"></path>
									</svg>
								</p>
							</div>
							<div id="compTypes" style="display:none;flex:1;">
								<div class="form-panel">
									<div>
										<div style="float:left;" >
											<div>	
												<label for="text" for="dd-text-field" class="top-label">Type: </label>
												<input type="text" class="dd-text-field" id="dd-text-field"></input>								
												<span style="margin-left: -19px;color: #888;">
													<svg width="15" height="15" viewBox="0 0 24 12" fill="#cccccc;" xmlns="http://www.w3.org/2000/svg" style="color: #cccccc;">
														<path d="M6 9l6 6 6-6" stroke="#cccccc" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
													</svg>
												</span>
											</div>
											<div class="dd-option-box">
												<div style="padding:5px 10px 5px 10px;" id="select-all-div">
													<input type="checkbox" value="All" class="dd-select-all">
													<label for="select-all">All</label>
												</div>
												<div class="dd-options">
													<ui style="list-style-type: none;">                       
													</ui>
												</div>
											</div>
										</div>
									</div>
								</div>				
							</div>
							<div id="source-actions" style="display:none;margin-left:5px; padding-top: 22px;">
								<button type="button" style="width:100px;" id="packagexml" disabled>Package.xml</button>								
								<button type="button" style="width:160px;" id="download" disabled>Download (Metadata)</button>
							</div>	
						</div>	
					</div>
					<p style="color:#f14c4c;margin-bottom:0;margin-top:5px;" id="errors"></p>
					<p id="refresh-lbl" style="display:none;">
						<span id="refreshlabel">Last Refresh Date:</span>. Please click <a href="#" id="hard-refresh">here</a> to refresh.
					</p>
					<div id="tabs" style="margin-top:10px;display:none;">
						<ul>
							<li class="tab" name="availabletable"><a href="#available" class="available">Available (0)</a></li>
							<li class="tab" name="selectedtable"><a href="#selected" class="selected">Selected (0)</a></li>
						</ul>
						<div id="available">
							<table id="availabletable" class="display" style="width:100%">
								<thead>
									<tr>
										<th><input type="checkbox" id="all-row-chk" class='all-row-chk'/></th>	
										<th>Type</th>
										<th>Name</th>
										<th>Last Modified By</th>
										<th>Last Modified Date</th>
									</tr>
								</thead>
							</table>
						</div>
						<div id="selected">
							<table id="selectedtable" class="display" style="width:100%">
								<thead>
									<tr>	
										<th><input type="checkbox" id="deleteall-row-chk" class="deleteall-row-chk"/></th>	
										<th>Type</th>
										<th>Name</th>
										<th>Last Modified By</th>
										<th>Last Modified Date</th>									
									</tr>
								</thead>
							</table>
						</div>
					</div>
				</div>
				<div id="spinner" class="spinner">
					<div class="cv-spinner">
						<span class="spinner-circle"></span>
						<p style="margin-left: 5px;" class="spinnerlabel">Initializing</p>
					</div>
				</div>
			</body>
			<script src=${scriptUri}></script>
			<link rel="stylesheet" href=${cssUri}>
			</html>`;
}

export function deactivate() {
	if (tmpDirectory && fs.existsSync(tmpDirectory)) {
        try {
            fs.rmSync(tmpDirectory, { recursive: true, force: true });
        } catch (err) {
        }
    }
}

