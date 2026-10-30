import json,subprocess,zipfile,re,tempfile,os
base=['--resource-group','coalmine-fleet-maintenance-rg','--name','caliber-mis-783']
def run(args):
    try:
        result=subprocess.run(['az']+args+['--only-show-errors'],capture_output=True,text=True,timeout=90)
        if result.returncode:
            print(json.dumps({'command':args[:4],'available':False,'exit':result.returncode}))
            return None
        return result.stdout
    except subprocess.TimeoutExpired:
        print(json.dumps({'command':args[:4],'available':False,'timeout':True}))
        return None
raw=run(['webapp','log','deployment','list']+base+['--output','json'])
if raw:
    for entry in json.loads(raw)[:5]:
        print(json.dumps({key:entry.get(key) for key in ['id','status','active','complete','start_time','end_time']}))
raw=run(['webapp','config','show']+base+['--output','json'])
if raw:
    data=json.loads(raw)
    print(json.dumps({'linuxFxVersion':data.get('linuxFxVersion'),'usesNpmStart':data.get('appCommandLine','').strip() in ('','npm start','npm run start'),'alwaysOn':data.get('alwaysOn')}))
archive=os.path.join(tempfile.gettempdir(),'mis-deployment-diagnostics.zip')
raw=run(['webapp','log','download']+base+['--log-file',archive])
if os.path.exists(archive):
    with zipfile.ZipFile(archive) as logs:
        names=sorted((info for info in logs.infolist() if info.filename.endswith(('.log','.txt')) and 'docker' in info.filename.lower()),key=lambda info:info.date_time,reverse=True)[:6]
        for info in names:
            if info.file_size>10*1024*1024:continue
            data=logs.read(info).decode('utf-8','replace')[-200000:]
            # Emit classified startup signals only, never raw production logs,
            # request payloads, settings, connection strings or credentials.
            print(json.dumps({'log':os.path.basename(info.filename),'serverStarted':'CALIBER ERP listening on port' in data,'moduleNotFound':bool(re.search(r'ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module',data)),'outOfMemory':bool(re.search(r'heap out of memory|OOMKilled|out of memory',data,re.I)),'containerStartFailed':bool(re.search(r'failed to start|did not respond to HTTP pings|startup probe failed',data,re.I)),'syntaxError':'SyntaxError:' in data,'databaseFailure':'Database initialization failed' in data}))
    os.remove(archive)
