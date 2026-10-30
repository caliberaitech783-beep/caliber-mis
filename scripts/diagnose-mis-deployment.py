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

raw=run(['webapp','log','deployment','show']+base+['--output','json'])
if raw:
    for row in json.loads(raw)[-15:]:
        message=str(row.get('message','')).lower()
        phases=[word for word in ['extract','copy','sync','build','deploy','oryx','npm','zip'] if word in message]
        print(json.dumps({'time':row.get('log_time'),'type':row.get('type'),'phase':phases}))
raw=run(['webapp','log','startup','show']+base)
if raw:
    print(json.dumps({'startupLogAvailable':True,'serverStarted':'CALIBER ERP listening on port' in raw,'moduleNotFound':bool(re.search(r'ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module',raw)),'outOfMemory':bool(re.search(r'heap out of memory|OOMKilled|out of memory',raw,re.I)),'syntaxError':'SyntaxError:' in raw,'databaseFailure':'Database initialization failed' in raw}))
