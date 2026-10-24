"""Configure the existing Pulse-II app with a CI-provided Gemini secret.

Only the two named app settings are changed. Secrets/tokens and Azure response
bodies never reach stdout, command arguments, temporary files or the repository.
"""
import json
import os
import subprocess
import urllib.request
import urllib.error

SUBSCRIPTION = '58ca09cf-ab5d-47a8-a438-e1fb2a40d030'
RESOURCE = ('/subscriptions/' + SUBSCRIPTION +
            '/resourceGroups/coalmine-fleet-maintenance-rg/providers/Microsoft.Web/sites/caliber-mis-783')


def configure():
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key or len(key) > 300 or any(c.isspace() for c in key):
        raise RuntimeError('The central Gemini deployment secret is missing or invalid.')
    result = subprocess.run(['az', 'account', 'get-access-token', '--subscription', SUBSCRIPTION,
                             '--resource', 'https://management.azure.com/', '--output', 'json'],
                            capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Azure deployment identity could not obtain access to Pulse-II.')
    token = json.loads(result.stdout)['accessToken']
    url = 'https://management.azure.com' + RESOURCE + '/config/appsettings'
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}

    def call(method, suffix, body=None):
        request = urllib.request.Request(url + suffix + '?api-version=2023-12-01',
                                         data=json.dumps(body).encode() if body is not None else b'',
                                         headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError('Pulse-II Gemini settings update failed (HTTP %s).' % error.code) from None

    settings = call('POST', '/list')['properties']
    settings['GEMINI_API_KEY'] = key
    settings['MIS_GEMINI_API'] = 'true'
    saved = call('PUT', '', {'properties': settings})['properties']
    if saved.get('GEMINI_API_KEY') != key or saved.get('MIS_GEMINI_API') != 'true':
        raise RuntimeError('Pulse-II Gemini settings could not be verified.')
    print('Pulse-II Gemini configuration verified; key remains server-side.')


if __name__ == '__main__':
    configure()
