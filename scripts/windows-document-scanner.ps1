param([ValidateSet('list','capture')][string]$Action='list')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
function Emit($data){$data | ConvertTo-Json -Compress -Depth 6 | Write-Output}
function Find-ScannerProperty($target,[int]$id){$target.Properties | Where-Object {$_.PropertyID -eq $id} | Select-Object -First 1}
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
 # Use the connected driver's capabilities, independent of scanner brand.
 $capabilities=Find-ScannerProperty $device 3086
 $hasFeeder=$capabilities -and (([int]$capabilities.Value -band 1) -ne 0)
 $source=Find-ScannerProperty $device 3088
 if($source){$source.Value=$(if($hasFeeder){1}else{2})}
 $pages=Find-ScannerProperty $device 3096
 if($pages){$pages.Value=1}
 $item=$device.Items.Item(1)
 $oldX=[double]$item.Properties.Item('6147').Value
 $oldY=[double]$item.Properties.Item('6148').Value
 $physicalX=[double]$item.Properties.Item('6151').Value/$oldX
 $physicalY=[double]$item.Properties.Item('6152').Value/$oldY
 # Prefer 300 DPI; drivers that do not support it retain their supported value.
 try{$item.Properties.Item('6147').Value=300}catch{}
 try{$item.Properties.Item('6148').Value=300}catch{}
 $item.Properties.Item('6151').Value=[int]($physicalX*[double]$item.Properties.Item('6147').Value)
 $item.Properties.Item('6152').Value=[int]($physicalY*[double]$item.Properties.Item('6148').Value)
 $count=0
 $limit=$(if($hasFeeder){120}else{1})
 while($count -lt $limit){
   try{$image=$item.Transfer('{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}')}
   catch{
     $e=$_.Exception;$empty=$false
     while($e){if($e.HResult -eq -2145320957){$empty=$true};$e=$e.InnerException}
     if($empty){if($count -eq 0){Emit @{type='error';message='The feeder is empty. Load the cards as directed by your scanner manufacturer, then select Scan again.'};exit 2};break}
     throw
   }
   $count++
   $name=('page-{0:D3}.png' -f $count)
   $image.SaveFile([IO.Path]::Combine($out,$name))
   Emit @{type='page';filename=$name;page=$count}
 }
 Emit @{type='complete';pages=$count;limitReached=($count -eq 120)}
}catch{Emit @{type='error';message=('Windows scanner: '+$_.Exception.Message)};exit 1}
