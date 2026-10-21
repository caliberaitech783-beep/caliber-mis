"""Configure MIS using the owner-approved existing administrator secret.

Run in an authenticated Azure Cloud Shell. Default mode only prints the plan.
--apply requires explicit operator approval for the managed-identity secret
grant and private network integration. Secret values are never fetched/printed.
"""
import argparse
import json
import os
import subprocess
import tempfile

SUBSCRIPTION = '58ca09cf-ab5d-47a8-a438-e1fb2a40d030'
GROUP = 'coalmine-fleet-maintenance-rg'
SOURCE = 'coalmine-fleet-azure-783'
TARGET = 'caliber-mis-783'
VAULT = 'coalmine-kv-783-2609'
SECRET = 'database-url-production'
ROLE = '4633458b-17de-408a-b874-0445c86b69e6'  # Key Vault Secrets User


def azure(*args):
    command = ['az', *args, '--subscription', SUBSCRIPTION, '--output', 'json']
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode:
        # Azure diagnostics can contain app settings: never print them.
        raise RuntimeError('Azure operation did not complete; diagnostics suppressed.')
    return json.loads(result.stdout) if result.stdout.strip() else None


def configure(apply=False):
    source = azure('webapp', 'show', '-g', GROUP, '-n', SOURCE)
    target = azure('webapp', 'show', '-g', GROUP, '-n', TARGET)
    expected_plan = 'asp-coalminefleetmaintenancerg-b234'
    if source['serverFarmId'].lower() != target['serverFarmId'].lower() or not target['serverFarmId'].lower().endswith('/'+expected_plan):
        raise RuntimeError('Unexpected App Service plan; no changes made.')
    subnet = source.get('virtualNetworkSubnetId')
    if not subnet or not subnet.lower().endswith('/coalmine-fleet-prod-vnet/subnets/appsvc-integration'):
        raise RuntimeError('Expected private application subnet was not found.')
    reference = azure('webapp', 'config', 'appsettings', 'list', '-g', GROUP, '-n', SOURCE,
                      '--query', "[?name=='DATABASE_URL'].value | [0]")
    if not reference.startswith('@Microsoft.KeyVault('):
        raise RuntimeError('Expected Key Vault reference was not found.')
    fields = dict(item.split('=', 1) for item in reference[reference.index('(')+1:-1].split(';') if '=' in item)
    if fields.get('VaultName') != VAULT or fields.get('SecretName') != SECRET:
        raise RuntimeError('Database secret reference differs from the reviewed plan.')
    vault = azure('keyvault', 'show', '--name', VAULT)
    scope = vault['id']+'/secrets/'+SECRET
    print('MIS plan: existing shared plan; private appsvc-integration subnet; system-assigned identity.')
    print('MIS grant: Key Vault Secrets User on database-url-production only.')
    print('MIS settings: existing Key Vault reference, shared-admin connection forced to caliber_mis, SSO client mode.')
    print('Pulse: configuration, password, records and networking are not changed by this script.')
    if not apply:
        return
    identity = azure('webapp', 'identity', 'assign', '-g', GROUP, '-n', TARGET)
    principal = identity['principalId']
    if target.get('virtualNetworkSubnetId') != subnet:
        azure('webapp', 'vnet-integration', 'add', '-g', GROUP, '-n', TARGET,
              '--vnet', subnet.split('/subnets/')[0], '--subnet', subnet)
    azure('webapp', 'config', 'set', '-g', GROUP, '-n', TARGET,
          '--generic-configurations', json.dumps({'vnetRouteAllEnabled': True}))
    grants = azure('role', 'assignment', 'list', '--scope', scope, '--include-inherited')
    if not any(item.get('principalId') == principal and item.get('roleDefinitionId', '').lower().endswith('/'+ROLE) for item in grants):
        azure('role', 'assignment', 'create', '--assignee-object-id', principal,
              '--assignee-principal-type', 'ServicePrincipal', '--role', ROLE, '--scope', scope)
    changes = {'DATABASE_URL': reference, 'MIS_DATABASE_CONNECTION_MODE': 'shared-admin', 'MIS_SSO_MODE': 'client'}
    with tempfile.TemporaryDirectory(prefix='caliber-mis-') as directory:
        filename = os.path.join(directory, 'settings.json')
        descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(changes, stream)
        azure('webapp', 'config', 'appsettings', 'set', '-g', GROUP, '-n', TARGET, '--settings', '@'+filename)
    azure('rest', '--method', 'post', '--url', 'https://management.azure.com'+target['id']+'/config/configreferences/appsettings/refresh?api-version=2022-03-01')
    print('MIS_AZURE_CONFIGURED: identity, secret reference and private network configuration applied.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    try:
        configure(parser.parse_args().apply)
    except Exception:
        print('MIS configuration did not complete. Secret values and raw Azure diagnostics were suppressed.')
        raise SystemExit(1)
