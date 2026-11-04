import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/configure-gemini-azure.py',import.meta.url));
test('Azure Gemini settings are verified without a restart unless the setting actually changes',()=>{
 const result=execFileSync('python3',['-c',`
import importlib.util,io,json,os,contextlib
from unittest.mock import patch
spec=importlib.util.spec_from_file_location("gemini_config",${JSON.stringify(script)})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
for initial,expected_put in [({"GEMINI_API_KEY":"test-key","MIS_GEMINI_API":"true","KEEP":"unchanged"},False),({"GEMINI_API_KEY":"previous-key","MIS_GEMINI_API":"false","KEEP":"unchanged"},True)]:
    requests=[]
    def respond(request,timeout=None):
        requests.append(request)
        saved=json.loads(request.data)["properties"] if request.method=="PUT" else initial
        return contextlib.closing(io.BytesIO(json.dumps({"properties":saved}).encode()))
    output=io.StringIO()
    with patch.dict(os.environ,{"GEMINI_API_KEY":"test-key"}),patch.object(module.subprocess,"run") as command,patch.object(module.urllib.request,"urlopen",side_effect=respond),contextlib.redirect_stdout(output):
        command.return_value.returncode=0;command.return_value.stdout=json.dumps({"accessToken":"test-access-token"})
        module.configure()
    assert (any(request.method=="PUT" for request in requests))==expected_put
    assert "test-key" not in output.getvalue() and "test-access-token" not in output.getvalue()
    if expected_put:
        saved=json.loads(requests[-1].data)["properties"]
        assert saved=={"GEMINI_API_KEY":"test-key","MIS_GEMINI_API":"true","KEEP":"unchanged"}
    assert all("/resourceGroups/coalmine-fleet-maintenance-rg/providers/Microsoft.Web/sites/caliber-mis-783/config/appsettings" in request.full_url for request in requests)
# The test platform workflow names its own app; production is never addressed then.
requests=[]
def respond_test(request,timeout=None):
    requests.append(request)
    saved=json.loads(request.data)["properties"] if request.method=="PUT" else {"MIS_GEMINI_API":"false"}
    return contextlib.closing(io.BytesIO(json.dumps({"properties":saved}).encode()))
output=io.StringIO()
with patch.dict(os.environ,{"GEMINI_API_KEY":"test-key","AZURE_WEBAPP_NAME":"caliber-mis-test-783","AZURE_RESOURCE_GROUP":"caliber-mis-test-rg"}),patch.object(module.subprocess,"run") as command,patch.object(module.urllib.request,"urlopen",side_effect=respond_test),contextlib.redirect_stdout(output):
    command.return_value.returncode=0;command.return_value.stdout=json.dumps({"accessToken":"test-access-token"})
    module.configure()
assert requests and all("/resourceGroups/caliber-mis-test-rg/providers/Microsoft.Web/sites/caliber-mis-test-783/config/appsettings" in request.full_url for request in requests)
assert all("sites/caliber-mis-783/" not in request.full_url for request in requests)
assert "test-key" not in output.getvalue() and "test-access-token" not in output.getvalue()
assert "caliber-mis-test-783" in output.getvalue()
for bad in ({"AZURE_WEBAPP_NAME":"bad name/with slash"},{"AZURE_RESOURCE_GROUP":"../other"}):
    with patch.dict(os.environ,{"GEMINI_API_KEY":"test-key",**bad}),patch.object(module.subprocess,"run") as command:
        try:
            module.configure()
        except RuntimeError:
            pass
        else:
            raise AssertionError("invalid Azure name accepted")
        assert not command.called
print("settings checks passed")
`],{encoding:'utf8'});
 assert.match(result,/settings checks passed/);
});
