param([ValidateSet('list','capture')][string]$Action='list')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
function Emit($data){$data | ConvertTo-Json -Compress -Depth 6 | Write-Output}
try{
 $manager=New-Object -ComObject WIA.DeviceManager
 $devices=@($manager.DeviceInfos | Where-Object {$_.Type -eq 1})
 if($Action -eq 'list'){
   $result=@($devices | ForEach-Object { @{id=$_.DeviceID;name=($_.Properties | Where-Object {$_.Name -eq 'Name'}).Value} })
   Emit @{devices=$result};exit 0
 }
 $selected=$devices | Where-Object {$_.DeviceID -eq $env:PULSE_SCANNER_DEVICE_ID} | Select-Object -First 1
 if(!$selected){throw 'Selected scanner is not connected.'}
 $out=[IO.Path]::GetFullPath($env:PULSE_SCANNER_JOB_DIR)
 if(!(Test-Path -LiteralPath $out -PathType Container)){throw 'Scanner output folder is unavailable.'}
 $device=$selected.Connect()
 # Windows WIA: feeder, one page per transfer. Duplex PDFs can be imported separately.
 $device.Properties.Item('3088').Value=1
 $device.Properties.Item('3096').Value=1
 $item=$device.Items.Item(1)
 $oldX=[double]$item.Properties.Item('6147').Value
 $oldY=[double]$item.Properties.Item('6148').Value
 $physicalX=[double]$item.Properties.Item('6151').Value/$oldX
 $physicalY=[double]$item.Properties.Item('6152').Value/$oldY
 $item.Properties.Item('6147').Value=300
 $item.Properties.Item('6148').Value=300
 $item.Properties.Item('6151').Value=[int]($physicalX*300)
 $item.Properties.Item('6152').Value=[int]($physicalY*300)
 $count=0
 while($count -lt 120){
   try{$image=$item.Transfer('{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}')}
   catch{
     $e=$_.Exception;$empty=$false
     while($e){if($e.HResult -eq -2145320957){$empty=$true};$e=$e.InnerException}
     if($empty){if($count -eq 0){Emit @{type='error';message='The feeder is empty. Load the Trip Cards face down as directed by Brother, then select Scan again.'};exit 2};break}
     throw
   }
   $count++
   $name=('page-{0:D3}.png' -f $count)
   $image.SaveFile([IO.Path]::Combine($out,$name))
   Emit @{type='page';filename=$name;page=$count}
 }
 Emit @{type='complete';pages=$count;limitReached=($count -eq 120)}
}catch{Emit @{type='error';message=('Windows scanner: '+$_.Exception.Message)};exit 1}
