"""Configure a Pulse-II app with a CI-provided Gemini secret.

Only the two named app settings are changed. Secrets/tokens and Azure response
bodies never reach stdout, command arguments, temporary files or the repository.

The target is the live app (caliber-mis-783) unless AZURE_WEBAPP_NAME and
AZURE_RESOURCE_GROUP name another app in the same subscription; the test
platform workflow sets them (docs/test-platform-setup.md).
"""
import json
import os
import re
import subprocess
import urllib.request
import urllib.error

SUBSCRIPTION = '58ca09cf-ab5d-47a8-a438-e1fb2a40d030'
DEFAULT_RESOURCE_GROUP = 'coalmine-fleet-maintenance-rg'
DEFAULT_WEBAPP_NAME = 'caliber-mis-783'


def target_resource(env=os.environ):
    group = env.get('AZURE_RESOURCE_GROUP', '').strip() or DEFAULT_RESOURCE_GROUP
    site = env.get('AZURE_WEBAPP_NAME', '').strip() or DEFAULT_WEBAPP_NAME
    if not re.fullmatch(r'[A-Za-z0-9._()-]{1,90}', group) or not re.fullmatch(r'[A-Za-z0-9-]{2,60}', site):
        raise RuntimeError('The Azure resource group or web app name for the Gemini settings is invalid.')
    resource = ('/subscriptions/' + SUBSCRIPTION + '/resourceGroups/' + group +
                '/providers/Microsoft.Web/sites/' + site)
    return resource, site


def configure():
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key or len(key) > 300 or any(c.isspace() for c in key):
        raise RuntimeError('The central Gemini deployment secret is missing or invalid.')
    resource, site = target_resource()
    result = subprocess.run(['az', 'account', 'get-access-token', '--subscription', SUBSCRIPTION,
                             '--resource', 'https://management.azure.com/', '--output', 'json'],
                            capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Azure deployment identity could not obtain access to %s.' % site)
    token = json.loads(result.stdout)['accessToken']
    url = 'https://management.azure.com' + resource + '/config/appsettings'
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}

    def call(method, suffix, body=None):
        request = urllib.request.Request(url + suffix + '?api-version=2023-12-01',
                                         data=json.dumps(body).encode() if body is not None else b'',
                                         headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError('%s Gemini settings update failed (HTTP %s).' % (site, error.code)) from None

    settings = call('POST', '/list')['properties']
    if settings.get('GEMINI_API_KEY') == key and settings.get('MIS_GEMINI_API') == 'true':
        print('%s Gemini configuration already verified; no settings update or extra restart needed.' % site)
        return
    settings['GEMINI_API_KEY'] = key
    settings['MIS_GEMINI_API'] = 'true'
    saved = call('PUT', '', {'properties': settings})['properties']
    if saved.get('GEMINI_API_KEY') != key or saved.get('MIS_GEMINI_API') != 'true':
        raise RuntimeError('%s Gemini settings could not be verified.' % site)
    print('%s Gemini configuration verified; key remains server-side.' % site)


if __name__ == '__main__':
    configure()
