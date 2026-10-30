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
print("settings checks passed")
`],{encoding:'utf8'});
 assert.match(result,/settings checks passed/);
});
